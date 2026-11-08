# Bitácora Reto 2 · Posada EC

Registro de decisiones y cambios sobre la base entregada en el Reto 1 (etiqueta git `reto1-entregado`).
Se trabaja en la rama `reto-2` y en la carpeta `Reto2_IS`; `Reto1_IS` no se modifica.

## 2026-10-26 · Bloque 0 y 1: versionado y preparación local
- `Reto2_IS` es una copia de `Reto1_IS` en el commit `49f6450` (etiqueta `reto1-entregado`), rama `reto-2`.
- `core.autocrlf=true` en la copia para que Windows no marque todos los archivos como modificados.
- BD local propia de Reto 2: contenedor `posada_reto2_db`, puerto `5433`, BD `posada_reto2` (no toca Supabase ni la BD del Reto 1).
- `backend/src/main.ts`: el servidor escucha en `HOST` (por defecto `0.0.0.0`) y registra `servidor_escuchando`.
- `backend/.env` local con `APP_ENV=development` y un `JWT_SECRET` nuevo (el `.env` no se versiona).
- Verificado en una copia de trabajo: `npm run build`, `npm run lint` y `npm test` (11 suites, 60 pruebas) sin errores.
- Pendiente de verificar con Tailscale: acceso desde otra computadora (firewall).

## Hallazgo para el Bloque 2
El `JwtAuthGuard` consulta la tabla `usuario` y solo conoce los roles `USUARIO` y `ADMIN` y 4 scopes. El contrato v2 exige
roles `CLIENTE`/`ADMIN`/`SERVICE` y scopes `alojamientos:book|cancel|read|checkin|inventory|admin`. El token del ESB de Booking
requiere un rol de servicio (migración del enum `rol_usuario`) y una cuenta de servicio en la BD.

## 2026-10-27 · Bloque 2: rutas del contrato v2 (/api/v2/alojamientos)
Se agregó una capa v2 sobre el monolito, sin tocar el contrato v1 (/api/v1 sigue igual: 60 pruebas unitarias en verde).

**Qué hay**
- `GET /health`, `GET /` (catálogo con ETag/304), `POST /availability` (cotización 30 min, no retiene cupo),
  `POST /orders/create` (idempotente, 201), `GET /orders/{orderId}` (acepta UUID, `ORD-HTL-…` o `BK-HOTEL-…`) y
  `POST /orders/{orderId}/cancel` (idempotente; mismo `codigoReembolso` en cada reintento).
- Errores RFC 7807 con el enum `ErrorCode` de 25 valores del contrato v2 (`instance`, `correlation_id`, `invalid_params`).
  En rutas /api/v1 los mismos errores salen con el enum cerrado del v1.
- Dinero como string exacto (`"230.25"`), calculado en centavos enteros. Fórmula del contrato:
  `totalPagar = subtotal + ivaValor + tasaMunicipal (USD 2.00 por noche y habitación) − descuentoCombo`.
- Migración `database/04_v2_integracion.sql`: `unidad_alojamiento.codigo_tipo` (= `tipoHabitacionCodigo`), tablas `cotizacion_v2` y
  `orden_v2` (27 tablas en total) y la cuenta de servicio `esb-booking@servicio.posada.ec`.
- `npm run token:servicio` genera el Bearer del ESB (scopes read, book, cancel, checkin, inventory).
- `npm run test:v2` recorre todo el flujo contra el backend local (48 comprobaciones).

**Decisiones**
- El canal v2 NO cobra cargo de servicio ni tarifa de limpieza (el contrato no los tiene en la fórmula). El marketplace propio (v1) sí los mantiene.
- El `alojamientoId` público es `HTL-<codigo>` (p. ej. `HTL-1001`). El `tipoHabitacionCodigo` sale del nombre de la unidad (`Habitación Estándar` → `HABITACION_ESTANDAR`).
- El único plan de tarifa es `STANDARD`; otro código responde `404 NOT_FOUND`. Paquetes/combos responden `422 PROMOTIONS_NOT_ALLOWED`.
- Restricciones implementadas: `MIN_STAY` y `MAX_STAY` (de `noches_min`/`noches_max` del alojamiento). Falta `CLOSED_TO_ARRIVAL/DEPARTURE`, `STOP_SELL`, `CUTOFF`.
- Roles/token: la cuenta de servicio es un `USUARIO` con scopes ampliados; el enum `rol_usuario` (CLIENTE/ADMIN/SERVICE) se alinea en el Bloque 4.
- `PENDING`, `CONFIRMED`, `CANCELLED` y `CHECKED_OUT` (= COMPLETADA) existen; `CHECKED_IN` y los endpoints de check-in/out quedan para el Bloque 3.

