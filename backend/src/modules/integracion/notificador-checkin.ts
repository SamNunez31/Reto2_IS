import { Injectable } from '@nestjs/common';
import { logJson } from '../../common/logging/log-json';
import { DbService } from '../../database/db.service';
import { asegurarCliente } from '../alojamientos-v2/clientes-v2';

const PLAZO_MS = 8000;
export const MAX_INTENTOS = 12;

interface FilaCheckin {
  external: string;
  cliente_id: string | null;
  num_huespedes: number;
  huespedes: number | null;
  admin: string | null;
  observaciones: string | null;
  fecha: string;
  titular: { nombreCompleto?: string; email?: string; identificacion?: string; telefono?: string } | null;
}

/**
 * Avisa a Booking que el huésped llegó físicamente a recepción:
 *   POST {BOOKING}/api/v2/reservas/{external_order_id}/checkin   (X-API-Key)
 * Es idempotente en nuestro lado (checkin_notificado_en) y con reintentos: si Booking no responde,
 * el job `notificar-checkin` vuelve a intentarlo con espera creciente; un 4xx (salvo 408/429) no se reintenta.
 */
@Injectable()
export class NotificadorCheckin {
  constructor(private readonly db: DbService) {}

  private config(): { base: string; llave: string } | null {
    const base = (process.env.CHECKIN_REST_URL || process.env.STOCK_REST_URL || '').trim().replace(/\/$/, '');
    const llave = (process.env.CHECKIN_REST_API_KEY || process.env.STOCK_REST_API_KEY || '').trim();
    return base && llave ? { base, llave } : null;
  }

  /** Intenta avisar a Booking. Devuelve true si Booking confirmó (2xx) o ya estaba notificado. Nunca lanza. */
  async notificar(reservaId: string): Promise<boolean> {
    try {
      const cfg = this.config();
      if (!cfg) {
        logJson('warn', 'checkin_notif_sin_config', { motivo: 'faltan STOCK_REST_URL o STOCK_REST_API_KEY' });
        return false;
      }
      // Reclama el intento (si otro proceso ya notificó, no devuelve filas)
      const reclamo = await this.db.query<{ intentos: number }>(
        `UPDATE orden_v2 SET checkin_notif_intentos = checkin_notif_intentos + 1, checkin_notif_ultimo = now()
          WHERE reserva_id = $1::uuid AND checkin_recepcion AND checkin_notificado_en IS NULL AND checkin_notif_intentos < $2
        RETURNING checkin_notif_intentos AS intentos`,
        [reservaId, MAX_INTENTOS],
      );
      if (!reclamo.length) {
        const ya = await this.db.uno<{ n: boolean }>(`SELECT (checkin_notificado_en IS NOT NULL) AS n FROM orden_v2 WHERE reserva_id = $1::uuid`, [reservaId]);
        return ya?.n === true;
      }
      const f = await this.db.uno<FilaCheckin>(
        `SELECT r.codigo AS external, o.cliente_id::text, r.num_huespedes, o.checkin_huespedes AS huespedes, o.checkin_admin AS admin,
                o.checkin_observaciones AS observaciones,
                to_char(o.checkin_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fecha, o.titular
           FROM orden_v2 o JOIN reserva r ON r.id = o.reserva_id WHERE o.reserva_id = $1::uuid`,
        [reservaId],
      );
      if (!f) return false;
      let clientId = f.cliente_id;
      if (!clientId && f.titular?.email && f.titular.identificacion) {
        // Reservas anteriores al módulo de huéspedes: se crea la ficha ahora
        const r = await this.db.transaccion((q) =>
          asegurarCliente(q, { nombre: f.titular?.nombreCompleto ?? 'Huésped', email: f.titular!.email!, identificacion: f.titular!.identificacion!, telefono: f.titular?.telefono ?? null }),
        );
        if ('cliente' in r) {
          clientId = r.cliente.client_id;
          await this.db.query(`UPDATE orden_v2 SET cliente_id = $2::uuid WHERE reserva_id = $1::uuid`, [reservaId, clientId]);
        }
      }
      const externalOrderId = `ORD-HTL-${f.external.slice(3)}`;
      const cuerpo = {
        external_order_id: externalOrderId,
        client_id: clientId,
        estado: 'CONFIRMADO_ASISTIDO',
        huespedes_reales: f.huespedes ?? f.num_huespedes,
        admin_id: f.admin ?? 'recepcionista-hotel',
        fecha_checkin: f.fecha,
        observaciones: f.observaciones ?? 'Huésped presentado en recepción',
      };
      let estado = 0;
      let detalle = '';
      try {
        const r = await fetch(`${cfg.base}/api/v2/reservas/${encodeURIComponent(externalOrderId)}/checkin`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': cfg.llave, 'x-correlation-id': `checkin-${reservaId.slice(0, 8)}-${reclamo[0].intentos}` },
          body: JSON.stringify(cuerpo),
          signal: AbortSignal.timeout(PLAZO_MS),
        });
        estado = r.status;
        if (!r.ok) detalle = (await r.text().catch(() => '')).slice(0, 200);
      } catch (e) {
        detalle = e instanceof Error ? e.message : String(e);
      }
      if (estado >= 200 && estado < 300) {
        await this.db.query(`UPDATE orden_v2 SET checkin_notificado_en = now(), checkin_notif_error = NULL WHERE reserva_id = $1::uuid`, [reservaId]);
        logJson('info', 'checkin_notificado_a_booking', { external_order_id: externalOrderId, status: estado, intentos: reclamo[0].intentos });
        return true;
      }
      const definitivo = estado >= 400 && estado < 500 && estado !== 408 && estado !== 429;
      await this.db.query(
        `UPDATE orden_v2 SET checkin_notif_error = $2, checkin_notif_intentos = CASE WHEN $3::boolean THEN $4 ELSE checkin_notif_intentos END WHERE reserva_id = $1::uuid`,
        [reservaId, `HTTP ${estado || 'sin respuesta'} ${detalle}`.slice(0, 300), definitivo, MAX_INTENTOS],
      );
      logJson(definitivo ? 'error' : 'warn', 'checkin_notif_fallo', { external_order_id: externalOrderId, status: estado, definitivo, detalle });
      return false;
    } catch (e) {
      logJson('error', 'checkin_notif_error', { error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  /** Reintenta los avisos pendientes (espera creciente: 20 s × 2^intentos, tope 64×). */
  async reintentarPendientes(limite = 20): Promise<number> {
    const ids = await this.db.query<{ id: string }>(
      `SELECT reserva_id::text AS id FROM orden_v2
        WHERE checkin_recepcion AND checkin_notificado_en IS NULL AND checkin_notif_intentos < $1
          AND (checkin_notif_ultimo IS NULL OR checkin_notif_ultimo < now() - (interval '20 seconds' * power(2, least(checkin_notif_intentos, 6))))
        ORDER BY checkin_en LIMIT $2`,
      [MAX_INTENTOS, limite],
    );
    let enviados = 0;
    for (const { id } of ids) if (await this.notificar(id)) enviados++;
    return enviados;
  }
}
