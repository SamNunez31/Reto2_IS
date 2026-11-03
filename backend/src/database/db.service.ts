import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

/** Ejecuta SQL parametrizado ($1, $2...) dentro de una conexión o transacción. */
export type Consulta = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

export const TABLAS_ESPERADAS = 28; // 25 base + cotizacion_v2 y orden_v2 (04) + contrato_promociones (05_v2_checkin.sql)

/**
 * Acceso a datos: SQL parametrizado sobre el DataSource de TypeORM.
 * La lógica crítica vive en la BD (funciones fn_* y vistas v_*); aquí solo se invocan.
 */
@Injectable()
export class DbService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DbService.name);

  constructor(private readonly dataSource: DataSource) {}

  /** Filas devueltas por la consulta (SELECT, o INSERT/UPDATE/DELETE ... RETURNING). */
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const qr = this.dataSource.createQueryRunner();
    try {
      return await this.ejecutar<T>(qr, sql, params);
    } finally {
      await qr.release();
    }
  }

  /** Primera fila o null. */
  async uno<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const filas = await this.query<T>(sql, params);
    return filas[0] ?? null;
  }

  /** Ejecuta `trabajo` en una transacción; si lanza, hace ROLLBACK. */
  async transaccion<R>(trabajo: (q: Consulta) => Promise<R>): Promise<R> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const resultado = await trabajo(<T>(sql: string, params: unknown[] = []) => this.ejecutar<T>(qr, sql, params));
      await qr.commitTransaction();
      return resultado;
    } catch (e) {
      await qr.rollbackTransaction();
      throw e;
    } finally {
      await qr.release();
    }
  }

  /** Ejecuta `trabajo` y SIEMPRE deshace los cambios (simulaciones, p. ej. previsualizar una cancelación). */
  async simular<R>(trabajo: (q: Consulta) => Promise<R>): Promise<R> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      return await trabajo(<T>(sql: string, params: unknown[] = []) => this.ejecutar<T>(qr, sql, params));
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  }

  private async ejecutar<T>(qr: QueryRunner, sql: string, params: unknown[]): Promise<T[]> {
    const r = await qr.query(sql, params, true);
    return (r.records ?? []) as T[];
  }

  /** Verificación de arranque: el schema booking debe tener las 25 tablas. */
  async onApplicationBootstrap(): Promise<void> {
    const fila = await this.uno<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'booking' AND table_type = 'BASE TABLE'`,
    );
    if (fila?.n !== TABLAS_ESPERADAS) {
      const msg = `La BD tiene ${fila?.n ?? 0} tablas en booking (se esperaban ${TABLAS_ESPERADAS}). Si aún existen las tablas aeropuerto y alojamiento_aeropuerto, ejecuta database/migracion_sin_aeropuertos.sql; si aún existe la tabla reporte, ejecuta database/migracion_admin_dueno.sql y database/migracion_sin_reportes.sql; si aún existe alojamiento_codigo, ejecuta antes database/migracion_codigo_en_alojamiento.sql; si faltan las tablas de integración, ejecuta 03_integracion.sql; si faltan cotizacion_v2 y orden_v2, ejecuta 04_v2_integracion.sql; si falta contrato_promociones, ejecuta 05_v2_checkin.sql.`;
      this.logger.error(msg);
      throw new Error(msg);
    }
    this.logger.log(`BD verificada: ${fila.n} tablas en el schema booking`);
  }
}
