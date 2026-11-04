# CHANGELOG de contratos

Formato: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado: ver `POLITICA_VERSIONADO.md`.

## [Sin publicar]

### Pendiente de decidir
- Eventos propuestos aún sin emitir: `AlojamientoActualizado`, `UsuarioActualizado`, `StockCambiado`.
- `ReservaCreada` 1.1.0 (campos opcionales `lineas` y `canal`).

## Contrato v2.2.0 completo (36 de 36 operaciones) — 2026-11-03

### Agregado
- Las 14 rutas alias **deprecadas** del contrato v2.2.0 (comportamiento idéntico a las principales; responden con la cabecera
  `Deprecation: true` y se eliminan en v3): `GET /tipos`, `GET /{id}/disponibilidad`, `GET|POST /{id}/reviews`, `POST /reservas`,
  `POST /{id}/reservations`, `GET /reservas/{id}`, `GET /reservations/{id}` y `cancel`, `checkin` y `checkout` de ambas formas.
- Check-in / early check-in / check-out (`/orders/{orderId}/check-in|early-checkin|checkout`), reseñas, ficha por id, habitaciones,
  `GET /{id}/availability`, `GET /reservations`, `GET /categorias`, feed CloudEvents `GET /eventos` y acuerdo B2B
  `GET|PUT /promociones/contrato`. Con esto las 22 operaciones principales y las 14 deprecadas del contrato quedan implementadas.
- `GET /health` incluye `vertical: ALOJAMIENTOS` y, si existe la variable `NODE_ID`, `nodo_id` (campos aditivos; no cambia la versión mayor).
- Aviso de stock a Booking por **REST** (`POST /api/v3/inventory/stock`, cabecera `X-API-Key`, una actualización por noche) además de gRPC.
  Se activa con `STOCK_REST_URL` y `STOCK_REST_API_KEY` y tiene prioridad sobre gRPC.
- `contracts/events/posada-events-asyncapi.yaml` 1.1.0 (cambio MENOR): canal y mensaje `CheckInCompletado` (ya se emite desde el check-in digital).
- Código de nodo en Booking: `NODE_ALO_PEC`.

### Cambiado
- El semáforo del health mide solo el ping a la base de datos (`SELECT 1`), con los umbrales del contrato: GREEN < 200 ms,
  YELLOW 200–800 ms, RED > 800 ms o base caída.
- `test:v2` pasó de 52 a 125 comprobaciones; la última corrida (2026-11-03) fue contra la API desplegada en Azure y la base en Supabase: 125 OK, 0 fallas.

### Diferencias conocidas con el contrato (no se corrigen sin avisar a Booking)
- El precio del canal v2 no incluye cargo de servicio ni tarifa de limpieza. Solo existe el plan de tarifa `STANDARD`.
- Los paquetes/combos responden `422 PROMOTIONS_NOT_ALLOWED`. Solo se aplican las restricciones `MIN_STAY` y `MAX_STAY`.
- `GET /reservations` lista únicamente las órdenes creadas por el canal v2.
- El evento `alojamiento.stock.actualizado` del feed `/eventos` no se emite todavía (el stock se envía directo por REST/gRPC).
- Booking mencionó `POST /orders/preview` como obligatoria; esa ruta no está en el contrato v2.2.0. Pendiente de que Booking defina el formato.

## Contratos por servicio 1.0.0 — 2026-10-28

### Agregado
- `contracts/services/identity-openapi.yaml` 1.0.0 — 9 rutas (auth, perfil, usuarios y roles).
- `contracts/services/catalog-openapi.yaml` 1.0.0 — 20 rutas (búsqueda, detalle, alojamientos, catálogos, reseñas).
- `contracts/services/reservations-openapi.yaml` 1.0.0 — 24 rutas (disponibilidad, órdenes, unidades, calendario, impuestos, indicadores).
- `contracts/services/integration-openapi.yaml` 1.0.0 — 5 rutas (webhooks, registro de eventos, trabajos).
- `contracts/events/posada-events-asyncapi.yaml` 1.0.0 — 17 canales (14 eventos vigentes, 3 propuestos).
- `backend/scripts/dividir-contratos.js` (`npm run contract:split`): genera los cuatro contratos de servicio desde `posada-ec-openapi.yaml`.

### Sin cambios de comportamiento
- Ninguna ruta, campo ni código de error cambió: el reparto es solo de documentación. El monolito sigue sirviendo todo y
  Booking (v2.2.0) no nota nada.

## Contrato v2.2.0 del canal Booking — 2026-10-27

### Agregado
- Rutas `/api/v2/alojamientos/*` con errores RFC 7807 y 25 códigos, Idempotency-Key, cotización de 30 minutos y scopes
  `alojamientos:read|book|cancel|checkin|inventory|admin`. En esa fecha cubría las primeras operaciones; la cobertura completa llegó el 2026-11-03 (ver arriba).
- Cliente gRPC de stock con el `inventory.proto` oficial de Booking (`slot_id`, `error_code`, `GetSlotAvailability`).

### Cambiado
- Horario del ecosistema: check-out máximo 11:00 y check-in mínimo 14:00 (`database/04_v2_integracion.sql`). El catálogo v2
  devuelve `checkOutHoraMaxima` = `11:00`.

## Contrato propio 1.0.0 — Reto 1
- 17 operaciones oficiales sin modificar más las rutas propias (autenticación, cuenta, anfitrión/admin, salud).