**Verificado** (Postgres de verificación + backend compilado): build, lint, 60 pruebas unitarias y 48 comprobaciones v2 (idempotencia con replay,
`IDEMPOTENCY_KEY_REUSED`, `PRICE_MISMATCH`, `QUOTE_EXPIRED`, `INVALID_DOCUMENT`, `INSUFFICIENT_SCOPE`, 404/403/400, cancelación repetida).
**Pendiente de verificar con Booking**: quién emite los tokens OAuth2 (`tokenUrl` del contrato), el código de nodo para gRPC y el host definitivo.

## 2026-10-27 · Bloque 3 (parte 1): stock por gRPC e inventario
- `backend/proto/inventory.proto`: copia fiel del `.proto` del contrato v2.2.0 (§5). Posada EC es CLIENTE gRPC; Booking es el servidor (puerto 50051, sin TLS en la prueba).
- Cliente: `src/modules/stock-grpc/`. Escucha los eventos de reserva del outbox (creada, confirmada, cancelada, rechazada, expirada, completada), de cualquier canal,
  y envía `PushStockUpdate` con `available_units` absoluto, UNA vez por noche (`check-in … check-out − 1`), `item_id = HTL-<codigo>:<TIPO>`, `time_slot = hora de check-in` (14:00).
  El outbox corre cada 5 s, así que el stock llega a Booking con ≤ 5 s de retraso. Un fallo nunca bloquea la reserva: 3 intentos y se registra `stock_grpc_fallo`.
- Se activa con `STOCK_GRPC_TARGET=<IP de Booking>:50051` en `backend/.env` (vacío = desactivado) y `STOCK_SERVICE_ID` (por defecto `alojamientos`).
- `npm run stock:cargar [-- dias]`: carga inicial / reconciliación (todas las noches de los próximos 90 días).
- `npm run stock:falso`: servidor de Booking FALSO para probar sin ellos (valida item_id, fecha, time_slot y unidades).
- `GET /api/v2/alojamientos/{id}/inventario?desde=&hasta=&tipoHabitacion=` (scope `alojamientos:inventory`): fuente de verdad para reconciliar; devuelve totales, reservadas, bloqueadas, disponibles y un `hash` SHA-256.
- Verificado: 52 comprobaciones del contrato v2, y con servidor gRPC falso: 3 mensajes para una reserva de 3 noches (sin la noche del check-out), carga completa 147/147 aceptados, 0 datos personales en logs.
- **A confirmar con Booking** (el contrato no lo define): unidad de `timestamp` (aquí milisegundos), formato de `date` (YYYY-MM-DD), algoritmo de `last_sync_hash`/`hash` y si `service_id` debe ser el código de nodo.
- Pendiente: `StreamInventoryChanges` (deltas con `event_id`), bloqueo manual de habitaciones, check-in/check-out y el feed `GET /eventos`.

## 2026-10-27 · Cambio: `inventory.proto` oficial de Booking
Booking envió su `inventory.proto` real; reemplaza al derivado del contrato (`backend/proto/inventory.proto` es ahora SU archivo, sin cambios).
Diferencias y cómo se resolvieron:
- `StockUpdateMessage.slot_id = 7` (nuevo): el cliente envía `slot-YYYYMMDD-HHMM` (p. ej. `slot-20261111-1400`).
- `StockUpdateAck` ahora trae `error_code` y `current_available`. `OK` cuenta como enviado; `STALE_TIMESTAMP_IGNORED` (regla monotónica) se cuenta como obsoleto y no se reintenta;
  `ITEM_NOT_FOUND` / `INVALID_SLOT` no se reintentan y se registran como fallo (significan que Booking aún no tiene el item registrado o el turno es inválido).
- Nueva llamada `GetSlotAvailability`: `npm run stock:cargar` ahora termina comparando 3 noches contra lo que Booking tiene (`COINCIDE` / `DIFIERE`).
- Resuelto con su archivo: `timestamp` en milisegundos, `date` ISO `YYYY-MM-DD`, `time_slot` `14:00`, hash = SHA-256 o token de control.
- Sigue abierto: `service_id`. El .proto dice "código asignado a la tienda socia" (p. ej. `NODE_ATR_DILAN`); el texto del líder dice `"alojamientos"`. Pedir el código de nodo.
- Host de Booking desplegado: `rda1-backend-integracion-sistemas.onrender.com:50051`. Para la prueba local se usa su IP de Tailscale.
- El servidor falso (`npm run stock:falso`) ya usa este .proto e imita `STALE_TIMESTAMP_IGNORED`, `INVALID_SLOT`, `ITEM_NOT_FOUND` y `GetSlotAvailability`.
- Directiva del líder (reparto en 7 microservicios entre 4 compañeros: ms_catalog, ms_rooms, ms_inventory, ms_orders, ms_reception, ms_pricing, ms_housekeeping): pendiente de decidir cómo se mapea con la arquitectura individual de 4 servicios (Bloque 4).
- Horarios: el texto dice check-out máximo 11:00 y check-in desde 14:00; la BD tiene check-out por defecto 12:00 (`alojamiento.hora_checkout`). Pendiente de decidir.

