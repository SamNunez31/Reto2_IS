# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Contexto

Posada EC: plataforma de alojamientos en Ecuador (proyecto académico PUCE, Integración de Sistemas). Nodo `NODE_ALO_PEC`, vertical ALOJAMIENTOS del contrato Booking v2.2.0. Los pagos y las facturas son **simulados**.

**El código, los comentarios, los nombres de archivos/símbolos y los mensajes de commit están en español.** Mantener esa convención (`servicios`, `cotizacion`, `alojamiento`, `rol-servicio.ts`, etc.).

## Comandos

### Backend (`cd backend`, NestJS 10, Node 20+)

```bash
npm ci
npm run start:dev          # http://localhost:3000 · Swagger /api/docs · /health
npm run lint               # eslint "src/**/*.ts"
npm run format             # prettier --write (solo backend)
npm test                   # jest (testRegex .*\.spec\.ts$, rootDir src)
npm test -- ruta/al/archivo.spec.ts          # un archivo
npm test -- -t "nombre del test"             # un test por nombre
npm run build
```

Cadena de contratos y gateway (todas corren en CI; conviene ejecutarlas antes de hacer push cuando se tocan rutas):

```bash
npm run docs:openapi       # compila y genera docs/openapi.json (no necesita BD)
npm run contract:export    # docs/openapi.json -> backend/contracts/posada-ec-openapi.yaml
npm run contract:check     # falla si el YAML y el OpenAPI generado divergen
npm run contract:split     # divide el contrato por servicio
npm run gateway:generar    # genera gateway/kong.tmpl.yml desde rol-servicio.ts
npm run gateway:check      # falla si kong.tmpl.yml está desalineado
npm run test:roles         # verifica el reparto de rutas por SERVICE_ROLE
npm run pact:verificar     # verificación Pact del consumidor Booking
npm run test:v2            # prueba end-to-end del canal v2
npm run stock:falso        # servidor falso de ingesta de stock de Booking
```

### Frontend (`cd frontend`, Angular 19)

```bash
npm ci
npm start                  # http://localhost:4200, proxy /api -> localhost:3000 (proxy.conf.json)
npm run lint
npm test                   # Karma + Jasmine
npx ng test --watch=false --browsers=ChromeHeadless                    # una sola corrida (como CI)
npx ng test --watch=false --browsers=ChromeHeadless --include='**/fechas.spec.ts'   # un archivo
npm run build
```

En Windows sin Chrome instalado, antes de `ng test`:
`$env:CHROME_BIN='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'`

### Base de datos

```bash
docker compose up -d       # booking_db_container (postgres:16) + scripts iniciales de database/
docker compose down -v     # borra el volumen pgdata y recrea todo al volver a subir
docker compose -f docker-compose.microservicios.yml up -d   # Kong + los 4 servicios + postgres
```

Aplicar un script suelto al contenedor (PowerShell):
`Get-Content database\<archivo>.sql -Raw | docker exec -i booking_db_container psql -U postgres -d booking_db -v ON_ERROR_STOP=1`

## Arquitectura

### Monolito modular desplegado como 4 microservicios

Un solo repositorio y **una sola imagen Docker**. Cada despliegue arranca con un `SERVICE_ROLE` distinto (`identity`, `catalog`, `reservations`, `integration`) y solo atiende las rutas de su servicio; cualquier otra responde 404 `application/problem+json`. `SERVICE_ROLE` vacío o `all` = monolito.

**`backend/src/common/middleware/rol-servicio.ts` es la única fuente de verdad del reparto de rutas.** La tabla `REGLAS` (orden = prioridad) decide qué servicio atiende cada ruta; `gateway/kong.tmpl.yml` se **genera** desde ese archivo y CI falla si divergen. Al añadir o mover una ruta: editar `REGLAS`, correr `gateway:generar` y `test:roles`.

Los jobs (publicar el outbox cada 5 s, completar estancias, purgar idempotencia) solo corren en `integration`; en los demás `JOBS_ENABLED` se ignora.

Limitación conocida: los 4 servicios comparten el schema `booking`. La propiedad de tablas por servicio es convención, no permisos de BD (ver `docs/ARQUITECTURA_MICROSERVICIOS.md` §4).

### Backend

