import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Request } from 'express';

export type Rol = 'USUARIO' | 'ADMIN';

/** Scopes OAuth2 del contrato. */
export type Scope =
  | 'alojamientos:read'
  | 'alojamientos:book'
  | 'alojamientos:cancel'
  | 'alojamientos:webhooks'
  // Contrato v2 (cuenta de servicio del ESB)
  | 'alojamientos:checkin'
  | 'alojamientos:inventory'
  | 'alojamientos:admin';

export const SCOPES_POR_ROL: Record<Rol, Scope[]> = {
  USUARIO: ['alojamientos:read', 'alojamientos:book', 'alojamientos:cancel'],
  ADMIN: ['alojamientos:read', 'alojamientos:webhooks'], // el ADMIN no reserva
};

/** Claims del JWT de acceso. */
export interface UsuarioToken {
  sub: string;
  email: string;
  rol: Rol;
  scope: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: UsuarioToken;
  }
}

export const ES_PUBLICO = 'esPublico';
export const ROLES = 'roles';
export const SCOPES = 'scopes';

/** Ruta sin token (equivale a `security: []` del contrato). */
export const Public = () => SetMetadata(ES_PUBLICO, true);
/** Restringe por rol. */
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES, roles);
/** Exige los scopes del campo `security` de la operación. */
export const Scopes = (...scopes: Scope[]) => SetMetadata(SCOPES, scopes);

/** Usuario autenticado (claims del JWT). El ownerId SIEMPRE sale de aquí (sub). */
export const UsuarioActual = createParamDecorator((_d: unknown, ctx: ExecutionContext): UsuarioToken => {
  return ctx.switchToHttp().getRequest<Request>().user as UsuarioToken;
});

/** request_id de las respuestas del contrato = X-Correlation-Id. */
export const CorrelationId = createParamDecorator((_d: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest<Request>().correlationId ?? '';
});