## Entrada — Migración a microservicios y gateway (semanas 7 a 11)
- Decisión: monolito modular desplegado como 4 servicios (`SERVICE_ROLE`), una imagen; justificación y límites en `docs/ARQUITECTURA_MICROSERVICIOS.md`.
- Gateway Kong DB-less generado desde las reglas del código (una sola fuente de verdad), con key-auth, rate limit por consumidor, correlation-id, proxy-cache y métricas.
- Contract testing con Pact (Booking como consumidor, Posada EC como proveedor) y pruebas del reparto de rutas.
- Observabilidad: `/metrics` Prometheus por servicio; auditoría de operaciones críticas `/api/v2`.
- Pendiente de demostrar en Azure: ejecutar `scripts/desplegar-microservicios-azure.sh`, correr `pact:verificar` contra el gateway y capturar evidencias (`docs/EVIDENCIAS_RETO2.md`).


## 2026-11-04 — Huéspedes (`/api/v2/clientes`) y check-in en recepción

Pedido de la cátedra para el flujo crear habitación → reservar desde Booking → llegada física.

- `GET|POST /api/v2/clientes`: ficha única por correo e identificación (201 nueva, 200 mismo `client_id`, 409 si chocan). Servicio **identity** en el gateway. Contrato: `backend/contracts/posada-extensiones-v2.yaml`.
- Panel de administración: botón «Registrar llegada» (`POST /api/v1/host/orders/:id/arrival`, solo ADMIN, servicio **reservations**). Registra el check-in y avisa a Booking con `POST /api/v2/reservas/{external_order_id}/checkin` (X-API-Key).
- Si Booking no responde, el job `notificar-checkin` (servicio **integration**) reintenta con espera creciente (máx. 12). Mismo patrón de resiliencia que el outbox.
- Auditoría: evento `operacion_critica` con `accion: checkin_recepcion`.
- Migración `database/06_v2_clientes_checkin.sql` (tabla `cliente_v2` + columnas de check-in en `orden_v2`).
- Pruebas: `test:roles` (ruteo), Pact (5 interacciones) y bloque `[clientes]` en `prueba-v2.cjs`.

## 2026-11-08 — Correcciones tras la auditoría del backend

Auditoría de solo lectura (`AUDITORIA_BACKEND.md`, 7,5/10). Corregido en código:

- **H-07 Idempotencia:** una clave «en proceso» que lleva más de 2 min sin respuesta (el proceso murió) se reclama de forma atómica y la operación puede reintentarse; antes devolvía 409 hasta la purga de 24 h. Prueba nueva: `idempotencia.interceptor.spec.ts`.
- **H-17 Perfil:** el `UPDATE` dinámico de `cuenta.service.ts` usa una lista blanca fija de columnas (`COLUMNAS_PERFIL`).
- **H-13 gRPC:** `STOCK_GRPC_TLS=true` cifra el canal hacia Booking (sin TLS solo en red privada/Tailscale).
- **H-14 Swagger:** `SWAGGER_ENABLED=false` oculta `/api/docs`.
- **H-15/H-16:** comentarios de Render actualizados a Azure; CI con Node 22 (igual que la imagen).
- **H-01 Despliegue:** `scripts/desplegar-microservicios-azure.sh` crea las variables sensibles como secretos de Container Apps (`secretref:`), genera `METRICS_TOKEN` si falta y borra los temporales de `/tmp` al terminar.

Decisiones documentadas (no se cambian ahora):

- **H-03 Límites en memoria:** el rate limit del backend y de Kong es por réplica (`policy: local`). Aceptable con 1 réplica; para varias réplicas usar Redis.
- **H-09 Rotación de `SERVICE_API_KEY`:** cambiar la llave en el gateway y en los 4 servicios en la misma ventana y avisar a Booking; durante el cambio las llamadas de Booking recibirán 401.
- **H-08 Bloqueo por cuenta en login:** no se añade antes de la defensa para no bloquear cuentas de demo; el límite actual es 5 intentos/min por IP.
- **H-19 Dependencias:** `npm audit --omit=dev` reporta 18 (11 moderadas, 7 altas), todas en cadenas de NestJS 10 (`@nestjs/platform-express`, `@nestjs/swagger`, `@nestjs/config`) cuya corrección exige subir de versión mayor. Se deja como tarea posterior a la entrega.
