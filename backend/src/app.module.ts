import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { CommonModule } from './common/common.module';
import { JwtAuthGuard, RolesGuard, ScopesGuard } from './common/auth/guards';
import { ProblemDetailsFilter } from './common/problem/problem-details.filter';
import { validarEntorno } from './config/entorno';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthController } from './modules/health/health.controller';
import { AlojamientosModule } from './modules/alojamientos/alojamientos.module';
import { AlojamientosV2Module } from './modules/alojamientos-v2/alojamientos-v2.module';
import { StockGrpcModule } from './modules/stock-grpc/stock-grpc.module';
import { CuentaModule } from './modules/cuenta/cuenta.module';
import { HostModule } from './modules/host/host.module';
import { AdminModule } from './modules/admin/admin.module';
import { JobsModule } from './modules/jobs/jobs.module';
// Módulos de otros grupos (no se compilan: ver tsconfig.build.json)
// import { AutosModule } from './modules/autos/autos.module';
// import { AtraccionesModule } from './modules/atracciones/atracciones.module';
// import { VuelosModule } from './modules/vuelos/vuelos.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env', validate: validarEntorno }),
    // Rate limiting global: ~100 peticiones por minuto por IP
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    ScheduleModule.forRoot(),
    DatabaseModule,
    CommonModule,
    AuthModule,
    AlojamientosModule,
    AlojamientosV2Module,
    StockGrpcModule,
    CuentaModule,
    HostModule,
    AdminModule,
    JobsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Orden: rate limit -> autenticación -> rol -> scopes
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ScopesGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
