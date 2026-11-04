import { NextFunction, Request, Response } from 'express';
import { logJson } from './log-json';

export type EventoSeguridad = 'login_ok' | 'login_fallido' | 'acceso_401' | 'acceso_403' | 'pago_confirmado' | 'operacion_critica';

/** Oculta la parte local del correo: "ana.perez@x.com" -> "a***@x.com". */
export function enmascararEmail(email: unknown): string | undefined {
  if (typeof email !== 'string' || !email.includes('@')) return undefined;
  const [local, dominio] = email.split('@');
  return `${local.slice(0, 1)}***@${dominio}`;
}

/**
 * Evento de auditoría de accesos (una línea JSON con tipo "auditoria").
 * Nunca recibe contraseñas, tokens ni cabeceras Authorization.
 */
export function auditar(evento: EventoSeguridad, req: Request, campos: Record<string, unknown> = {}): void {
  logJson(evento === 'login_ok' || evento === 'pago_confirmado' || evento === 'operacion_critica' ? 'info' : 'warn', 'auditoria', {
    evento,
    correlation_id: req.correlationId,
    ip: req.ip,
    method: req.method,
    path: req.path,
    usuario_id: req.user?.sub,
    ...campos,
  });
}

/**
 * Reto 2 (S11): auditoría de operaciones críticas del canal Booking (/api/v2).
 * Registra quién (sub y scopes), qué (método y ruta), con qué resultado y con qué Idempotency-Key.
 * Solo escrituras (POST/PUT/PATCH/DELETE); nunca el cuerpo ni el token.
 */
export function auditoriaOperacionesMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'OPTIONS' && req.path.startsWith('/api/v2/')) {
    res.on('finish', () => {
      auditar('operacion_critica', req, {
        status: res.statusCode,
        resultado: res.statusCode < 400 ? 'ok' : 'rechazada',
        scope: req.user?.scope,
        idempotency_key: req.header('idempotency-key'),
        reintento: res.getHeader('idempotent-replayed') === 'true' ? true : undefined,
      });
    });
  }
  next();
}
