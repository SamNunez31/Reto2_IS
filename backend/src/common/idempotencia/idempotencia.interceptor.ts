import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { Request, Response } from 'express';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { DbService } from '../../database/db.service';
import { construirProblema, ProblemBody, ProblemException } from '../problem/problem';
import { traducirErrorPostgres } from '../problem/postgres-errors';

export const OPERACION_IDEMPOTENTE = 'operacionIdempotente';
/** Marca una operación como idempotente (tabla `idempotencia`), p. ej. @Idempotente('orders.create'). */
export const Idempotente = (operacion: string) => SetMetadata(OPERACION_IDEMPOTENTE, operacion);

interface FilaIdem {
  hash_solicitud: string;
  estado_http: number | null;
  respuesta: unknown;
}

/**
 * Idempotency-Key persistente:
 *  - misma clave + mismo cuerpo  -> se reproduce la respuesta guardada (cabecera Idempotent-Replayed: true)
 *  - misma clave + otro cuerpo   -> 409
 *  - clave aún en proceso        -> 409 + Retry-After
 *  - error 5xx                   -> se borra la fila para permitir reintentar
 */
@Injectable()
export class IdempotenciaInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const operacion = this.reflector.get<string>(OPERACION_IDEMPOTENTE, ctx.getHandler());
    if (!operacion) return next.handle();

    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const propietario = req.user?.sub ?? 'anonimo';
    const clave = req.header('idempotency-key') as string;
    const hash = createHash('sha256').update(JSON.stringify({ ruta: req.path, cuerpo: req.body ?? null })).digest('hex');
    const estadoExito = this.reflector.get<number>(HTTP_CODE_METADATA, ctx.getHandler()) ?? 200;

    return from(this.reservar(propietario, clave, operacion, hash)).pipe(
      mergeMap((previa) => {
        if (previa) return this.reproducir(previa, hash, res, req.path.startsWith('/api/v2/'));
        return next.handle().pipe(
          mergeMap(async (cuerpo) => {
            await this.db.query(
              `UPDATE idempotencia SET estado_http = $3, respuesta = $4::jsonb WHERE propietario = $1 AND clave = $2`,
              [propietario, clave, estadoExito, JSON.stringify(cuerpo ?? null)],
            );
            return cuerpo;
          }),
          catchError((err: unknown) => from(this.registrarError(propietario, clave, err)).pipe(mergeMap(() => throwError(() => err)))),
        );
      }),
    );
  }

  /** Inserta la clave; si ya existía devuelve la fila previa. */
  private async reservar(propietario: string, clave: string, operacion: string, hash: string): Promise<FilaIdem | null> {
    const insertada = await this.db.query<{ clave: string }>(
      `INSERT INTO idempotencia (propietario, clave, operacion, hash_solicitud) VALUES ($1, $2, $3, $4)
       ON CONFLICT (propietario, clave) DO NOTHING RETURNING clave`,
      [propietario, clave, operacion, hash],
    );
    if (insertada.length) return null;
    return this.db.uno<FilaIdem>(
      `SELECT hash_solicitud, estado_http, respuesta FROM idempotencia WHERE propietario = $1 AND clave = $2`,
      [propietario, clave],
    );
  }

  private reproducir(previa: FilaIdem, hash: string, res: Response, v2: boolean): Observable<unknown> {
    if (previa.hash_solicitud !== hash) {
      return throwError(() =>
        v2
          ? new ProblemException(422, 'IDEMPOTENCY_KEY_REUSED', 'La clave ya se usó con un cuerpo distinto. Genere una nueva para una nueva intención.')
          : new ProblemException(409, 'VALIDATION_FAILED', 'La Idempotency-Key ya se usó con otra petición distinta'),
      );
    }
    if (previa.estado_http === null) {
      return throwError(() =>
        new ProblemException(409, v2 ? 'IDEMPOTENCY_IN_PROGRESS' : 'VALIDATION_FAILED', 'La petición con esta Idempotency-Key aún se está procesando', undefined, 1),
      );
    }
    res.setHeader('Idempotent-Replayed', 'true');
    if (previa.estado_http >= 400) {
      const p = previa.respuesta as ProblemBody;
      return throwError(() => new ProblemException(p.status, p.code, p.detail, p.invalidParams, undefined, p.extras));
    }
    res.status(previa.estado_http);
    return of(previa.respuesta);
  }

  /** Errores 4xx se guardan (se reproducen igual); 5xx o desconocidos liberan la clave. */
  private async registrarError(propietario: string, clave: string, err: unknown): Promise<void> {
    let cuerpo: ProblemBody | null = null;
    if (err instanceof ProblemException) cuerpo = err.getResponse() as ProblemBody;
    else if (err instanceof HttpException && err.getStatus() < 500) cuerpo = construirProblema(err.getStatus(), 'VALIDATION_FAILED', err.message);
    else {
      const pg = traducirErrorPostgres(err);
      if (pg) cuerpo = construirProblema(pg.status, pg.code, pg.detail, pg.invalidParams);
    }
    if (!cuerpo || cuerpo.status >= 500) {
      await this.db.query(`DELETE FROM idempotencia WHERE propietario = $1 AND clave = $2`, [propietario, clave]);
      return;
    }
    await this.db.query(
      `UPDATE idempotencia SET estado_http = $3, respuesta = $4::jsonb WHERE propietario = $1 AND clave = $2`,
      [propietario, clave, cuerpo.status, JSON.stringify(cuerpo)],
    );
  }
}
