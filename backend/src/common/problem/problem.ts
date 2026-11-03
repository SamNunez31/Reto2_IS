import { HttpException } from '@nestjs/common';

/** Códigos permitidos por el contrato (enum de ProblemDetails.code en el YAML). */
export type ProblemCode =
  | 'VALIDATION_FAILED'
  | 'ROOM_NO_LONGER_AVAILABLE'
  | 'PRICE_CHANGED'
  | 'BOOKING_NOT_CONFIRMED'
  | 'CANCELLATION_NOT_ALLOWED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'PAYMENT_REFERENCE_INVALID'
  | 'PAYMENT_NOT_AUTHORIZED'
  // Códigos del contrato v2 (ErrorCode). En rutas /api/v1 se traducen al enum v1 (ver problem-v2.ts)
  | 'INVALID_DOCUMENT'
  | 'HOTEL_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'OUT_OF_STOCK'
  | 'QUOTE_EXPIRED'
  | 'PRICE_MISMATCH'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'INVALID_STATE_TRANSITION'
  | 'CHECKIN_TIME_NOT_REACHED'
  | 'CAPACITY_EXCEEDED'
  | 'DISCOUNT_EXCEEDS_CONTRACT'
  | 'PROMOTIONS_NOT_ALLOWED'
  | 'RATE_LIMITED'
  | 'PROVIDER_DISABLED'
  | 'GATEWAY_TIMEOUT'
  | 'INTERNAL_ERROR'
  | 'RESTRICTION_VIOLATED'
  | 'UNSUPPORTED_CURRENCY'
  | 'INSUFFICIENT_SCOPE';

export interface InvalidParam {
  name: string;
  reason: string;
}

/** Cuerpo de error RFC 7807 con la forma exacta del esquema ProblemDetails del contrato. */
export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: ProblemCode;
  invalidParams?: InvalidParam[];
  /** Campos extra del contrato v2 (restriccion, habilitadoDesde, scopes_requeridos). Solo salen en /api/v2. */
  extras?: Record<string, unknown>;
}

const TITULOS: Record<number, string> = {
  400: 'Petición inválida',
  401: 'No autenticado',
  402: 'Pago no autorizado',
  403: 'Acceso denegado',
  404: 'Recurso no encontrado',
  409: 'Conflicto',
  413: 'Cuerpo demasiado grande',
  429: 'Demasiadas peticiones',
  500: 'Error interno',
  503: 'Servicio no disponible',
};

export function tituloPorEstado(status: number): string {
  return TITULOS[status] ?? 'Error';
}

export function construirProblema(
  status: number,
  code: ProblemCode,
  detail?: string,
  invalidParams?: InvalidParam[],
  extras?: Record<string, unknown>,
): ProblemBody {
  const body: ProblemBody = {
    type: `https://booking-prototipo.ec/problemas/${code.toLowerCase().replace(/_/g, '-')}`,
    title: tituloPorEstado(status),
    status,
    code,
  };
  if (detail) body.detail = detail;
  if (invalidParams && invalidParams.length) body.invalidParams = invalidParams;
  if (extras && Object.keys(extras).length) body.extras = extras;
  return body;
}

/**
 * Excepción de negocio que el filtro global convierte en application/problem+json.
 * `retryAfter` (segundos) se envía como cabecera Retry-After.
 */
export class ProblemException extends HttpException {
  constructor(
    status: number,
    code: ProblemCode,
    detail?: string,
    invalidParams?: InvalidParam[],
    public readonly retryAfter?: number,
    extras?: Record<string, unknown>,
  ) {
    super(construirProblema(status, code, detail, invalidParams, extras), status);
  }
}

// Atajos para los casos más comunes
export const noEncontrado = (detail = 'El recurso no existe') =>
  new ProblemException(404, 'VALIDATION_FAILED', detail);
export const prohibido = (detail = 'No tienes permiso para esta operación') =>
  new ProblemException(403, 'VALIDATION_FAILED', detail);
export const invalido = (detail: string, invalidParams?: InvalidParam[]) =>
  new ProblemException(400, 'VALIDATION_FAILED', detail, invalidParams);
export const conflicto = (detail: string, code: ProblemCode = 'VALIDATION_FAILED') =>
  new ProblemException(409, code, detail);
