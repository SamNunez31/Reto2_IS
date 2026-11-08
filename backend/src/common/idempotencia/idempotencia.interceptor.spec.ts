import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { lastValueFrom, of } from 'rxjs';
import { DbService } from '../../database/db.service';
import { IdempotenciaInterceptor, PLAZO_EN_PROCESO_MIN } from './idempotencia.interceptor';

const CLAVE = '11111111-1111-4111-8111-111111111111';

/** BD falsa: responde a cada consulta según un guion de respuestas ordenado. */
function dbFalsa(respuestas: unknown[][]): { db: DbService; sql: string[]; params: unknown[][] } {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const cola = [...respuestas];
  const query = jest.fn(async (s: string, p: unknown[]) => {
    sql.push(s);
    params.push(p);
    return cola.shift() ?? [];
  });
  const db = { query, uno: async (s: string, p: unknown[]) => (await query(s, p))[0] ?? null } as unknown as DbService;
  return { db, sql, params };
}

function contexto(): { ctx: ExecutionContext; res: { status: jest.Mock; setHeader: jest.Mock } } {
  const res = { status: jest.fn(), setHeader: jest.fn() };
  const req = { user: { sub: 'u1' }, path: '/api/v2/alojamientos/orders/create', body: { a: 1 }, header: (n: string) => (n === 'idempotency-key' ? CLAVE : undefined) };
  const ctx = { getHandler: () => () => undefined, switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as unknown as ExecutionContext;
  return { ctx, res };
}

function interceptor(db: DbService): IdempotenciaInterceptor {
  const reflector = { get: (clave: string) => (clave === 'operacionIdempotente' ? 'orders.create' : undefined) } as unknown as Reflector;
  return new IdempotenciaInterceptor(reflector, db);
}

describe('IdempotenciaInterceptor — claves "en proceso" huérfanas', () => {
  it('clave nueva: ejecuta la operación y guarda la respuesta', async () => {
    const { db, sql } = dbFalsa([[{ clave: CLAVE }], []]); // INSERT ok, UPDATE de la respuesta
    const { ctx } = contexto();
    const next: CallHandler = { handle: () => of({ ok: true }) };
    const r = await lastValueFrom(interceptor(db).intercept(ctx, next));
    expect(r).toEqual({ ok: true });
    expect(sql[0]).toMatch(/INSERT INTO idempotencia/);
    expect(sql[1]).toMatch(/UPDATE idempotencia SET estado_http/);
  });

  it('clave "en proceso" con más de PLAZO minutos: se reclama y la operación se vuelve a ejecutar', async () => {
    const { db, sql, params } = dbFalsa([[], [{ clave: CLAVE }], []]); // INSERT sin fila, reclamo con fila, UPDATE de la respuesta
    const { ctx } = contexto();
    const next: CallHandler = { handle: () => of({ ok: 'reintento' }) };
    const r = await lastValueFrom(interceptor(db).intercept(ctx, next));
    expect(r).toEqual({ ok: 'reintento' });
    expect(sql[1]).toMatch(/estado_http IS NULL/);
    expect(sql[1]).toMatch(/make_interval/);
    expect(params[1]).toContain(PLAZO_EN_PROCESO_MIN);
  });

  it('clave "en proceso" reciente: no se reclama y responde 409 IN_PROGRESS', async () => {
    const hash = createHash('sha256').update(JSON.stringify({ ruta: '/api/v2/alojamientos/orders/create', cuerpo: { a: 1 } })).digest('hex');
    const previa = { hash_solicitud: hash, estado_http: null, respuesta: null };
    // INSERT sin fila, reclamo sin fila (aún no vence), SELECT de la fila previa
    const { db } = dbFalsa([[], [], [previa]]);
    const { ctx } = contexto();
    const next: CallHandler = { handle: jest.fn(() => of({})) };
    await expect(lastValueFrom(interceptor(db).intercept(ctx, next))).rejects.toMatchObject({ status: 409 });
    expect(next.handle).not.toHaveBeenCalled();
  });
});
