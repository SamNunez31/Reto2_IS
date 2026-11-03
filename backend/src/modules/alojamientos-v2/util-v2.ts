import { InvalidParam, ProblemException, invalido } from '../../common/problem/problem';

// ---------------------------------------------------------------------------
// Dinero: el contrato usa strings decimales exactos ("560.00"). Internamente se calcula en
// CENTAVOS ENTEROS para que las sumas cuadren siempre (nunca number con decimales).
// ---------------------------------------------------------------------------
export const RE_MONEY = /^(0|[1-9][0-9]{0,8})\.[0-9]{2}$/;

/** "120.5" | "120.50" (numeric de Postgres) -> 12050 */
export function aCentavos(valor: string | number): number {
  const [ent, dec = ''] = String(valor).split('.');
  return Number(ent) * 100 + Number((dec + '00').slice(0, 2));
}

/** 12050 -> "120.50" */
export function aMoney(centavos: number): string {
  const c = Math.round(centavos);
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Fechas (calendario de America/Guayaquil, sin horario de verano)
// ---------------------------------------------------------------------------
export const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function esFechaReal(s: unknown): s is string {
  if (typeof s !== 'string' || !RE_FECHA.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Instante (ms) -> RFC 3339 con offset de Guayaquil: 2026-11-01T14:00:00-05:00 */
export function iso5(ms: number): string {
  return `${new Date(ms - 5 * 3_600_000).toISOString().slice(0, 19)}-05:00`;
}

// ---------------------------------------------------------------------------
// Validación de cuerpos (400 = esquema; 422 = regla de negocio, se lanza en el servicio)
// ---------------------------------------------------------------------------
export const RE_ALOJAMIENTO_ID =
  /^(?!(health|eventos|categorias|tipos|orders|reservations|reservas|search|availability|promociones)$)[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
export const RE_TIPO = /^[A-Z0-9_]{2,40}$/;
export const RE_PLAN = /^[A-Z0-9_]{2,30}$/;
export const REGIMENES = ['SOLO_HABITACION', 'DESAYUNO_INCLUIDO', 'MEDIA_PENSION', 'PENSION_COMPLETA', 'TODO_INCLUIDO'];
export const RE_TELEFONO = /^(\+[0-9]{8,15}|09[0-9]{8})$/;
export const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Ocupantes {
  adultos: number;
  ninos: number;
  edadesNinos?: number[];
}

export function soloObjeto(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalido('El cuerpo debe ser un objeto JSON', [{ name: 'body', reason: 'se esperaba un objeto' }]);
  }
  return body as Record<string, unknown>;
}

/** Los servidores DEBEN rechazar con 400 los campos desconocidos (additionalProperties: false). */
export function camposDesconocidos(body: Record<string, unknown>, permitidos: string[], errores: InvalidParam[]): void {
  for (const k of Object.keys(body)) {
    if (!permitidos.includes(k)) errores.push({ name: k, reason: 'campo no permitido por el contrato' });
  }
}

export function lanzarSiHayErrores(errores: InvalidParam[]): void {
  if (errores.length) throw invalido('La petición no cumple el esquema del contrato', errores.slice(0, 50));
}

export function entero(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

export function leerOcupantes(v: unknown, errores: InvalidParam[], nombre = 'ocupantes'): Ocupantes | undefined {
  if (v === undefined) return undefined;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    errores.push({ name: nombre, reason: 'debe ser un objeto { adultos, ninos }' });
    return undefined;
  }
  const o = v as Record<string, unknown>;
  camposDesconocidos(o, ['adultos', 'ninos', 'edadesNinos'], errores);
  if (!entero(o.adultos, 1, 20)) errores.push({ name: `${nombre}.adultos`, reason: 'entero entre 1 y 20' });
  const ninos = o.ninos === undefined ? 0 : o.ninos;
  if (!entero(ninos, 0, 10)) errores.push({ name: `${nombre}.ninos`, reason: 'entero entre 0 y 10' });
  if (o.edadesNinos !== undefined) {
    const ok = Array.isArray(o.edadesNinos) && o.edadesNinos.length <= 10 && o.edadesNinos.every((e) => entero(e, 0, 17));
    if (!ok) errores.push({ name: `${nombre}.edadesNinos`, reason: 'máximo 10 edades, cada una entre 0 y 17' });
  }
  return { adultos: o.adultos as number, ninos: ninos as number, edadesNinos: o.edadesNinos as number[] | undefined };
}

/** Campos comunes a /availability y /orders/create. */
export interface ComunV2 {
  alojamientoId: string;
  tipoHabitacionCodigo: string;
  fechaInicio: string;
  fechaFin: string;
  cantidadHabitaciones: number;
  ocupantes?: Ocupantes;
  regimenSeleccionado?: string;
  currency: string;
  planTarifaCodigo?: string;
}

export function leerComunes(b: Record<string, unknown>, errores: InvalidParam[]): ComunV2 {
  if (typeof b.alojamientoId !== 'string' || !RE_ALOJAMIENTO_ID.test(b.alojamientoId))
    errores.push({ name: 'alojamientoId', reason: 'obligatorio; formato HTL-1001 (3 a 64 caracteres)' });
  if (typeof b.tipoHabitacionCodigo !== 'string' || !RE_TIPO.test(b.tipoHabitacionCodigo))
    errores.push({ name: 'tipoHabitacionCodigo', reason: 'obligatorio; patrón ^[A-Z0-9_]{2,40}$' });
  if (!esFechaReal(b.fechaInicio)) errores.push({ name: 'fechaInicio', reason: 'obligatoria; formato YYYY-MM-DD' });
  if (!esFechaReal(b.fechaFin)) errores.push({ name: 'fechaFin', reason: 'obligatoria; formato YYYY-MM-DD' });
  const cant = b.cantidadHabitaciones === undefined ? 1 : b.cantidadHabitaciones;
  if (!entero(cant, 1, 10)) errores.push({ name: 'cantidadHabitaciones', reason: 'entero entre 1 y 10' });
  if (b.regimenSeleccionado !== undefined && !REGIMENES.includes(b.regimenSeleccionado as string))
    errores.push({ name: 'regimenSeleccionado', reason: `uno de ${REGIMENES.join(', ')}` });
  const moneda = b.currency === undefined ? 'USD' : b.currency;
  if (typeof moneda !== 'string' || !/^[A-Z]{3}$/.test(moneda)) errores.push({ name: 'currency', reason: 'código ISO 4217 (3 letras)' });
  if (b.planTarifaCodigo !== undefined && (typeof b.planTarifaCodigo !== 'string' || !RE_PLAN.test(b.planTarifaCodigo)))
    errores.push({ name: 'planTarifaCodigo', reason: 'patrón ^[A-Z0-9_]{2,30}$' });
  return {
    alojamientoId: b.alojamientoId as string,
    tipoHabitacionCodigo: b.tipoHabitacionCodigo as string,
    fechaInicio: b.fechaInicio as string,
    fechaFin: b.fechaFin as string,
    cantidadHabitaciones: cant as number,
    ocupantes: leerOcupantes(b.ocupantes, errores),
    regimenSeleccionado: b.regimenSeleccionado as string | undefined,
    currency: moneda as string,
    planTarifaCodigo: b.planTarifaCodigo as string | undefined,
  };
}

export interface Titular {
  nombreCompleto: string;
  tipoDocumento: 'CEDULA' | 'PASAPORTE' | 'RUC';
  identificacion: string;
  email: string;
  telefono: string;
  nacionalidad?: string;
}

const TIPOS_DOC = ['CEDULA', 'PASAPORTE', 'RUC'];

/** Valida forma (400). El módulo 10 de la cédula (422 INVALID_DOCUMENT) lo verifica el servicio. */
export function leerTitular(b: Record<string, unknown>, errores: InvalidParam[]): Titular | undefined {
  const t = b.huespedTitular;
  const cc = b.customer_contact;
  let nombre: unknown;
  let tipo: unknown;
  let ident: unknown;
  let email: unknown;
  let tel: unknown;
  let nac: unknown;
  let prefijo: string;
  if (t !== undefined) {
    prefijo = 'huespedTitular';
    if (!t || typeof t !== 'object' || Array.isArray(t)) {
      errores.push({ name: prefijo, reason: 'debe ser un objeto' });
      return undefined;
    }
    const o = t as Record<string, unknown>;
    ({ nombreCompleto: nombre, tipoDocumento: tipo, identificacion: ident, email, telefono: tel, nacionalidad: nac } = o);
  } else if (cc !== undefined) {
    prefijo = 'customer_contact';
    if (!cc || typeof cc !== 'object' || Array.isArray(cc)) {
      errores.push({ name: prefijo, reason: 'debe ser un objeto' });
      return undefined;
    }
    const o = cc as Record<string, unknown>;
    ({ full_name: nombre, document_type: tipo, document_id: ident, email, phone: tel } = o);
  } else {
    errores.push({ name: 'huespedTitular', reason: 'se exige huespedTitular o customer_contact' });
    return undefined;
  }
  if (typeof nombre !== 'string' || nombre.length < 3 || nombre.length > 120 || !/^\S+(\s+\S+)+$/.test(nombre))
    errores.push({ name: `${prefijo}.nombreCompleto`, reason: 'al menos dos palabras (3 a 120 caracteres)' });
  if (typeof tipo !== 'string' || !TIPOS_DOC.includes(tipo))
    errores.push({ name: `${prefijo}.tipoDocumento`, reason: 'CEDULA, PASAPORTE o RUC' });
  const patron = tipo === 'CEDULA' ? /^[0-9]{10}$/ : tipo === 'RUC' ? /^[0-9]{13}$/ : /^[A-Z0-9]{6,12}$/;
  if (typeof ident !== 'string' || !patron.test(ident))
    errores.push({ name: `${prefijo}.identificacion`, reason: 'no cumple el patrón del tipo de documento' });
  if (typeof email !== 'string' || email.length > 120 || !RE_EMAIL.test(email))
    errores.push({ name: `${prefijo}.email`, reason: 'correo electrónico inválido' });
  if (typeof tel !== 'string' || !RE_TELEFONO.test(tel))
    errores.push({ name: `${prefijo}.telefono`, reason: 'formato +593XXXXXXXXX o 09XXXXXXXX' });
  if (nac !== undefined && (typeof nac !== 'string' || nac.length > 60)) errores.push({ name: `${prefijo}.nacionalidad`, reason: 'máximo 60 caracteres' });
  return {
    nombreCompleto: nombre as string,
    tipoDocumento: tipo as Titular['tipoDocumento'],
    identificacion: ident as string,
    email: email as string,
    telefono: tel as string,
    nacionalidad: nac as string | undefined,
  };
}

export const noEncontradoV2 = (detail: string): ProblemException => new ProblemException(404, 'NOT_FOUND', detail);
export const reglaV2 = (code: ConstructorParameters<typeof ProblemException>[1], detail: string, invalid?: InvalidParam[], extras?: Record<string, unknown>): ProblemException =>
  new ProblemException(422, code, detail, invalid, undefined, extras);
