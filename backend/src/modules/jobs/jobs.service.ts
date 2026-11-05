import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { logJson } from '../../common/logging/log-json';
import { noEncontrado } from '../../common/problem/problem';
import { Consulta, DbService } from '../../database/db.service';
import { NotificadorCheckin } from '../integracion/notificador-checkin';
import { BusEventos, EventoNegocio } from './bus-eventos';

export const JOBS = ['completar-estancias', 'publicar-outbox', 'purgar-idempotencia', 'notificar-checkin'] as const;
export type NombreJob = (typeof JOBS)[number];

/** Llave numérica de pg_try_advisory_xact_lock por job (evita que dos instancias lo corran a la vez). */
const LLAVE: Record<NombreJob, number> = {
  'completar-estancias': 71002,
  'publicar-outbox': 71003,
  'purgar-idempotencia': 71004,
  'notificar-checkin': 71005,
};

export interface ResultadoJob {
  job: NombreJob;
  ejecutado: boolean;
  afectados: number;
}

/**
 * Jobs periódicos. Cada uno corre dentro de una transacción con pg_try_advisory_xact_lock:
 * si otra instancia ya lo tiene, se salta. (Se usa la variante "xact" porque el pooler de
 * Supabase en modo transacción no conserva bloqueos de sesión.)
 */
@Injectable()
export class JobsService {
  private readonly habilitados: boolean;

  constructor(
    private readonly db: DbService,
    private readonly bus: BusEventos,
    private readonly checkin: NotificadorCheckin,
    config: ConfigService,
  ) {
    // Reto 2: los jobs (outbox, completar estancias) solo corren en el servicio de integración o en el monolito
    const rol = (process.env.SERVICE_ROLE ?? '').trim().toLowerCase();
    this.habilitados = config.get<string>('JOBS_ENABLED') !== 'false' && (rol === '' || rol === 'all' || rol === 'integration');
  }

  @Cron(CronExpression.EVERY_HOUR)
  completarProgramado(): Promise<void> {
    return this.programado('completar-estancias');
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  outboxProgramado(): Promise<void> {
    return this.programado('publicar-outbox');
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  checkinProgramado(): Promise<void> {
    return this.programado('notificar-checkin');
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  purgaProgramada(): Promise<void> {
    return this.programado('purgar-idempotencia');
  }

  /** Ejecución manual (panel admin). */
  async ejecutar(nombre: string): Promise<ResultadoJob> {
    if (!(JOBS as readonly string[]).includes(nombre)) throw noEncontrado(`Job desconocido. Disponibles: ${JOBS.join(', ')}`);
    return this.correr(nombre as NombreJob);
  }

  private async programado(nombre: NombreJob): Promise<void> {
    if (!this.habilitados) return;
    try {
      const r = await this.correr(nombre);
      if (r.afectados > 0) logJson('info', 'job', { ...r });
    } catch (e) {
      logJson('error', 'job_fallido', { job: nombre, error: e instanceof Error ? e.message : String(e) });
    }
  }

  private correr(nombre: NombreJob): Promise<ResultadoJob> {
    return this.db.transaccion(async (q) => {
      const [{ ok }] = await q<{ ok: boolean }>(`SELECT pg_try_advisory_xact_lock($1) AS ok`, [LLAVE[nombre]]);
      if (!ok) return { job: nombre, ejecutado: false, afectados: 0 };
      const afectados = await this.trabajo(nombre, q);
      return { job: nombre, ejecutado: true, afectados };
    });
  }

  private async trabajo(nombre: NombreJob, q: Consulta): Promise<number> {
    switch (nombre) {
      case 'completar-estancias':
        return (await q<{ n: number }>(`SELECT fn_completar_estancias() AS n`))[0].n;
      case 'purgar-idempotencia':
        return (await q(`DELETE FROM idempotencia WHERE creado_en < now() - interval '24 hours' RETURNING clave`)).length;
      case 'publicar-outbox':
        return this.publicarOutbox(q);
      case 'notificar-checkin':
        return this.checkin.reintentarPendientes();
    }
  }

  /** Outbox: lee eventos no publicados, los entrega al bus y marca publicado_en (en la misma transacción). */
  private async publicarOutbox(q: Consulta): Promise<number> {
    const eventos = await q<EventoNegocio>(
      `SELECT id, tipo, agregado, agregado_id, correlacion_id, payload, created_at
         FROM evento_outbox WHERE publicado_en IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`,
    );
    if (!eventos.length) return 0;
    for (const e of eventos) await this.bus.publicar(e);
    await q(`UPDATE evento_outbox SET publicado_en = now() WHERE id = ANY($1::bigint[])`, [eventos.map((e) => e.id)]);
    return eventos.length;
  }
}
