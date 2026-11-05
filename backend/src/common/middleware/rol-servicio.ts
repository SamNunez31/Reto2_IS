import { NextFunction, Request, Response } from 'express';
import { construirProblema } from '../problem/problem';

/**
 * Reto 2 — migración a microservicios por rol.
 * La MISMA imagen Docker se despliega varias veces con SERVICE_ROLE distinto.
 * Cada despliegue solo atiende las rutas de su servicio; el resto responde 404 (problem+json).
 * Con SERVICE_ROLE vacío o "all" se comporta como monolito (compatible con lo ya registrado en Booking).
 */
export type RolServicio = 'identity' | 'catalog' | 'reservations' | 'integration';
export const ROLES: readonly RolServicio[] = ['identity', 'catalog', 'reservations', 'integration'];

/** Mismas reglas que scripts/dividir-contratos.js (v1) + reparto del contrato v2. Orden = prioridad. */
export const REGLAS: ReadonlyArray<[RegExp, RolServicio]> = [
  // ---- v2 (canal Booking) ----
  [/^\/api\/v2\/clientes(\/|$)/, 'identity'], // fichas de huéspedes
  [/^\/api\/v2\/alojamientos\/(promociones|eventos)(\/|$)/, 'integration'],
  [/^\/api\/v2\/alojamientos\/(orders|reservations|reservas|availability)(\/|$)/, 'reservations'],
  [/^\/api\/v2\/alojamientos\/[^/]+\/(inventario|disponibilidad|availability|reservations)$/, 'reservations'],
  [/^\/api\/v2\/alojamientos(\/|$)/, 'catalog'], // listado, search, categorias, tipos, :id, habitaciones, reviews
  // ---- v1 ----
  [/^\/api\/v1\/orders\/[^/]+\/review$/, 'catalog'],
  [/^\/api\/v1\/host\/reviews(\/|$)/, 'catalog'],
  [/^\/api\/v1\/host\/accommodations\/[^/]+\/units$/, 'reservations'],
  [/^\/api\/v1\/host\/units(\/|$)/, 'reservations'],
  [/^\/api\/v1\/host\/accommodations(\/|$)/, 'catalog'],
  [/^\/api\/v1\/host\/(orders|income)(\/|$)/, 'reservations'],
  [/^\/api\/v1\/auth(\/|$)/, 'identity'],
  [/^\/api\/v1\/me$/, 'identity'],
  [/^\/api\/v1\/me\/orders$/, 'reservations'],
  [/^\/api\/v1\/admin\/users(\/|$)/, 'identity'],
  [/^\/api\/v1\/admin\/(accommodations|catalogs)(\/|$)/, 'catalog'],
  [/^\/api\/v1\/admin\/(taxes|indicators|sales-by-city|top-accommodations)(\/|$)/, 'reservations'],
  [/^\/api\/v1\/admin\/(events|jobs)(\/|$)/, 'integration'],
  [/^\/api\/v1\/webhooks(\/|$)/, 'integration'],
  [/^\/api\/v1\/(search|details|chains|constants|reviews)(\/|$)/, 'catalog'],
  [/^\/api\/v1\/(availability|bulk-availability|orders)(\/|$)/, 'reservations'],
];

/** Rutas que todo servicio expone (salud) y que no pertenecen a ninguno en particular. */
const COMUNES = /^\/(health|api\/v1\/health|api\/v2\/alojamientos\/health)\/?$/;

export function servicioDeRuta(ruta: string): RolServicio | 'comun' | null {
  if (COMUNES.test(ruta)) return 'comun';
  for (const [re, rol] of REGLAS) if (re.test(ruta)) return rol;
  return null;
}

export function rolActual(valor: string | undefined = process.env.SERVICE_ROLE): RolServicio | 'all' {
  const v = (valor ?? '').trim().toLowerCase();
  return (ROLES as readonly string[]).includes(v) ? (v as RolServicio) : 'all';
}

/** ¿Debe atender este rol la ruta dada? (función pura, probada en scripts/prueba-rol-servicio.cjs) */
export function atiende(rol: RolServicio | 'all', ruta: string): boolean {
  if (rol === 'all') return true;
  const s = servicioDeRuta(ruta);
  return s === 'comun' || s === rol;
}

export function rolServicioMiddleware(req: Request, res: Response, next: NextFunction): void {
  const rol = rolActual();
  res.setHeader('X-Service-Name', rol === 'all' ? 'posada-monolito' : `posada-${rol}`);
  if (req.method === 'OPTIONS' || atiende(rol, req.path)) {
    next();
    return;
  }
  const problema = construirProblema(404, 'NOT_FOUND', `Esta ruta no pertenece al servicio "${rol}".`, undefined, { instance: req.path, correlation_id: req.correlationId, servicio: rol });
  res.status(404).type('application/problem+json').json(problema);
}
