import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { crearValidationPipe } from './common/validation/validation';
import { correlacionMiddleware, errorParserMiddleware, redireccionHttpsMiddleware } from './common/middleware/http-middlewares';
import { rolServicioMiddleware } from './common/middleware/rol-servicio';
import { auditoriaOperacionesMiddleware } from './common/logging/auditoria';
import { metricasHandler, metricasMiddleware } from './common/metricas/metricas';
import { esProduccion, origenesCors } from './config/entorno';
import { montarSwagger } from './swagger';
import { logJson } from './common/logging/log-json';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const produccion = esProduccion();

  app.set('trust proxy', 1); // Render/Vercel están detrás de un proxy: IP real para el rate limit
  app.use(correlacionMiddleware);
  app.use('/metrics', metricasHandler); // S10: Prometheus; NO se enruta por el gateway
  app.use(metricasMiddleware);
  app.use(auditoriaOperacionesMiddleware); // S11: auditoría de operaciones críticas /api/v2
  app.use(rolServicioMiddleware); // Reto 2: SERVICE_ROLE limita las rutas de cada microservicio
  if (produccion) app.use(redireccionHttpsMiddleware);
  app.use(
    helmet({
      hsts: produccion ? { maxAge: 15_552_000, includeSubDomains: true } : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(errorParserMiddleware);

  app.enableCors({
    origin: origenesCors(),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Device-Fingerprint', 'X-Correlation-Id'],
    exposedHeaders: ['X-Correlation-Id', 'Retry-After', 'Idempotent-Replayed', 'X-API-Deprecation-Date'],
  });

  // /api/v2/* (contrato v2 del Reto 2) lleva su propio prefijo en el controlador: se excluye del prefijo global api/v1
  app.setGlobalPrefix('api/v1', { exclude: ['health', { path: 'api/v2/(.*)', method: RequestMethod.ALL }] });
  app.useGlobalPipes(crearValidationPipe());
  app.enableShutdownHooks();
  montarSwagger(app);

  // Reto 2: escuchar en 0.0.0.0 (no solo en localhost) para que Booking y otras maquinas puedan llamarnos
  // por la red privada (Tailscale). Se puede cambiar con HOST en el .env.
  const puerto = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(puerto, host);
  logJson('info', 'servidor_escuchando', { host, puerto });
}
bootstrap();
