import { Request } from 'express';
import { ProblemBody, ProblemCode } from './problem';

/**
 * Los errores se construyen con un solo modelo interno (ProblemBody) y se "visten" según la ruta:
 *  - /api/v1/...  -> forma y códigos del contrato v1 (enum cerrado de 8 códigos).
 *  - /api/v2/...  -> forma y códigos del contrato v2 (ErrorCode de 25 valores, instance, snake_case).
 */

const CODIGOS_V1 = new Set<string>([
  'VALIDATION_FAILED',
  'ROOM_NO_LONGER_AVAILABLE',
  'PRICE_CHANGED',
  'BOOKING_NOT_CONFIRMED',
  'CANCELLATION_NOT_ALLOWED',
  'RATE_LIMIT_EXCEEDED',
  'PAYMENT_REFERENCE_INVALID',
  'PAYMENT_NOT_AUTHORIZED',
]);

export const esRutaV2 = (path: string): boolean => path.startsWith('/api/v2/');

/** Código v2 (o interno) -> código permitido por el contrato v1. */
export function aCodigoV1(code: ProblemCode): ProblemCode {
  if (CODIGOS_V1.has(code)) return code;
  switch (code) {
    case 'OUT_OF_STOCK':
      return 'ROOM_NO_LONGER_AVAILABLE';
    case 'PRICE_MISMATCH':
    case 'QUOTE_EXPIRED':
      return 'PRICE_CHANGED';
    case 'INVALID_STATE_TRANSITION':
      return 'CANCELLATION_NOT_ALLOWED';
    case 'RATE_LIMITED':
      return 'RATE_LIMIT_EXCEEDED';
    default:
      return 'VALIDATION_FAILED';
  }
}

/** Código v1 (o genérico) -> código del enum ErrorCode del contrato v2. */
export function aCodigoV2(code: ProblemCode, status: number): ProblemCode {
  switch (code) {
    case 'ROOM_NO_LONGER_AVAILABLE':
      return 'OUT_OF_STOCK';
    case 'PRICE_CHANGED':
      return 'PRICE_MISMATCH';
    case 'RATE_LIMIT_EXCEEDED':
      return 'RATE_LIMITED';
    case 'CANCELLATION_NOT_ALLOWED':
    case 'BOOKING_NOT_CONFIRMED':
      return 'INVALID_STATE_TRANSITION';
    case 'PAYMENT_REFERENCE_INVALID':
    case 'PAYMENT_NOT_AUTHORIZED':
      return 'VALIDATION_FAILED';
    case 'VALIDATION_FAILED':
      if (status === 401) return 'UNAUTHORIZED';
      if (status === 403) return 'FORBIDDEN';
      if (status === 404) return 'NOT_FOUND';
      if (status === 409) return 'CONFLICT';
      if (status === 504) return 'GATEWAY_TIMEOUT';
      if (status >= 500) return 'INTERNAL_ERROR';
      return 'VALIDATION_FAILED';
    default:
      return code; // ya es un código v2
  }
}

/** Cuerpo RFC 7807 con la forma exacta del esquema ProblemDetails del contrato v2. */
export function formatoV2(body: ProblemBody, req: Request, retryAfter?: number): Record<string, unknown> {
  const code = aCodigoV2(body.code, body.status);
  const base = (process.env.API_PUBLIC_URL || '').replace(/\/$/, '');
  const salida: Record<string, unknown> = {
    type: `${base}/errors/${code.toLowerCase().replace(/_/g, '-')}`,
    title: body.title,
    status: body.status,
    detail: (body.detail ?? body.title).slice(0, 500),
    instance: req.path.slice(0, 300),
    code,
    correlation_id: req.correlationId,
    timestamp: new Date().toISOString(),
  };
  if (retryAfter !== undefined) salida.retry_after_seconds = retryAfter;
  if (body.invalidParams?.length) salida.invalid_params = body.invalidParams.slice(0, 50);
  if (body.extras) Object.assign(salida, body.extras);
  return salida;
}
