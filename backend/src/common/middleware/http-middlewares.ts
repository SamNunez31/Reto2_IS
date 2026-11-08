import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { construirProblema } from '../problem/problem';
import { logJson } from '../logging/log-json';

declare module 'express-serve-static-core' {
  interface Request {
    correlationId?: string;
  }
}

const CORRELACION_VALIDA = /^[A-Za-z0-9._:-]{4,64}$/;

/** Toma X-Correlation-Id del cliente (si es válido) o genera uno; lo devuelve y registra la petición. */
export function correlacionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const recibido = req.header('x-correlation-id');
  const id = recibido && CORRELACION_VALIDA.test(recibido) ? recibido : randomUUID();
  req.correlationId = id;
  res.setHeader('X-Correlation-Id', id);
  const inicio = Date.now();
  res.on('finish', () => {
    logJson('info', 'http', {
      correlation_id: id,
      method: req.method,
      path: req.path, // sin query string: puede llevar datos personales
      status: res.statusCode,
      ms: Date.now() - inicio,
    });
  });
  next();
}

/** En producción (detrás del proxy/ingress) redirige HTTP -> HTTPS. */
export function redireccionHttpsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.header('x-forwarded-proto') === 'http') {
    res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
    return;
  }
  next();
}

/** Errores del parser JSON (cuerpo mal formado o > 100 kb) también como ProblemDetails. */
export function errorParserMiddleware(err: { type?: string; status?: number }, _req: Request, res: Response, next: NextFunction): void {
  if (!err || !err.type) {
    next(err);
    return;
  }
  const status = err.type === 'entity.too.large' ? 413 : 400;
  const detail = status === 413 ? 'El cuerpo supera el límite de 100 kb' : 'El cuerpo no es un JSON válido';
  res.status(status).type('application/problem+json').send(JSON.stringify(construirProblema(status, 'VALIDATION_FAILED', detail)));
}
