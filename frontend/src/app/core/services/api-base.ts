import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { ProblemDetails } from '../models/api.models';

/** URL base del API (solo la conoce la capa de servicios). */
export const API = environment.apiUrl;

/** Cabeceras con un Idempotency-Key NUEVO por cada acción del usuario. */
export function cabecerasIdempotentes(): HttpHeaders {
  return new HttpHeaders({ 'Idempotency-Key': crypto.randomUUID() });
}

/** Booker fijo del prototipo (solo Ecuador). */
export const BOOKER = { country: 'ec', platform: 'desktop' } as const;

export interface ErrorVista {
  status: number;
  code: string;
  mensaje: string;
  campos: Record<string, string>;
  /** Código para reportar el error a soporte (viene del servidor). */
  correlacion?: string;
}

/** Convierte cualquier error HTTP en un mensaje legible (usa ProblemDetails si viene). */
export function leerError(err: unknown): ErrorVista {
  if (err instanceof HttpErrorResponse) {
    const p = err.error as Partial<ProblemDetails> | null;
    const campos: Record<string, string> = {};
    for (const ip of p?.invalidParams ?? []) campos[ip.name] = ip.reason;
    const mensaje =
      p?.detail ?? (err.status === 0 ? 'No se pudo conectar con el servidor. Puede estar despertando; intenta de nuevo en unos segundos' : p?.title ?? 'Ocurrió un error inesperado');
    const correlacion = (p as { correlation_id?: string } | null)?.correlation_id ?? err.headers?.get('X-Correlation-Id') ?? undefined;
    const conCodigo = correlacion && err.status >= 500 ? `${mensaje} (código de soporte: ${correlacion})` : mensaje;
    return { status: err.status, code: p?.code ?? 'ERROR', mensaje: conCodigo, campos, correlacion };
  }
  return { status: 0, code: 'ERROR', mensaje: 'Ocurrió un error inesperado', campos: {} };
}
