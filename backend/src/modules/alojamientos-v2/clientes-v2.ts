import { Consulta } from '../../database/db.service';
import { logJson } from '../../common/logging/log-json';
import { Titular } from './util-v2';

export interface ClienteV2 {
  client_id: string;
  nombre: string;
  email: string;
  identificacion: string;
  telefono: string | null;
}

export const SQL_CLIENTE = `SELECT id::text AS client_id, nombre, email, identificacion, telefono FROM cliente_v2`;

/**
 * Busca la ficha por identificación (prioridad) o por correo. Devuelve la primera coincidencia.
 * Las dos claves son únicas, así que a lo sumo hay una ficha por cada una.
 */
export async function buscarCliente(q: Consulta, email?: string, identificacion?: string): Promise<ClienteV2 | null> {
  const f = await q<ClienteV2>(
    `${SQL_CLIENTE} WHERE ($1::text IS NOT NULL AND identificacion = $1) OR ($2::text IS NOT NULL AND email = $2)
      ORDER BY (identificacion = $1::text) DESC NULLS LAST LIMIT 1`,
    [identificacion ? identificacion.toUpperCase() : null, email ? email.toLowerCase() : null],
  );
  return f[0] ?? null;
}

/**
 * Crea la ficha si no existe y devuelve su id. Es idempotente: la misma identificación o el mismo correo
 * devuelven la ficha existente (no se duplica). Si el correo y la identificación pertenecen a fichas
 * DISTINTAS, es un conflicto de datos y devuelve { conflicto: true }.
 */
export async function asegurarCliente(
  q: Consulta,
  d: { nombre: string; email: string; identificacion: string; telefono?: string | null },
): Promise<{ cliente: ClienteV2; creado: boolean } | { conflicto: true }> {
  const email = d.email.toLowerCase();
  const ident = d.identificacion.toUpperCase();
  const porIdent = (await q<ClienteV2>(`${SQL_CLIENTE} WHERE identificacion = $1`, [ident]))[0];
  const porEmail = (await q<ClienteV2>(`${SQL_CLIENTE} WHERE email = $1`, [email]))[0];
  if (porIdent && porEmail && porIdent.client_id !== porEmail.client_id) return { conflicto: true };
  const existente = porIdent ?? porEmail;
  if (existente) {
    if (existente.email !== email || existente.identificacion !== ident) return { conflicto: true };
    return { cliente: existente, creado: false };
  }
  const fila = await q<ClienteV2>(
    `INSERT INTO cliente_v2 (nombre, email, identificacion, telefono) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING RETURNING id::text AS client_id, nombre, email, identificacion, telefono`,
    [d.nombre.slice(0, 160), email, ident, d.telefono ?? null],
  );
  if (fila[0]) return { cliente: fila[0], creado: true };
  // Carrera: otra petición la creó justo ahora; se relee.
  const releida = await buscarCliente(q, email, ident);
  if (releida && releida.email === email && releida.identificacion === ident) return { cliente: releida, creado: false };
  logJson('warn', 'cliente_v2_conflicto', { identificacion: ident });
  return { conflicto: true };
}

/** Para crearOrden: vincula (best-effort) la ficha del titular a la orden. Nunca debe romper la reserva. */
export async function vincularTitular(q: Consulta, reservaId: string, t: Titular): Promise<void> {
  try {
    const r = await asegurarCliente(q, { nombre: t.nombreCompleto, email: t.email, identificacion: t.identificacion, telefono: t.telefono });
    if ('cliente' in r) await q(`UPDATE orden_v2 SET cliente_id = $2::uuid WHERE reserva_id = $1::uuid`, [reservaId, r.cliente.client_id]);
  } catch (e) {
    // p. ej. todavía no se ejecutó 06_v2_clientes_checkin.sql: la reserva sigue siendo válida
    logJson('warn', 'cliente_v2_vinculo_omitido', { error: e instanceof Error ? e.message : String(e) });
  }
}