- **Acceso a datos: SQL parametrizado, no entidades TypeORM.** `DbService` (`src/database/db.service.ts`) expone `query`, `uno`, `transaccion` y `simular` (ejecuta y siempre hace ROLLBACK, para previsualizaciones como la de una cancelación). **La lógica crítica vive en la base de datos** en funciones `fn_*` y vistas `v_*`; los servicios solo las invocan. Al arrancar se valida el número de tablas (`TABLAS_ESPERADAS` / `TABLAS_ACEPTADAS`).
- **Guards globales en `app.module.ts`, en este orden**: `ThrottlerGuard` → `JwtAuthGuard` → `RolesGuard` → `ScopesGuard`. Los decoradores de `src/common/auth/decorators.ts` marcan rutas públicas, roles y scopes.
- **Errores**: `ProblemDetailsFilter` global convierte todo a RFC 7807 (`problem.ts`, `problem-v2.ts` para el canal v2, `postgres-errors.ts` mapea códigos de Postgres). Las respuestas llevan `X-Correlation-Id` de extremo a extremo.
- **Idempotencia**: `IdempotencyKeyGuard` + `IdempotenciaInterceptor` sobre la tabla `idempotencia`. Toda operación de escritura del contrato exige `Idempotency-Key`.
- **Dos canales de API**: `/api/v1` (contrato original, con `DeprecacionInterceptor` y cabecera `X-API-Deprecation-Date`) y `/api/v2` (canal Booking, módulo `alojamientos-v2`, autenticable también con `X-API-Key`). `/api/v2` no permite check-in ni admin por API key.
- **Integración saliente**: el módulo `jobs` publica el outbox (`evento_outbox`) como CloudEvents y `integracion/` + `stock-grpc/` empujan stock y check-in/check-out a Booking, por REST (`STOCK_REST_URL`, preferido) o gRPC (`STOCK_GRPC_TARGET`). `AMQP_URL` vacío = bus de eventos en memoria.
- **Contratos** en `backend/contracts/`: `alojamientos-openapi.yaml` es el contrato oficial del curso, **no editar**; `posada-ec-openapi.yaml` es el contrato propio y se **genera** (`contract:export`).

### Frontend

Angular 19 standalone, componentes cargados con `loadComponent`/`loadChildren` en `app.routes.ts`, protegidos por `authGuard`/`roleGuard`/`perfilGuard` (`core/guards/guards.ts`). Bootstrap 5 + `styles.css` global (sin librería de componentes).

- **Solo la capa de servicios conoce el API**: `core/services/api-base.ts` exporta `API`, `cabecerasIdempotentes()` (un `crypto.randomUUID()` nuevo por acción del usuario) y `leerError()`, que traduce cualquier `ProblemDetails` a un `ErrorVista` con mensaje y errores por campo. Los componentes no construyen URLs ni leen errores HTTP a mano.
- **`api.interceptor.ts`** agrega `Authorization` y `X-Device-Fingerprint`, reintenta **solo GET** (2 veces, 1,5 s y 3 s) ante arranques en frío del servidor (estados 0/408/502/503/504) y nunca reintenta escrituras; 401 cierra sesión, 403 lleva a acceso denegado.
- **Observabilidad local**: `observabilidad.service.ts` + su interceptor guardan tiempos, errores, clics y llamadas al API en `localStorage` (prefijo `posada-observability`, máx. 300 eventos). **No se envía a ningún servidor.** Inspección: `window.PosadaObservability.getSnapshot()`.
- `environments/environment.ts` apunta al gateway de Azure en producción; `environment.development.ts` al backend local.
- El portal de anfitriones externos es evolución futura: `/anfitrion/**` muestra un aviso. El **admin** es el dueño del catálogo (`/admin/alojamientos` reutiliza el editor de anfitrión).

### Reglas de negocio que no se deducen del código

- **Dos actores**: admin (operador, dueño del catálogo) y huésped. Confirmación de reserva **inmediata** al aprobarse el pago; no hay flujo de solicitud ni moderación de reseñas.
- **Pago**: tarjeta simulada (reserva queda pagada) o efectivo (reserva confirmada, pago `PENDIENTE` hasta `POST /host/orders/:id/confirm-payment`). Cancelar una reserva en efectivo pendiente no genera reembolso.
- **IVA 8 % en feriados**: el admin registra el feriado con fechas y aplica a todos los alojamientos en ese rango.
- **Tipos de alojamiento**: catálogo cerrado de 5 (Hotel, Hostal, Cabaña, Casa, Departamento).
- Geocodificación con Nominatim restringida a Ecuador, con 800 ms de espera entre pulsaciones y máximo 1 petición por segundo.

## Base de datos

`database/` son scripts SQL **ya ejecutados** en Supabase y aplicados a mano; no hay herramienta de migraciones. Los numerados (`01_`…`09_`) son el orden de creación; `migracion_*.sql` y `datos_*.sql` son parches posteriores que deben ser **idempotentes y envueltos en una transacción**. Al crear uno nuevo, seguir esa convención y documentar en el README en qué orden se aplica sobre una BD existente.

## CI

`.github/workflows/ci.yml` corre en cada push y PR. Backend: `lint`, `test`, `build`, `contract:check`, `gateway:check`, `test:roles`. Frontend: `lint`, `ng test --browsers=ChromeHeadless`, `build`.

## Documentación

`docs/DOCUMENTO_TECNICO.md` (técnico general, §14 observabilidad), `docs/ARQUITECTURA_MICROSERVICIOS.md` (Reto 2: servicios, gateway, políticas de Kong), `AUDITORIA.md` (Parte A accesibilidad/UX del frontend, Parte B backend/API/BD/dependencias; los hallazgos se citan por código, p. ej. `BE-M1`).
