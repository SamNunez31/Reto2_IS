import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Request, Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';
import { construirProblema, ProblemBody, ProblemCode, ProblemException } from './problem';
import { aCodigoV1, esRutaV2, formatoV2 } from './problem-v2';
import { traducirErrorPostgres } from './postgres-errors';
import { logJson } from '../logging/log-json';
import { auditar } from '../logging/auditoria';

/**
 * Filtro global: TODA respuesta de error sale como application/problem+json
 * con la forma de ProblemDetails. Nunca se filtra stack ni SQL al cliente.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const { body, retryAfter } = this.aProblema(exception, req);
    // El login fallido ya se audita como "login_fallido" en AuthController
    if ((body.status === 401 || body.status === 403) && !req.path.endsWith('/auth/login')) {
      auditar(body.status === 401 ? 'acceso_401' : 'acceso_403', req, { detail: body.detail });
    }

    if (retryAfter !== undefined) res.setHeader('Retry-After', String(retryAfter));
    // Misma excepción, dos "vestidos": contrato v2 en /api/v2 y contrato v1 (enum cerrado) en el resto
    let salida: unknown;
    if (esRutaV2(req.path)) salida = formatoV2(body, req, retryAfter);
    else {
      const { extras: _extras, ...v1 } = body;
      void _extras;
      salida = { ...v1, code: aCodigoV1(body.code) };
    }
    res.status(body.status).type('application/problem+json').send(JSON.stringify(salida));
  }

  private aProblema(exception: unknown, req: Request): { body: ProblemBody; retryAfter?: number } {
    if (exception instanceof ProblemException) {
      return { body: exception.getResponse() as ProblemBody, retryAfter: exception.retryAfter };
    }
    if (exception instanceof ThrottlerException) {
      return {
        body: construirProblema(429, 'RATE_LIMIT_EXCEEDED', 'Has superado el límite de peticiones; intenta en un minuto'),
        retryAfter: 60,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();
      const detalle = typeof resp === 'string' ? resp : this.mensajeDe(resp);
      const code: ProblemCode = status === 429 ? 'RATE_LIMIT_EXCEEDED' : 'VALIDATION_FAILED';
      return { body: construirProblema(status, code, status >= 500 ? 'Error interno del servidor' : detalle) };
    }
    const pg = traducirErrorPostgres(exception);
    if (pg) {
      return { body: construirProblema(pg.status, pg.code, pg.detail, pg.invalidParams), retryAfter: pg.retryAfter };
    }
    logJson('error', 'error_no_controlado', {
      correlation_id: req.correlationId,
      path: req.path,
      error: exception instanceof Error ? exception.message : String(exception),
    });
    return { body: construirProblema(500, 'VALIDATION_FAILED', 'Error interno del servidor') };
  }

  private mensajeDe(resp: object): string | undefined {
    const m = (resp as { message?: string | string[] }).message;
    if (Array.isArray(m)) return m.join('; ');
    return m;
  }
}
