# CHANGELOG de contratos

Formato: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado: ver `POLITICA_VERSIONADO.md`.

## [Sin publicar]

### Pendiente de decidir
- Eventos propuestos aún sin emitir: `AlojamientoActualizado`, `UsuarioActualizado`, `StockCambiado`.
- `ReservaCreada` 1.1.0 (campos opcionales `lineas` y `canal`).

## Contratos por servicio 1.0.0 — 2026-10-28

### Agregado
- `contracts/services/identity-openapi.yaml` 1.0.0 — 9 rutas (auth, perfil, usuarios y roles).
- `contracts/services/catalog-openapi.yaml` 1.0.0 — 20 rutas (búsqueda, detalle, alojamientos, catálogos, reseñas).
- `contracts/services/reservations-openapi.yaml` 1.0.0 — 24 rutas (disponibilidad, órdenes, unidades, calendario, impuestos, indicadores).
- `contracts/services/integration-openapi.yaml` 1.0.0 — 5 rutas (webhooks, registro de eventos, trabajos).
- `contracts/events/posada-events-asyncapi.yaml` 1.0.0 — 17 canales (14 eventos vigentes, 3 propuestos).
- `scripts/dividir-contratos.js` (`npm run contract:split`): genera los cuatro contratos de servicio desde `posada-ec-openapi.yaml`.

### Sin cambios de comportamiento
- Ninguna ruta, campo ni código de error cambió: el reparto es solo de documentación. El monolito sigue sirviendo todo y
  Booking (v2.2.0) no nota nada.

## Contrato v2.2.0 del canal Booking — 2026-10-27

### Agregado
- Rutas `/api/v2/alojamientos/*` con errores RFC 7807 y 25 códigos, Idempotency-Key, cotización de 30 minutos y scopes
  `alojamientos:read|book|cancel|checkin|inventory|admin`. Cumple el contrato de Booking v2.2.0 (52 comprobaciones en `test:v2`).
- Cliente gRPC de stock con el `inventory.proto` oficial de Booking (`slot_id`, `error_code`, `GetSlotAvailability`).

### Cambiado
- Horario del ecosistema: check-out máximo 11:00 y check-in mínimo 14:00 (`database/04_v2_integracion.sql`). El catálogo v2
  devuelve `checkOutHoraMaxima` = `11:00`.

## Contrato propio 1.0.0 — Reto 1
- 17 operaciones oficiales sin modificar más las rutas propias (autenticación, cuenta, anfitrión/admin, salud).
