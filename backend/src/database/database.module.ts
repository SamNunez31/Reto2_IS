import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { types } from 'pg';
import { DbService } from './db.service';

// Tipos de Postgres -> JS: fechas como 'YYYY-MM-DD' (sin zona), numeric y bigint como number.
types.setTypeParser(1082, (v: string) => v);
types.setTypeParser(1700, (v: string) => Number(v));
types.setTypeParser(20, (v: string) => Number(v));

const HOSTS_LOCALES = ['localhost', '127.0.0.1', '::1', '[::1]'];

/** SSL solo fuera de localhost: Postgres de Docker no tiene TLS; Supabase lo exige. */
export function usarSsl(url: string | undefined): boolean {
  if (process.env.DB_SSL === 'false') return false; // docker compose: el host es "postgres", no localhost
  try {
    return !HOSTS_LOCALES.includes(new URL(url ?? '').hostname);
  } catch {
    return true;
  }
}

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        ssl: usarSsl(config.get<string>('DATABASE_URL')) ? { rejectUnauthorized: false } : false,
        // NUNCA true: alteraría el esquema real en Supabase
        synchronize: false,
        migrationsRun: false,
        autoLoadEntities: false,
        entities: [],
        // El pooler de Supabase (modo sesion) solo admite 15 clientes en total y hay 4 apps
        // compartiendo la BD: el tope por app debe ser pequeno (4 x 3 = 12 < 15). Ajustable por env.
        extra: {
          options: '-c search_path=booking,public,extensions',
          max: Number(process.env.DB_POOL_MAX) > 0 ? Number(process.env.DB_POOL_MAX) : 3,
          idleTimeoutMillis: 5000,
          connectionTimeoutMillis: 8000,
        },
      }),
    }),
  ],
  providers: [DbService],
  exports: [DbService],
})
export class DatabaseModule {}
