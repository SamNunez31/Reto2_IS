import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, retry, throwError, timer } from 'rxjs';
import { API } from '../services/api-base';
import { AuthService } from '../services/auth.service';
import { DispositivoService } from '../services/dispositivo.service';

/** Errores típicos del arranque en frío del servidor (Azure escala a 0 réplicas). */
const ESTADOS_REINTENTABLES = [0, 408, 502, 503, 504];

/**
 * - Agrega Authorization (Bearer) y X-Device-Fingerprint a las llamadas al API.
 * - 401 -> cierra sesión y lleva al login (salvo en el propio login).
 * - 403 -> pantalla de acceso denegado.
 * - GET: hasta 2 reintentos (1,5 s y 3 s) si el servidor aún está despertando.
 * - Las operaciones que escriben (POST/PUT/DELETE) NO se reintentan, para no duplicarlas.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(API)) return next(req);
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token();
  const headers: Record<string, string> = { 'X-Device-Fingerprint': inject(DispositivoService).huella() };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  return next(req.clone({ setHeaders: headers })).pipe(
    retry({
      count: req.method === 'GET' ? 2 : 0,
      delay: (err: unknown, intento: number) =>
        err instanceof HttpErrorResponse && ESTADOS_REINTENTABLES.includes(err.status) ? timer(1500 * intento) : throwError(() => err),
    }),
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse) {
        if (err.status === 401 && !req.url.includes('/auth/')) auth.logout(router.url);
        if (err.status === 403) {
          router.navigate(['/acceso-denegado'], { state: { detalle: (err.error as { detail?: string } | null)?.detail } });
        }
      }
      return throwError(() => err);
    }),
  );
};
