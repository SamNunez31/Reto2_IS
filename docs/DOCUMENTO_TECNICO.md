# Documento técnico — Posada EC · Reto 1 · Dominio Alojamientos

> **Aclaración:** los pagos y facturas de Posada EC son **simulados con fines académicos** (Proyecto académico PUCE). No se procesa dinero real, los datos de tarjeta nunca llegan al servidor y las facturas no tienen autorización del SRI.

## 1. Problema, alcance, actores y enfoque API-first

**Problema.** Un marketplace de alojamientos en Ecuador donde un viajero busca, compara y reserva con el **precio final claro** (hospedaje + servicio + IVA + limpieza) y una política de cancelación entendible. **Posada EC administra su propio catálogo**: el administrador crea, edita, publica y despublica los alojamientos; los huéspedes buscan, reservan, pagan, ven sus reservas y dejan reseñas.

**Alcance del Reto 1.** Sistema desplegable con: backend con API documentada y versionada (`/api/v1`, Swagger en `/api/docs`), marketplace (búsqueda → detalle → reserva → mis reservas), panel del administrador con la gestión del catálogo, BD operativa (Supabase, 27 tablas) y análisis conceptual de gRPC, GraphQL y eventos. **No** hay integración real con otros dominios (eso es Reto 2/3).

**Actores.**

| Actor | Rol en el sistema | Qué hace |
|---|---|---|
| Visitante | sin cuenta | busca, ve detalle, disponibilidad y reseñas |
| Huésped | `USUARIO` | busca, reserva (confirmada al aprobarse el pago), modifica, cancela, ve factura y trazabilidad, reseña estancias completadas |
| Administrador | `ADMIN` (operador de Posada EC) | crea, edita, publica, despublica y suspende **cualquier** alojamiento (con sus unidades y calendario); ve todas las reservas y reseñas (puede responderlas, no moderarlas); usuarios, catálogos, impuestos/feriados, indicadores, eventos, jobs. **No reserva.** |
| Sistemas B2B | (Reto 2) | `client_credentials` + webhooks |

**API-first.** El contrato `backend/contracts/alojamientos-openapi.yaml` (no editado) es la fuente de verdad. Las 17 operaciones se implementan con DTOs fieles al YAML y se verifican con `npm run contract:check`, que compara el YAML con el OpenAPI generado (`npm run docs:openapi` → `docs/openapi.json`). Lo que el contrato no cubre (auth, cuenta, catálogo del admin `/host/*`, admin) son **rutas propias** con su propio tag en Swagger. Además se publica un **contrato propio** de Posada EC, `backend/contracts/posada-ec-openapi.yaml` (55 rutas, 63 operaciones: las 17 oficiales más las propias y las extensiones opcionales), generado de la API real con `npm run docs:openapi` + `npm run contract:export`; el contrato oficial no se modifica. El admin puede además crear usuarios activos (`POST /admin/users`: correo, nombres, apellidos y clave con la misma política y bcrypt que el registro; siempre rol USUARIO, el rol no se recibe) y asignar el rol ADMIN a otro usuario activo (`PATCH /admin/users/{id}/role`, solo promoción; el usuario debe volver a iniciar sesión porque el rol viaja en el JWT).

**Evolución futura (fuera del alcance actual).** Un portal de anfitriones externos (que terceros publiquen sus alojamientos) y las denuncias de anuncios/usuarios. Se dejaron preparados sin costo: `alojamiento.anfitrion_id` (hoy siempre el admin para los alojamientos nuevos), el valor `SOLICITUD` del enum `modo_reserva` (sin uso) y el tipo `motivo_reporte` (sin uso). Las rutas `/host/*` siguen existiendo pero solo las usa el ADMIN.

## 2. Contrato → implementación

| Operación del contrato | Endpoint | Función / vista / tabla | Estado |
|---|---|---|---|
| Búsqueda | `POST /api/v1/search` (público, `X-Device-Fingerprint` obligatorio) | `fn_buscar_alojamientos` + `alojamiento.codigo`; cursor opaco base64url | ✅ probado |
| Disponibilidad | `POST /availability` | `fn_cotizar` por unidad activa + cupo ≥ habitaciones; `politica_cancelacion_regla` | ✅ probado |
| Disponibilidad múltiple | `POST /bulk-availability` | igual, producto más barato por alojamiento | ✅ (prueba pendiente) |
| Detalles | `POST /details` | `alojamiento`, `v_alojamiento_resumen`, `amenidad`, `imagen_alojamiento`, `unidad_alojamiento` | ✅ |
| Cambios | `POST /details/changes` (`alojamientos:read`) | `alojamiento.updated_at` | ✅ |
| Cadenas | `POST /chains` | — (devuelve `[]`) | ✅ |
| Constantes | `POST /constants` | catálogos + enums `provincia_ec`, `estado_reserva` | ✅ |
| Reseñas | `POST /reviews` | `resena` (PUBLICADA) | ✅ |
| Puntajes | `POST /reviews/scores` | `v_alojamiento_resumen` + distribución | ✅ |
| Previsualizar orden | `POST /orders/preview` (`read`) | `fn_crear_preview` → `orden_preview` (15 min) | ✅ probado |
| Crear orden | `POST /orders/create` (`book`, Idempotency-Key) | `fn_crear_orden` → `fn_crear_reserva` | ✅ probado |
| Obtener orden | `GET /orders/{orderId}` (`read`) | `v_orden` (solo dueño; ajena → 404) + `_links` | ✅ probado |
| Modificar | `POST /orders/{orderId}/modify` (`book`, Idempotency-Key) | `fn_modificar_reserva` | ✅ probado |
| Cancelar | `POST /orders/{orderId}/cancel` (`cancel`, Idempotency-Key) | `fn_cancelar_reserva` → penalidad/reembolso | ✅ probado |
| Webhooks | `GET/POST /webhooks`, `DELETE /webhooks/{id}` (`webhooks`) | `webhook_suscripcion`, `webhook_evento` | ✅ CRUD (entrega = Reto 2) |

**Supuestos**: sin cadenas hoteleras; `meal_plan` no soportado; solo `USD`, `country = "ec"`, idioma `es`; OAuth2 simplificado (el JWT lo emite `/auth/login`, con claim `scope`); pagos y facturas **simulados**; `product_id` opaco (`base64url(unidad|checkin|checkout)`) porque el preview del contrato no trae fechas; prefijo `/api/v1` en lugar de los servidores del YAML; webhooks sin entrega.

**Errores.** Toda la API responde `application/problem+json` con el esquema `ProblemDetails` (`type, title, status, detail, code, invalidParams`). Las excepciones de la BD (`RAISE EXCEPTION 'CODIGO: …'`) se traducen: `SIN_DISPONIBILIDAD`/`UNIDAD_INACTIVA` → 409 `ROOM_NO_LONGER_AVAILABLE`; `PRECIO_CAMBIO`/`PREVIEW_EXPIRADO` → 409 `PRICE_CHANGED` + `Retry-After`; `RESERVA_DUPLICADA` (el mismo huésped ya tiene una reserva activa de esa unidad con fechas solapadas; se valida en `fn_crear_orden`, un reintento con el mismo preview devuelve la misma reserva) → 409 `VALIDATION_FAILED`; `CAPACIDAD_EXCEDIDA`/`FECHAS_INVALIDAS`/`ESTANCIA_INVALIDA`/`FECHA_PASADA` → 400 `VALIDATION_FAILED` + `invalidParams`; `TRANSICION_INVALIDA`/`ESTADO_INVALIDO` → 409 `CANCELLATION_NOT_ALLOWED`; `MODIFICACION_NO_PERMITIDA` → 409 `BOOKING_NOT_CONFIRMED`; `AUTORESERVA`/`HUESPED_INVALIDO` → 403; rate limit → 429 `RATE_LIMIT_EXCEEDED` + `Retry-After`. Nunca se expone SQL ni stack.

## 3. Arquitectura

```mermaid
flowchart LR
  U[Navegador] -->|HTTPS| FE[Angular 19 SPA<br/>Vercel]
  FE -->|REST /api/v1 + JWT| BE[NestJS monolito modular<br/>Render]
  subgraph BE_mod[Backend]
    direction TB
    G[Guards: Throttler → JWT → Roles → Scopes] --> C[Controladores<br/>contrato + propias]
    C --> S[Servicios]
    S --> DB[(DbService<br/>SQL parametrizado)]
    J[Jobs @nestjs/schedule<br/>advisory lock] --> DB
    J --> BUS[Bus en memoria] --> AUD[Consumidor auditoría<br/>idempotente]
  end
  BE --- BE_mod
  DB -->|SSL, pooler| PG[(Supabase PostgreSQL<br/>schema booking · 25 tablas<br/>fn_* · v_* · triggers)]
```

- **La lógica crítica vive en la BD**: precios, cupo (con `FOR UPDATE`, sin sobreventa), máquina de estados, penalidades y eventos de negocio (triggers que escriben en `evento_outbox`). El backend **llama** a `fn_*` y consulta `v_*`; no reimplementa reglas.
- **Jobs**: `fn_completar_estancias` (cada hora), publicador del outbox (cada 5 s), purga de `idempotencia` (diaria). (`fn_expirar_solicitudes` sigue en la BD, sin uso: ya no hay reservas por solicitud.) Cada job corre en una transacción con `pg_try_advisory_xact_lock` para que solo una instancia lo ejecute.
- **Outbox**: los triggers escriben el evento en la **misma transacción** que el cambio; el publicador lee `publicado_en IS NULL … FOR UPDATE SKIP LOCKED`, lo entrega al bus en memoria (consumidor de auditoría idempotente por `evento_id`) y marca `publicado_en`.

**¿Por qué monolito modular ahora?** Un solo equipo, un solo dominio, una BD, plazo corto y presupuesto gratuito. Los módulos (`alojamientos`, `cuenta`, `host`, `admin`, `auth`, `jobs`) tienen fronteras claras y solo se comunican por servicios, de modo que separarlos luego es mecánico (ver §6).

## 4. Modelo de datos (25 tablas, schema `booking`)

```mermaid
erDiagram
  usuario ||--o{ token_usuario : tiene
  usuario ||--o{ alojamiento : publica
  usuario ||--o{ reserva : reserva
  ciudad ||--o{ alojamiento : ubica
  tipo_alojamiento ||--o{ alojamiento : clasifica
  politica_cancelacion ||--o{ politica_cancelacion_regla : tramos
  politica_cancelacion ||--o{ alojamiento : aplica
  politica_cancelacion ||--o{ reserva : aceptada
  alojamiento ||--o{ unidad_alojamiento : ofrece
  alojamiento ||--o{ alojamiento_amenidad : tiene
  amenidad ||--o{ alojamiento_amenidad : en
  alojamiento ||--o{ imagen_alojamiento : fotos
  unidad_alojamiento ||--o{ calendario_unidad : excepciones
  alojamiento ||--o{ reserva : recibe
  reserva ||--|{ reserva_detalle : lineas
  unidad_alojamiento ||--o{ reserva_detalle : reservada
  reserva ||--o| cancelacion : "si se cancela"
  reserva ||--o{ pago : movimientos
  reserva ||--o| factura : factura
  reserva ||--o| resena : resena
  usuario ||--o{ orden_preview : cotiza
  unidad_alojamiento ||--o{ orden_preview : cotizada
  reserva ||--o| orden_preview : origen
  webhook_suscripcion ||--|{ webhook_evento : eventos
  webhook_suscripcion ||--o{ webhook_entrega : entregas
  evento_outbox ||--o{ webhook_entrega : genera
  impuesto_tarifa { smallint id PK }
  idempotencia { varchar propietario PK }
```

`impuesto_tarifa` (IVA/servicio con vigencia, feriados) e `idempotencia` (clave por `sub`) no tienen FK: se consultan por fecha y por propietario respectivamente.

**Nota de normalización.** Modelo normalizado: las relaciones muchos-a-muchos son **uniones binarias** (`alojamiento_amenidad`, `webhook_evento`) y no se guardan listas en columnas. Los **totales no se almacenan**: salen de vistas (`v_reserva_total`, `v_factura`, `v_cancelacion_liquidacion`), así no hay datos derivados que se desincronicen. Las dos excepciones son **a propósito**: `orden_preview` congela el precio cotizado 15 min (es un *snapshot* que permite detectar `PRICE_CHANGED`) e `idempotencia` guarda la respuesta para reproducirla; ambos son registros históricos, no duplicación de verdad. `factura` copia los datos del comprador por obligación tributaria (la factura no cambia si el usuario edita su perfil).

**Código público del alojamiento.** El contrato identifica al alojamiento con un **entero**; la BD usa UUID como clave. Ese entero es la columna `alojamiento.codigo` (identity desde 1001, única, no editable). Hasta el 2026-10-05 vivía en una tabla 1 a 1 aparte (`alojamiento_codigo`); se fundió en `alojamiento` con `database/migracion_codigo_en_alojamiento.sql`, conservando todos los códigos existentes.

**Sin denuncias.** Al simplificar el alcance, la tabla `reporte` y el tipo `estado_reporte` se eliminaron con `database/migracion_sin_reportes.sql`. Antes se verificó que solo dependían de ellos la columna `reportes_pendientes` de `v_admin_indicadores` (la vista se recreó sin ella) y sus dos triggers; ninguna FK ni política RLS. Se conservan el tipo `motivo_reporte` (sin uso, para la evolución futura) y los eventos históricos `AlojamientoReportado`/`UsuarioReportado` del outbox. No se borró ninguna columna ni valor de enum: `alojamiento.anfitrion_id` sigue (el admin es el dueño de los alojamientos nuevos; `migracion_admin_dueno.sql` permite que un ADMIN lo sea) y `modo_reserva` conserva `SOLICITUD` aunque ya no se use (`datos_modo_inmediato.sql` pasó los alojamientos demo a `INSTANTANEA`).

**Sin aeropuertos (25 tablas).** Se eliminaron `aeropuerto` y `alojamiento_aeropuerto` con `database/migracion_sin_aeropuertos.sql`, y `fn_buscar_alojamientos` perdió los parámetros `p_aeropuerto` y `p_max_km` y las columnas de aeropuerto (ahora ordena por precio). Se conservan las ciudades (Tababela, Baltra, etc.) y la amenidad «Transporte desde/hacia el aeropuerto». En el backend y el frontend se quitaron el endpoint `POST /admin/catalogs/airports`, los filtros `airport` y `max_airport_km` de `/search`, el orden `distancia`, el campo `airports` de `/details` y `/constants`, y la sección «Aeropuertos cercanos» del formulario del administrador y de la pantalla de detalle.

**Tablas por módulo** (cada una tiene además su `COMMENT ON TABLE` en la BD):

| Módulo | Tabla | Para qué sirve |
|---|---|---|
| Usuarios y seguridad | `usuario` | Cuentas de huéspedes y del administrador (dueño del catálogo y emisor de sus facturas), con datos de acceso y, opcionalmente, de facturación. |
| | `token_usuario` | Tokens de un solo uso (recuperar clave; esa opción está deshabilitada en la interfaz); solo se guarda su hash y su vencimiento. |
| | `idempotencia` | Respuestas guardadas por `Idempotency-Key` para no duplicar crear, modificar o cancelar. |
| Catálogo y alojamientos | `ciudad` | Localidades por provincia, para buscar y filtrar. |
| | `tipo_alojamiento` | Catálogo cerrado de 5 tipos: Hotel, Hostal, Cabaña, Casa y Departamento. |
| | `amenidad` | Comodidades ofrecibles, agrupadas por categoría. |
| | `alojamiento` | El anuncio: datos, ubicación, reglas, política, estado y `codigo` público. |
| | `alojamiento_amenidad` | Qué amenidades tiene cada alojamiento (puente). |
| | `imagen_alojamiento` | Fotos (URL) con orden y una portada. |
| Disponibilidad y precios | `unidad_alojamiento` | Lo que se reserva: tipo de habitación (con cantidad) o propiedad completa, con precio base. |
| | `calendario_unidad` | Excepciones por día: precio especial o cantidad a la venta (0 = cerrada). |
| | `politica_cancelacion` | FLEXIBLE, MODERADA, NO_REEMBOLSABLE con su texto. |
| | `politica_cancelacion_regla` | Tramos: horas de anticipación → % de penalidad. |
| | `impuesto_tarifa` | IVA y cargo de servicio con vigencia (incluye feriados con IVA reducido, que dependen solo de sus fechas). |
| | `orden_preview` | Cotización congelada 15 min entre `preview` y `create`. |
| Reservas y pagos | `reserva` | Cabecera: huésped, alojamiento, fechas, huéspedes, política aceptada y estado. |
| | `reserva_detalle` | Líneas: unidades reservadas y montos acordados. |
| | `cancelacion` | Quién canceló, cuándo y por qué (la liquidación sale de una vista). |
| | `pago` | Cobros y reembolsos simulados; `metodo` = TARJETA o EFECTIVO (el efectivo queda PENDIENTE hasta que el admin lo confirma). |
| | `factura` | Factura simulada con copia de los datos del comprador. |
| Reseñas | `resena` | Nota 1–10 y comentario del huésped tras una estancia COMPLETADA (una por reserva), con respuesta opcional del alojamiento. |
| Integración y eventos | `evento_outbox` | Eventos de negocio escritos en la misma transacción que el cambio. |
| | `webhook_suscripcion` | Suscripciones de terceros: URL, secreto y si está activa. |
| | `webhook_evento` | Eventos a los que está suscrita cada suscripción. |
| | `webhook_entrega` | Cola de entregas por evento y suscripción (la entrega real es del Reto 2). |

- **¿Por qué `imagen_alojamiento` es tabla aparte?** Un alojamiento tiene **0 a N fotos**, cada una con su **orden** y exactamente una **portada** (índice único parcial); en columnas de `alojamiento` habría que guardar una lista, que no se puede validar ni ordenar.
- **¿Por qué `unidad_alojamiento` es tabla aparte?** Un alojamiento ofrece **varios tipos reservables** (p. ej. "Habitación doble" ×10 y "Suite" ×2), cada uno con capacidad, cantidad, precio y calendario propios; el cupo y el precio se calculan por unidad, no por alojamiento.

## 5. Seguridad (OWASP Top 10 ↔ control ↔ archivo)

| OWASP 2021 | Control | Archivo |
|---|---|---|
| A01 Control de acceso | `JwtAuthGuard` global + `@Public()`; `RolesGuard`; `ScopesGuard` (scopes del contrato); `ownerId` siempre del `sub`; recursos ajenos → 404; las rutas de catálogo (`/host/…`) y `/admin/…` son solo ADMIN (excepción de ADMIN en las comprobaciones de propiedad); el registro público nunca crea un ADMIN (el DTO rechaza `rol`); ADMIN no reserva ni reseña (servicio + trigger) | `common/auth/guards.ts`, `decorators.ts`, `ordenes.service.ts`, `host.service.ts` |
| A02 Fallas criptográficas | bcrypt costo 12; JWT HS256 con `algorithms:['HS256']`; secreto ≥ 32 bytes (la app no arranca en producción si es débil); token de recuperación de 32 bytes guardado solo como SHA-256; SSL a la BD; HSTS | `auth.service.ts`, `config/entorno.ts`, `main.ts`, `database.module.ts` |
| A03 Inyección | SQL **siempre parametrizado**; `ORDER BY` y columnas de UPDATE por lista blanca; `ValidationPipe` `whitelist`+`forbidNonWhitelisted`; sanitización de texto libre; Angular sin `innerHTML` | `db.service.ts`, `catalogo.service.ts`, `host.service.ts`, `validation.ts`, `validadores-ec.ts` |
| A04 Diseño inseguro | reglas críticas en la BD (cupo con `FOR UPDATE`, máquina de estados); Idempotency-Key en create/modify/cancel; precio congelado y revalidado | `03_integracion.sql`, `idempotencia.interceptor.ts` |
| A05 Configuración | `helmet`, CORS con lista explícita (sin `*`), `synchronize:false`, límite de cuerpo 100 kb, errores genéricos 500, redirección HTTPS en producción | `main.ts`, `http-middlewares.ts` |
| A06 Componentes vulnerables | dependencias fijadas por `package-lock`; sin `audit fix --force`; análisis de `npm audit` en la sección 13 | `package.json` |
| A07 Autenticación | mensaje genérico de login (no revela si el correo existe o si la cuenta está inactiva); tiempo constante con hash señuelo; política de clave; rate limit estricto (5/min) en login/registro/recuperación; JWT de 30 min | `auth.service.ts`, `auth.controller.ts` |
| A08 Integridad de datos | outbox transaccional; consumidor idempotente; webhooks con secreto HMAC generado por el servidor (firma = Reto 2) | `jobs.service.ts`, `bus-eventos.ts`, `webhooks.service.ts` |
| A09 Registro y monitoreo | logs JSON con `X-Correlation-Id`, sin cuerpos, contraseñas, tokens ni query string; `request_id` = correlación; auditoría de accesos (`login_ok`, `login_fallido`, `acceso_401`, `acceso_403`) con correlation id, IP y correo enmascarado | `http-middlewares.ts`, `log-json.ts`, `auditoria.ts`, `problem-details.filter.ts` |
| A10 SSRF | webhooks solo `https` y no se hacen llamadas salientes en el Reto 1 (anti-SSRF del worker = Reto 2) | `ordenes.dto.ts` |

Validaciones de Ecuador: cédula (módulo 10), RUC (13 dígitos, persona natural valida la cédula base) y coordenadas dentro del país (incluye Galápagos), iguales a los `CHECK` de la BD.

## 6. Puntos de integración futuros y evolución a microservicios

**Puntos de integración (ya preparados):** contrato REST versionado; `product_id` opaco; `X-Correlation-Id` de punta a punta y `correlacion_id` en cada evento; outbox + `webhook_suscripcion`/`webhook_entrega` (la tabla de entregas ya se llena por trigger); scopes `client_credentials` declarados en Swagger.

**Candidatos a microservicio** (por cohesión y ritmo de cambio):

| Servicio | Tablas que se llevaría | Motivo |
|---|---|---|
| Catálogo y búsqueda | alojamiento, unidad, imágenes, amenidades, ciudad | lectura masiva → réplica/índice de búsqueda |
| Inventario y precios | calendario_unidad, impuesto_tarifa | cálculo de cupo y precio, alta concurrencia |
| Reservas | reserva, reserva_detalle, orden_preview, cancelacion, idempotencia | transaccional, corazón del negocio |
| Pagos y facturación | pago, factura | integraciones externas (pasarela, SRI) |
| Reseñas | resena | control automático de texto; denuncias = evolución futura |
| Identidad | usuario, token_usuario | OAuth2 real / IdP |
| Integración | evento_outbox, webhook_* | entrega a terceros |

**Estrategia.** (1) *Base de datos por servicio*: cada uno es dueño de sus tablas; las vistas cruzadas (`v_orden`, `v_factura`) pasan a composición en el API o a proyecciones alimentadas por eventos. (2) *Strangler fig*: un API Gateway enruta `/api/v1/*`; se extrae primero Catálogo (solo lectura) y luego Pagos, mientras el monolito sigue atendiendo lo demás. (3) *De `FOR UPDATE` a sagas*: hoy el cupo se protege con bloqueo de fila en una sola transacción; al separar Inventario y Reservas se usa una **saga orquestada** (reservar cupo → cobrar → confirmar; compensaciones: liberar cupo / reembolsar) con el outbox como mecanismo de publicación confiable y consumidores idempotentes.

## 7. gRPC (conceptual)

Contrato: [`docs/proto/alojamientos.proto`](proto/alojamientos.proto).

- `GetDisponibilidad` (**unario**): para que otro dominio (Vuelos, paquetes) cotice con baja latencia y tipado fuerte (Protobuf, HTTP/2) en vez de JSON.
- `StreamCambios` (**streaming de servidor**): el cliente se suscribe y recibe cambios de precio/cupo en tiempo real; la fuente sería el outbox.
- Cuándo sí: comunicación interna servicio↔servicio, alto volumen. Cuándo no: navegador/terceros (se mantiene REST + OpenAPI).

## 8. GraphQL (conceptual)

Esquema: [`docs/graphql/alojamientos.graphql`](graphql/alojamientos.graphql). Subgrafo federado con `type Alojamiento @key(fields: "id")` (clave = código entero público, nunca el UUID), para que el gateway combine alojamiento + vuelo + atracción en una sola consulta. Dos consultas agregadas: `resumenPorCiudad` (sobre `v_alojamiento_resumen`) y `ventasPorCiudad` (sobre `v_ventas_por_ciudad`). Ventaja: el cliente pide exactamente los campos que necesita; riesgo: consultas costosas → límites de profundidad/complejidad.

## 9. Eventos, EDA y trazabilidad

**Catálogo de eventos de negocio** (emitidos por triggers en `evento_outbox`):

| Evento | Cuándo | Agregado |
|---|---|---|
| `ReservaCreada` | INSERT en `reserva` (nace CONFIRMADA: toda reserva se confirma al aprobarse el pago) | Reserva |
| `ReservaConfirmada` | confirmación de una reserva pendiente antigua (modo por solicitud, ya sin uso) | Reserva |
| `ReservaModificada` | `fn_modificar_reserva` | Reserva |
| `ReservaCancelada` | `fn_cancelar_reserva` | Reserva |
| `PagoRegistrado` / `ReembolsoRegistrado` | INSERT en `pago` | Pago |
| `FacturaEmitida` / `FacturaAnulada` | INSERT/anulación de `factura` | Factura |
| (además) `ReservaRechazada`, `ReservaExpirada`, `EstanciaCompletada`, `ResenaPublicada`, `AlojamientoPublicado`, `AlojamientoSuspendido` (los `AlojamientoReportado` antiguos quedan como historia) | | |

- **Outbox**: el evento se escribe en la misma transacción que el cambio (no hay "cambio sin evento" ni "evento sin cambio").
- **`correlacion_id`** = id de la reserva: une todos los eventos de un flujo (reserva, pago, factura, cancelación). `GET /orders/{id}/timeline` lo expone (`v_trazabilidad_reserva`).
- **Webhooks**: `ORDER_CONFIRMED` (ReservaConfirmada, o ReservaCreada con estado CONFIRMADA) y `ORDER_CANCELLED` (ReservaCancelada). El trigger `tg_outbox_webhooks` ya crea las filas en `webhook_entrega`; **la entrega (worker, firma HMAC-SHA256, reintentos con backoff, anti-SSRF) es del Reto 2**.

**Ejemplo real** (prueba del 2026-10-04, reserva `BK-4DDB587F`, todos con el mismo `correlacion_id`):

```
ReservaCreada → PagoRegistrado → FacturaEmitida → ReservaModificada
→ ReservaCancelada → ReembolsoRegistrado → FacturaAnulada
```

### Pago simulado y factura

Flujo del huésped: **ficha → datos de facturación → pago con tarjeta → confirmación**.

- **Cotización congelada:** al abrir el checkout se llama `POST /orders/preview` (precio garantizado 15 min; el resumen muestra "Precio garantizado por mm:ss").
- **Datos de facturación:** Cédula (módulo 10), RUC, Pasaporte o Consumidor final. Viajan en `customer_details` de `POST /orders/create` con tres campos **opcionales de extensión** (`document_type`, `document_number`, `business_name`); el YAML oficial del contrato no se modificó y `contract:check` sigue 17/17. En la **misma transacción** que `fn_crear_orden`, el backend reemplaza los datos del comprador de la factura emitida. La cédula/RUC **no se guarda en el perfil** (el perfil ya no la pide ni la muestra; las columnas de `usuario` siguen existiendo por compatibilidad).
- **Tarjeta (simulada):** número (Luhn, longitud, marca Visa/Mastercard/Amex), titular, caducidad MM/AA y CVV se validan **solo en el navegador**; nunca se envían, guardan ni registran. Al backend solo llega `payment_reference` (`PAY-XXXXXXXX`). Un rechazo usa el prefijo `PAY-DECLINED…`, que el backend responde con `402 PAYMENT_NOT_AUTHORIZED` **antes** de crear la orden (la cotización sigue vigente y se puede reintentar).
- **Efectivo:** `POST /orders/create` acepta la extensión opcional `payment_method` (`CARD` por defecto | `CASH`; otro valor → 400). Con `CASH` no se pide `payment_reference`: la reserva queda **CONFIRMADA** al instante y, en la misma transacción que `fn_crear_orden`, su cobro pasa a `estado = PENDIENTE`, `metodo = EFECTIVO` (columna `pago.metodo`, `database/migracion_pago_metodo.sql`). La factura se emite igual. Si se modifica, la diferencia también queda pendiente. Al cancelar, `v_cancelacion_liquidacion` solo cuenta cobros APROBADO, así que **no hay reembolso**. El admin ve "Pago" en Administración → Reservas (`GET /host/orders?estado_pago=PENDIENTE|APROBADO`, `GET /host/orders/:id`) y registra el cobro con `POST /host/orders/:id/confirm-payment` (solo ADMIN; idempotente: si ya estaba confirmado responde 200 con `ya_confirmado: true`; 409 si no es efectivo o la reserva está cancelada; evento `pago_confirmado` en el log `auditoria`). El contrato oficial no se modificó (`contract:check` 17/17).
- **Tarjetas de prueba** (ayuda visible solo con `?demo=1`): `4242 4242 4242 4242` aprobada · `4000 0000 0000 0002` rechazada · `4000 0000 0000 9995` fondos insuficientes. Cualquier otra con Luhn válido se aprueba.
- **Confirmación inmediata:** todas las reservas quedan CONFIRMADAS al aprobarse el pago (ya no hay reserva "por solicitud"). El **emisor** de la factura es el dueño del alojamiento; para el catálogo de Posada EC, el administrador. Su cuenta demo no tenía documento y la factura salía sin identificación del emisor, por eso `database/datos_admin_emisor.sql` le asigna un **RUC ficticio** (`1799999999001`, marcado como demo).

### Reseñas con control automático

Solo reseña el **huésped** de una reserva **COMPLETADA**, una vez por reserva (servicio + trigger `tg_resena_validar` + `uq_resena_reserva`). El comentario es opcional y pasa un control automático, sin revisión humana ni moderación del admin: 10 a 1000 caracteres, texto sanitizado, sin un mismo carácter 4+ veces seguidas, sin enlaces, correos ni teléfonos, y sin groserías (lista corta en español en `backend/src/common/validation/groserias.ts`, comparada sin tildes ni mayúsculas). El backend es la fuente de verdad (`texto-libre.ts`, ProblemDetails 400 "Tu reseña contiene lenguaje inapropiado, edítala e inténtalo de nuevo"); el frontend repite las mismas reglas en vivo.
- No se envían correos: la confirmación se muestra en pantalla con el **código de reserva** (`BK-XXXXXXXX`).

## 10. Limitaciones

- Pagos y facturas **simulados con fines académicos** (sin pasarela real ni autorización del SRI); los datos de tarjeta no salen del navegador.
- OAuth2 simplificado: no hay servidor de autorización ni `client_credentials` (Reto 2).
- Webhooks sin entrega real; bus de eventos en memoria (se pierde al reiniciar; el outbox no, porque `publicado_en` solo se marca tras publicar).
- Un solo idioma (`es`), una moneda (`USD`), un país (`ec`); sin cadenas hoteleras ni planes de comida.
- Rate limit en memoria (por instancia); con varias instancias habría que usar Redis.
- El plan gratuito de Supabase se pausa por inactividad y el de Render "duerme": la primera petición tarda.
- Las pruebas automáticas son pocas: 62 en el frontend (`ng test`) y 60 en el backend (`npm test`, lógica pura sin BD), más los scripts de prueba del API; el precio y el reembolso (funciones SQL) no tienen prueba unitaria y no hay contract testing avanzado (Reto 2). Ver §17.
- *Eliminar* alojamiento (Administración) usa el estado SUSPENDIDO que ya existía: sale de las búsquedas y conserva su historial. Un borrado real o un estado "archivado" requeriría cambiar el contrato.
- La observabilidad del frontend es **local de cada navegador** (ver §14); no hay agregación central de métricas del cliente.

## 11. Despliegue

Producción = **Supabase** (BD) + **Render** (backend) + **Vercel** (frontend). Orden de los pasos:

1. **Supabase.** Crear el proyecto y ejecutar en el SQL Editor, en orden, `database/01_esquema.sql`, `02_datos_demo.sql` y `03_integracion.sql`. Copiar la URL del **pooler** (Connect → *Session pooler*, IPv4): `postgresql://postgres.<ref>:<CLAVE>@aws-0-<region>.pooler.supabase.com:5432/postgres`. La conexión directa `db.<ref>.supabase.co` es solo IPv6 y Render no la alcanza.
2. **Render (backend).** New → Blueprint con `render.yaml` (raíz, `rootDir: backend`, `npm ci && npm run build`, `npm run start:prod`, health check `/health`). Cargar las variables marcadas `sync: false`. Comprobar `https://<servicio>.onrender.com/health` y que el log diga `BD verificada: 27 tablas`.
3. **Vercel (frontend).** Poner la URL de Render en `frontend/src/environments/environment.ts` (`apiUrl`) e importar el repo con *Root Directory* `frontend` (usa `frontend/vercel.json` para el *rewrite* de la SPA).
4. **Cerrar el círculo.** Actualizar en Render `CORS_ORIGINS` y `PUBLIC_WEB_URL` con la URL final de Vercel y volver a desplegar.

| Variable (Render) | Valor |
|---|---|
| `DATABASE_URL` | URL del pooler de Supabase (el backend activa SSL porque el host no es `localhost`) |
| `APP_ENV` / `NODE_ENV` | `production` (activa HSTS, redirección HTTPS y valida el secreto) |
| `JWT_SECRET` | generado por Render (≥ 32 caracteres; sin él la app no arranca) |
| `JWT_EXPIRES_IN` | `30m` |
| `CORS_ORIGINS` / `PUBLIC_WEB_URL` | URL de Vercel (sin `*`) |
| `API_PUBLIC_URL` | URL del servicio en Render (enlaces HATEOAS) |
| `API_DEPRECATION_DATE` | `2027-12-31` |
| `JOBS_ENABLED` | `true` |

## 12. Docker

`docker-compose.yml` (raíz) levanta **un solo contenedor** `booking_db_container` (`postgres:16`, BD `booking_db`, usuario/clave `postgres`, puerto `5432`, volumen `pgdata`). Los tres scripts de `database/` se montan **solo lectura** en `/docker-entrypoint-initdb.d/` y Postgres los ejecuta en orden la primera vez que el volumen está vacío, dejando las **27 tablas** del schema `booking` con los datos demo.

```bash
docker compose up -d        # crea la BD local
# backend/.env -> DATABASE_URL=postgresql://postgres:postgres@localhost:5432/booking_db
docker compose down -v      # borra contenedor y volumen (la próxima vez se reejecutan los scripts)
```

- `database.module.ts` (`usarSsl`) usa SSL solo si el host **no** es `localhost`/`127.0.0.1`/`::1`: Docker sin TLS, Supabase con TLS.
- Healthcheck `pg_isready -U postgres -d booking_db` (cada 5 s, 20 reintentos). Durante la inicialización `pg_isready` puede responder antes de que terminen los scripts: el indicador fiable es `PostgreSQL init process complete` en los logs.
- **Probado el 2026-10-05** (Postgres 16 limpio): los tres scripts corren sin errores (verificado de nuevo desde cero tras fundir `alojamiento_codigo` en `alojamiento`), 17 funciones `fn_*`, 10 vistas `v_*`, 10 usuarios, 20 alojamientos y 10 reservas demo. Con el backend apuntando al contenedor pasaron `/health` (`db: up`), login, `/search`, `/availability`, `orders/preview`, `orders/create` (incluida la repetición con la misma `Idempotency-Key`, que devuelve la misma orden), `orders/{id}/cancel` y `/admin/indicators`. En los logs aparecen los eventos de auditoría `login_ok`, `login_fallido` (correo enmascarado), `acceso_401` y `acceso_403`, sin contraseñas ni tokens.
- **Probado el 2026-10-05 (simplificación)**: en bases temporales (copia de `booking_db` con `pg_dump`, nunca la real) las migraciones `migracion_admin_dueno.sql`, `migracion_sin_reportes.sql`, `datos_modo_inmediato.sql` y `datos_admin_emisor.sql` corren dos veces seguidas sin error (idempotentes) y dejan 27 tablas; los scripts 01→02→03 desde cero también dejan 27 tablas. Un backend temporal contra esa copia pasó 49 pruebas: huésped → 403 en `/admin/…` y en las rutas de catálogo; registro con `rol` → 400; ADMIN crea ("Todo el alojamiento" y "Varios tipos"), edita (propios y ajenos), publica, despublica, suspende y reactiva; reserva con pago aprobado → CONFIRMADA con factura emitida por Posada EC; reseñas rechazadas por groserías, repeticiones, contactos y largo, y aceptadas una sola vez tras una estancia completada.
- **Probado el 2026-10-06 (limpieza)**: con PostgreSQL embebido (PGlite, en memoria; sin tocar `booking_db` ni Supabase), los scripts 01→02→03 actuales dejan 27 tablas, 5 tipos, 0 reservas PENDIENTE y la demo sin registro/LUAF. Sobre una BD con los scripts anteriores más una solicitud PENDIENTE y un feriado con la condición antigua, `datos_sin_pendientes.sql`, `datos_iva_feriados.sql` y `datos_tipos_alojamiento.sql` corren dos veces sin error: la PENDIENTE queda EXPIRADA (con su evento), el IVA del feriado (8 %) aplica a un alojamiento sin registro ni LUAF y "Hostería Baños Termas" → Hotel, "Habitación Privada Centro Cuenca" → Casa.
- **Probado el 2026-10-06 (sin aeropuertos)**: sobre la BD `booking_db` de Docker (con respaldo `pg_dump` previo) se aplicaron en orden `migracion_admin_dueno`, `migracion_sin_reportes`, `migracion_pago_metodo`, `datos_modo_inmediato`, `datos_tipos_alojamiento`, `datos_sin_pendientes`, `datos_iva_feriados`, `datos_admin_emisor` y `migracion_sin_aeropuertos` sin errores: quedan 25 tablas, 5 tipos, 0 reservas PENDIENTE y `fn_buscar_alojamientos` responde sin parámetros de aeropuerto. En un contenedor temporal, los scripts 01→02→03 desde cero también dejan 25 tablas y 20 alojamientos sin errores. El backend compila (`tsc --noEmit`) y el frontend compila (`ng build`). **No** se probó en el navegador ni contra Supabase: la migración `migracion_sin_aeropuertos.sql` debe ejecutarse allí antes de desplegar.
- Docker es **solo para desarrollo**. En producción la BD es **Supabase** (backups, pooler y panel administrados); el backend corre en Render sin contenedor propio.

## 13. Dependencias vulnerables

Resultado de `npm audit --omit=dev` (dependencias que llegan a producción) al 2026-10-05:

| Proyecto | Total | Bajas | Moderadas | Altas | Críticas |
|---|---|---|---|---|---|
| backend | **15** | 1 | 10 | 4 | 0 |
| frontend | **7** | 0 | 3 | 4 | 0 |

(Con dependencias de desarrollo incluidas salen 30 y 40; esas no se despliegan: CLI, Karma, servidor de desarrollo.)

**Por qué no se actualizan ahora.** El arreglo de 12 de los 15 avisos del backend y de los 7 del frontend exige un **salto de versión mayor**: NestJS 10 → 11/12 (`@nestjs/core`, `platform-express`, `swagger`, `config`, `schedule`, `typeorm`, `throttler`) y Angular 19 → 21. Son migraciones con cambios incompatibles (Express 5, nuevas APIs de NestJS, control flow y builders de Angular) que requieren reprobar todo el contrato a días de la entrega. No se usa `npm audit fix --force`. Los 3 restantes del backend (`@nestjs/common`, `qs`, `file-type`) tienen arreglo sin versión mayor y quedan pendientes para aplicarlos con `npm audit fix` (sin `--force`) y volver a correr build + `contract:check`.

**Por qué el riesgo es bajo en este prototipo.**

| Paquete | Aviso | Por qué no aplica / mitigación |
|---|---|---|
| `multer`, `file-type` | DoS en subida multipart y en parsers de archivos | **No hay subida de archivos**: no hay `FileInterceptor` ni endpoints `multipart/form-data`; las imágenes son URLs |
| `@angular/core`, `@angular/compiler` (i18n) | XSS en atributos de eventos traducidos | **No se usa i18n** de Angular (un solo idioma, sin `$localize` ni `i18n`) |
| `@angular/common` (`HttpTransferCache`), `@angular/core` (hydration), `@angular/router` (SSR) | fugas de caché, DOM clobbering, DoS en el servidor | **No hay SSR** ni hidratación: la app es una SPA estática en Vercel |
| `@angular/compiler`/`core` (bypass de sanitización en bindings) | XSS si se enlaza HTML controlado por el usuario a propiedades sensibles | el frontend no usa `innerHTML` ni `bypassSecurityTrust*`; los únicos bindings con datos de usuarios son `[src]` de imágenes (URLs que pasan por el sanitizador de Angular) e interpolación de texto. Riesgo bajo, se elimina con Angular 21 |
| `@angular/common` (`formatDate`) | DoS por memoria con formatos manipulados | los formatos de fecha son constantes del código, no entrada del usuario |
| `js-yaml`, `lodash` (vía `@nestjs/swagger`) | prototype pollution / DoS | solo se usan al generar Swagger al arrancar, sin entrada del usuario |
| `body-parser` | límite inválido desactiva el tope de tamaño | el límite se fija explícitamente a `100kb` en `main.ts` |
| `uuid` (vía `@nestjs/schedule`) | falta de chequeo al pasar `buf` | el código no llama a `uuid` con `buf` |
| `@nestjs/core`, `qs` | inyección en salida / DoS en el parser de query | expuestos; mitigados por `ValidationPipe` con lista blanca, rate limit y el límite de cuerpo; se corrigen con la migración a NestJS 11 (Reto 2) |

## 14. Dashboard del administrador y observabilidad

### Dashboard (Administración → Dashboard)

Solo frontend, sobre endpoints de **solo lectura** que ya existían (no hubo cambios de BD, contrato ni endpoints nuevos):

| Bloque | Fuente | Cálculo |
|---|---|---|
| KPI: reservas confirmadas, ventas totales, alojamientos publicados, usuarios activos | `GET /admin/indicators` | directo |
| KPI: ticket promedio, tasa de cancelación | `/admin/indicators` + `GET /admin/sales-by-city` | ticket = ventas ÷ reservas confirmadas y completadas; cancelación = canceladas ÷ (vendidas + canceladas) |
| Mejor reseñados (top 5, estrellas = nota ÷ 2 a media estrella, "Nuevo" sin reseñas) | `GET /admin/accommodations?estado=PUBLICADO` + `POST /details` (contrato) | orden por nota media y número de reseñas |
| Ventas por ciudad (barras horizontales HTML/CSS) | `/admin/sales-by-city` | directo |
| Ventas por mes (columnas SVG, últimos 12 meses) | `GET /host/orders` (páginas de 100) | suma en el frontend de reservas confirmadas/completadas por mes de creación (`agruparPorMes`) |
| Mapa (Leaflet, un marcador por alojamiento publicado) | `POST /details` (`location`, ciudad, calificación) | la ventana emergente muestra nombre, ciudad y calificación; **nunca** coordenadas |

Gráficos propios en SVG/CSS (sin librerías nuevas), de una sola serie con el color primario; cada uno con título, texto alternativo (`role="img"` + `aria-label` con el resumen), tooltip nativo y una **tabla de datos equivalente** ("Ver datos en tabla"). Estados de carga, vacío y error por bloque; en móvil sin scroll horizontal.

### Observabilidad local

Disponible en la página pública **`/observabilidad`** (enlace en el pie) y en Administración → Observabilidad. Solo usa datos de **este navegador**.

`ObservabilidadService` (`frontend/src/app/core/services/observabilidad.service.ts`) arranca con la app (`provideAppInitializer`) y guarda en `localStorage` con claves de prefijo **`posadaec-observability`** (`posadaec-observability:v1`; la clave antigua `posada-observability:v1` se migra una vez y se borra), con un máximo de **200 eventos** que rotan (los más antiguos se descartan). Si `localStorage` no existe o falla, los eventos quedan en memoria. **No hay backend ni envío de datos.** Todo va en `try/catch`: si `localStorage`, `PerformanceObserver` u otra API no existe, el sitio sigue funcionando.

| Se registra | Cómo |
|---|---|
| Tiempos de carga: primer byte, DOM listo, carga total, FCP y LCP | Performance API (`navigation`, `paint`) y `PerformanceObserver` (LCP) si existen |
| Errores JavaScript y de Angular | `ErrorHandler` propio (`ObservabilidadErrorHandler`) y `window` `error` |
| Promesas rechazadas | `unhandledrejection` |
| Recursos que no cargan (imágenes, scripts, estilos) | listener `error` en fase de captura |
| Clics en enlaces, botones, pestañas y controles | tipo de elemento + etiqueta corta (máx. 40 caracteres) |
| Visibilidad de la pestaña | `visibilitychange` |
| Llamadas al API | `observabilidadInterceptor`: método, **ruta con patrón** (`/orders/:id/cancel`, `/accommodations/:n`), estado y duración en ms |
| Entorno | viewport, `navigator.connection` si existe y soporte de APIs (Performance, localStorage, portapapeles, `<dialog>`, etc.) |

| **NO** se registra | Garantía |
|---|---|
| Valores de campos | de `input/select/textarea` nunca se lee `value`; solo su etiqueta, `name` o tipo |
| Contraseñas y datos de tarjeta | esos campos quedan como `campo:password` / `campo:tarjeta` con etiqueta "(oculto)" |
| Números largos, correos y tokens dentro de textos | `limpiarTexto` enmascara 4+ dígitos (••••), correos ([correo]) y cadenas tipo token ([token]) |
| Cuerpos, cabeceras y tokens de peticiones; IDs y query strings | el interceptor solo toma método, ruta con patrón, estado y ms |
| Query strings y fragmentos dentro de textos (p. ej. URLs en mensajes de error) | `limpiarTexto` los quita (`https://h/a?token=x#f` → `https://h/a`) |

`window.PosadaObservability.getSnapshot()` devuelve el estado completo (entorno, métricas, resumen y eventos). El panel muestra el resumen (errores, clics, llamadas al API, p95 de latencia, tiempo de carga, LCP, soporte de APIs), la tabla de los últimos 50 eventos y los botones **Actualizar**, **Generar evento de demostración**, **Descargar snapshot JSON** y **Limpiar almacenamiento** (con el diálogo de confirmación de `confirmar.ts`); avisa por `aria-live`. Si el navegador no ofrece una métrica o API, la tarjeta muestra "No disponible".

**Cómo probarlo:** abrir `/observabilidad`; hacer clic en un botón o enlace; en la consola ejecutar `setTimeout(() => { throw new Error('prueba') })` (aparece como "Error JS"); pulsar *Generar evento de demostración*; cambiar de pestaña y volver ("Pestaña oculta/visible"); pulsar *Actualizar*, *Descargar snapshot JSON* y *Limpiar almacenamiento*. En la consola, `window.PosadaObservability.getSnapshot()` devuelve lo mismo que el JSON descargado. Pruebas automáticas: `npm test` en `frontend/` (límite de 200 y rotación, prefijo y migración de la clave, saneado de URLs, sin valores de campos ni tarjetas, snapshot serializable, rutas con patrón, p95, tolerancia a `localStorage` caído, interceptor sin cuerpos ni cabeceras).

**Limitación:** solo mide **el navegador local** de quien lo abre; no hay vista agregada de todos los usuarios. Del lado del servidor ya existen logs JSON con `X-Correlation-Id`, auditoría de accesos y `/health` (§5). **Evolución:** trazas y métricas del servidor con OpenTelemetry (exportador OTLP) y Prometheus/Grafana, y, si se quisiera agregar datos del cliente, un endpoint de ingesta con consentimiento y muestreo.

## 15. SOA, ESB y mensajería (semana 5)

> **Qué está implementado y qué es diseño.** Implementado hoy: tabla `evento_outbox` llenada por triggers en la misma transacción que el cambio, job publicador cada 5 s (`publicar-outbox`, `FOR UPDATE SKIP LOCKED`, marca `publicado_en` solo después de publicar), bus **en memoria** (`backend/src/modules/jobs/bus-eventos.ts`) con un consumidor de auditoría idempotente, `correlacion_id` + `GET /orders/{id}/timeline`, y filas en `webhook_entrega`. **Diseño (no desplegado):** el broker, el exchange `posada.eventos`, las colas por consumidor, las DLQ y los consumidores fuera del proceso.

**Operaciones como servicios.** Cada capacidad del dominio se expone como una operación con contrato propio (REST, `/api/v1`), sin que el cliente conozca la BD:

| Servicio | Operaciones (contrato) | Dueño de los datos |
|---|---|---|
| Catálogo | `search`, `details`, `availability`, `reviews`, `reviews/scores`, `constants` | alojamiento, unidad, calendario, reseña |
| Órdenes | `orders/preview`, `orders/create`, `orders/{id}`, `modify`, `cancel`, `cancel-preview` | reserva, pago, cancelación |
| Facturación | `orders/{id}/invoice` (la emite `fn_crear_orden`, se anula al cancelar) | factura |
| Cuenta | `auth/*`, `me/*`, `me/orders` | usuario |
| Operación (admin) | `host/*` (catálogo, reservas, cobro en efectivo, reseñas), `admin/*` (estados, catálogos, impuestos, eventos, jobs) | — |

**ESB / API Gateway.** En una SOA clásica un ESB enruta, transforma, asegura y orquesta. En este prototipo ese papel lo cumple el **backend NestJS** como punto de entrada único (estilo *API Gateway*, "endpoints inteligentes, tuberías simples"): autenticación JWT con scopes y roles, validación de DTO, rate limit, `X-Correlation-Id`, `Idempotency-Key` + reproducción de respuestas, traducción de errores a ProblemDetails y del contrato (`snake_case`, ids opacos) al modelo de la BD. No hay orquestación pesada en un bus: la lógica transaccional vive en funciones de la BD y la integración asíncrona sale por eventos.

**Diseño de mensajería con un exchange tipo *topic*.** El publicador del outbox dejaría de llamar al bus en memoria y publicaría en el exchange `posada.eventos` (durable). La *routing key* se deriva del `tipo` del evento:

| Evento (outbox) | Routing key |
|---|---|
| `ReservaCreada` / `ReservaModificada` / `ReservaCancelada` | `reserva.creada` / `reserva.modificada` / `reserva.cancelada` |
| `PagoRegistrado` / `ReembolsoRegistrado` | `pago.registrado` / `pago.reembolsado` |
| `FacturaEmitida` / `FacturaAnulada` | `factura.emitida` / `factura.anulada` |
| `EstanciaCompletada`, `ResenaPublicada` | `estancia.completada`, `resena.publicada` |
| `AlojamientoPublicado` / `AlojamientoSuspendido` | `alojamiento.publicado` / `alojamiento.suspendido` |

**Una cola por consumidor** (cada uno recibe su copia y avanza a su ritmo):

| Cola | Binding | Para qué |
|---|---|---|
| `q.auditoria` | `#` | lo que hoy hace `AuditoriaConsumidor` |
| `q.webhooks` | `reserva.creada`, `reserva.cancelada` | entregar `ORDER_CONFIRMED` / `ORDER_CANCELLED` (hoy solo se crean filas en `webhook_entrega`) |
| `q.notificaciones` | `reserva.*`, `pago.*` | correos/avisos al huésped (hoy no se envían correos) |
| `q.facturacion-sri` | `factura.*` | autorización electrónica real (hoy la factura es simulada) |
| `q.analitica` | `#` | alimentar el dashboard sin consultar las tablas transaccionales |

**Mapeo con el outbox.** Cada mensaje lleva `message_id = evento_outbox.id`, `correlation_id = correlacion_id`, `type = tipo` y el `payload` como cuerpo JSON. El publicador usa *publisher confirms*: solo cuando el broker confirma se marca `publicado_en`; si el proceso cae antes, el evento se vuelve a publicar (entrega **al menos una vez**).

**Idempotencia y DLQ.** Como puede haber duplicados, cada consumidor guarda `(consumidor, evento_id)` como clave única antes de actuar (hoy el consumidor de auditoría lo hace en memoria con un `Set`; en producción sería una tabla). Cada cola declara un *dead-letter exchange* `posada.eventos.dlx`: tras N reintentos con espera creciente, el mensaje va a `q.<consumidor>.dlq` para revisión manual y reproceso, sin bloquear la cola principal. El orden entre eventos de una misma reserva se conserva publicando en orden de `id` (y, en Kafka, usando `correlacion_id` como clave de partición).

**RabbitMQ vs Kafka.** RabbitMQ encaja mejor con este volumen y este patrón: enrutamiento por *topic*, una cola por consumidor, ack por mensaje, DLQ y reintentos nativos. Kafka conviene cuando se necesita retener el log y **reproducirlo** (rehacer proyecciones, analítica), con alto volumen y orden por partición, a cambio de más operación (particiones, retención, grupos de consumo).

**Por qué no se despliega hoy.** El prototipo corre en planes gratuitos (Render + Supabase) sin broker administrado, en un solo proceso y sin consumidores externos todavía. El outbox ya garantiza que ningún evento se pierda (si el bus en memoria falla, `publicado_en` queda nulo y se reintenta), así que añadir un broker sumaría costo y operación sin un consumidor que lo necesite. Pasar a RabbitMQ solo cambia el publicador (los productores, que son los triggers, no cambian); es trabajo del Reto 2 junto con la entrega real de webhooks.

## 16. Guía de usuario

**Huésped**

1. **Buscar:** en el inicio elige destino (provincia y ciudad), fechas y huéspedes (adultos, niños, habitaciones); "Más filtros" agrega tipo, estrellas mínimas, precio máximo y orden. Los resultados muestran el precio "desde" por noche.
2. **Ver el alojamiento:** fotos, descripción, comodidades, política de cancelación con sus tramos, horarios y reseñas. La tarjeta lateral recalcula el precio al cambiar fechas o huéspedes y explica por qué un tipo de habitación no está disponible.
3. **Reservar:** "Reservar" pide iniciar sesión (o crear cuenta). El precio queda garantizado 15 minutos.
4. **Datos de la factura:** Cédula, RUC, Pasaporte o Consumidor final. No se guardan en el perfil.
5. **Pagar:** con **tarjeta** (simulada; los datos no salen del navegador; con `?demo=1` se ven tarjetas de prueba para aprobar o rechazar) o en **efectivo** al llegar (la reserva queda confirmada y el pago pendiente). El resumen muestra la política con fechas concretas ("gratis hasta el …").
6. **Confirmación:** muestra el **código de reserva** (`BK-…`), que se puede copiar.
7. **Mis reservas:** pestañas Próximas, Completadas y Canceladas. En cada viaje: *Ver detalle* (historial de eventos), *Cambiar fechas*, *Factura* y *Cancelar*. Antes de cancelar se ve la penalidad y el reembolso calculados; con efectivo no pagado no hay cobro ni reembolso. Después de la estadía aparece *Calificar*.
8. **Perfil:** nombre y teléfono, con *Guardar* y *Cancelar*. *Salir* pide confirmación.

**Anfitrión y administrador.** En este prototipo no hay portal de anfitrión (las rutas `/anfitrion/...` muestran un aviso): el **administrador** opera el catálogo de Posada EC desde *Administración*:

- **Dashboard:** indicadores, ventas por mes, mapa de alojamientos y rankings.
- **Alojamientos:** filtrar y buscar; *+ Nuevo alojamiento* abre un asistente por pasos que guarda un borrador; *Editar* abre la edición por secciones (información, ubicación, reglas y política, habitaciones y precios, precios por fecha opcionales, fotos), cada una con *Guardar cambios* y *Descartar cambios*; *Publicar* / *Despublicar*, *Suspender* / *Reactivar* y *Eliminar* (pide confirmación y se bloquea si hay reservas activas; internamente usa la suspensión, ver §10).
- **Reservas:** filtrar por estado y pago; *Confirmar pago recibido* para las reservas en efectivo.
- **Reseñas:** responder una vez cada reseña.
- **Usuarios:** activar o desactivar cuentas.
- **Catálogos:** amenidades y ciudades. **Impuestos y feriados:** registrar tarifas con vigencia y cerrarlas.
- **Eventos**, **Jobs** (ejecutar a mano) y **Observabilidad** (también pública en `/observabilidad`).

## 17. Calidad de código

| Proyecto | Herramienta | Comando | Resultado (2026-10-06) |
|---|---|---|---|
| Frontend | ESLint (`angular-eslint` 19, configuración por defecto + plantillas accesibles) | `cd frontend && npm run lint` | All files pass linting |
| Frontend | Karma + Jasmine | `cd frontend && npx ng test --watch=false --browsers=ChromeHeadless` | 62 pruebas, 62 OK (última corrida completa registrada) |
| Frontend | Compilación | `cd frontend && npm run build` | OK |
| Backend | ESLint 9 (flat config, `typescript-eslint` recomendado), sin `--fix` | `cd backend && npm run lint` | 0 problemas |
| Backend | Jest + ts-jest | `cd backend && npm test` | 11 suites, 60 pruebas OK |
| Backend | Compilación | `cd backend && npm run build` | OK |

- **Qué cubren las pruebas.** Frontend: validadores de formularios (teléfono, tarjeta, CVV, nombres, precios), la directiva que filtra la escritura, la política de cancelación con fechas, la búsqueda, las agregaciones del dashboard y la observabilidad. Backend: `IdempotencyKeyGuard` (UUID válido, ausente o mal formado), cédula/RUC y saneo de texto libre, cursor de paginación y conteo de noches.
- **Qué no cubren.** El precio (hospedaje, servicio, IVA) y el reembolso por política se calculan en la BD (`fn_cotizar`, `v_cancelacion_liquidacion`); no son aislables sin BD y no tienen prueba unitaria. Se verificaron con los scripts SQL y pruebas manuales del API.
- **Excepciones de lint, documentadas en el código.** Frontend: cuatro avisos de accesibilidad de plantilla en patrones con alternativa de teclado (clic en el fondo del diálogo = Esc, cierre del menú móvil, Esc en el panel de huéspedes) y el alias del parámetro de ruta `:codigo`. Backend: `no-control-regex` en el saneo de texto (quitar caracteres de control es su propósito) y variables descartadas con prefijo `_`.

## 18. Reflexión final

**Decisiones.** (1) *API-first*: el contrato YAML se respetó y las extensiones (datos de factura, pago en efectivo) son opcionales, comprobadas con `contract:check`. (2) La **lógica crítica en la BD** (precio, cupo con `FOR UPDATE`, máquina de estados, penalidades, eventos) para que la consistencia no dependa de la aplicación. (3) Un **monolito modular** en NestJS en vez de microservicios, por el tamaño del equipo y los planes gratuitos. (4) **Outbox transaccional** desde el inicio, aunque el bus sea en memoria. (5) Pagos y facturas **simulados**, sin que los datos de tarjeta salgan del navegador.

**Aprendizajes.** Poner reglas en la BD evita inconsistencias, pero vuelve más difícil probarlas de forma aislada y obliga a repetir validaciones en el frontend para dar mensajes claros (el backend sigue siendo la fuente de verdad). El outbox separa "qué pasó" de "quién se entera", lo que hace barato cambiar luego el transporte. Mantener el contrato estable mientras el producto cambia exigió diseñar las extensiones como campos opcionales.

**Limitaciones** (detalle en §10). Sin pasarela de pago ni SRI reales; sin broker ni entrega real de webhooks; rate limit y deduplicación del consumidor en memoria; pocas pruebas automáticas del backend y ninguna de las funciones SQL de precio y reembolso; no hay portal de anfitrión; *Eliminar* alojamiento es una suspensión, porque un borrado real (o un estado "archivado") requeriría cambiar el contrato.

**Evolución a microservicios** (§6). Separar por dueño de datos: Catálogo, Órdenes, Facturación, Cuenta y Notificaciones, cada uno con su BD; las vistas cruzadas se convierten en proyecciones alimentadas por eventos; el publicador del outbox pasa a RabbitMQ (§15) y el backend actual queda como API Gateway. Lo primero a extraer serían Notificaciones y Webhooks, porque ya solo dependen de eventos.

## 19. Pruebas de seguridad

Pruebas **solo locales** (2026-10-06): backend `dist/main` en `http://localhost:3100` contra un Postgres 16 en Docker cargado con `01`, `02`, `03` y `datos_catalogo_extra.sql`. Nada contra Render, Vercel ni Supabase (el script se niega si la URL no es `localhost`). Batería: `backend/scripts/pruebas-seguridad.py` → **74 OK · 0 FALLA · 1 INFO**.

| OWASP Top 10 (2021) | Prueba | Evidencia |
|---|---|---|
| **A01 Control de acceso** | Matriz endpoint × rol (anónimo, USUARIO, "anfitrión" = USUARIO dueño de alojamientos, ADMIN) e IDOR | `/me*` → 401 anónimo; `/admin/*` y `/host/*` → 403 a USUARIO y anfitrión, 200 a ADMIN. Una huésped contra la reserva de otro: ver, factura, historial, cancel-preview, modificar, cancelar y reseñar → **404**; la reserva de la víctima sigue CONFIRMADA |
| **A07 Identificación y autenticación** | JWT y fuerza bruta | Sin token, basura, payload manipulado, expirado, firmado con otro secreto y `alg: none` → **401**; USUARIO en `/admin` → **403**. Login: mismo 401 y mensaje ("Correo o clave incorrectos") con correo existente o no; 6.º intento → **429** con `Retry-After: 60`; registro → 429 al 6.º |
| **A03 Inyección** | SQLi y XSS | `sort_by`, `province`, `city`, `max_price` con SQL → **400** (DTO con enum/tipos); `q` y `busqueda` del admin con `' OR '1'='1` → 0 resultados (consultas parametrizadas); nombres con `<script>` → 400; descripción con `<img onerror>`/`<script>` se guarda **sin etiquetas** (`@Sanitizar`); el frontend no usa `innerHTML` (Angular escapa); URLs de imagen `javascript:`, `http:` y `data:` → **400** (solo `https`) |
| **A04 Diseño inseguro / A08 Integridad** | Idempotencia y doble cobro | Sin `Idempotency-Key` → 400; misma clave → misma orden con `Idempotent-Replayed: true`; misma clave y otro cuerpo → 409; **otra clave con el mismo preview → la misma orden, 1 cobro y 1 factura**. Hallazgo corregido: ese reenvío reescribía el comprador de la factura ya emitida (ahora solo se toca la emitida en la misma transacción) |
| **A05 Configuración insegura** | Cabeceras, CORS, Swagger, /health | helmet: CSP `default-src 'self'`, `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, CORP `same-site`, sin `X-Powered-By`; HSTS solo con `APP_ENV=production`. CORS: origen ajeno sin `Access-Control-Allow-Origin`, `http://localhost:4200` sí. `/api/docs-json` sin secretos; `/health` solo `status/app/db/timestamp` |
| **A09 Registro y fallos** | Fugas en errores | JSON mal formado, UUID inválido, ruta inexistente, cuerpo > 100 kB (413) y entero enorme → 4xx con `application/problem+json`; **ninguna** de las 72 respuestas de error contiene stack, rutas, `node_modules` ni SQL; **ningún 500** |
| **A06 Componentes vulnerables** | `npm audit` | Con dependencias de desarrollo incluidas: backend 62 avisos (40 altos) y frontend 2 críticos/26 altos; las cifras de producción (`--omit=dev`) están en la sección 13 (backend 15, frontend 7). Casi todos en herramientas de desarrollo (Jest, Karma, CLI/build de Angular y Nest) y su arreglo exige versión mayor (Angular 21, NestJS 12, Jest 30): no se aplica. En ejecución: avisos de Angular (i18n, hidratación SSR) que la app no usa, y de `@nestjs/platform-express`/`swagger` (multer, js-yaml, lodash) también con salto mayor. Aplicado: `typescript-eslint` 8.71 (menor) |
| **A02 Datos sensibles / secretos** | Repositorio e historial | `.env` ignorado; solo se versiona `.env.example` (sin valores). `git grep` y `git log --all -S/-G` de cadenas de conexión, JWT, `JWT_SECRET=`, `service_role`, `sbp_`: solo plantillas y `localhost` |

**Hallazgos abiertos** (sin cambio de código en esta rama): (1) las cuentas demo, incluida la del ADMIN, usan la clave `Demo1234!`, publicada en el README y en `02_datos_demo.sql`: en un despliegue público hay que cambiar la clave del ADMIN o desactivar las cuentas demo. (2) Con `trust proxy 1` y acceso **directo** al backend, `X-Forwarded-For` falsificado evade el rate limit; detrás de un único proxy (Render) la IP real es la última del encabezado, pero conviene verificarlo en el despliegue.

**Cómo repetirlas** (desde la raíz):

```bash
# ESLint (sin --fix) y pruebas
cd backend && npm run lint && npm test && npm run build && cd ..
cd frontend && npm run lint && npx ng test --watch=false --browsers=ChromeHeadless && npm run build && cd ..
# BD Docker temporal + backend local en :3100 (no toca el .env ni Supabase)
docker run -d --name pg_seg -e POSTGRES_PASSWORD=segpass -e POSTGRES_DB=booking_db -p 55432:5432 postgres:16
for f in 01_esquema 02_datos_demo 03_integracion datos_catalogo_extra; do docker exec -i pg_seg psql -U postgres -d booking_db -q < database/$f.sql; done
cd backend && DATABASE_URL=postgresql://postgres:segpass@localhost:55432/booking_db PORT=3100 APP_ENV=development \
  JWT_SECRET=seguridad-local-0123456789abcdefghijklmnopqrstuvwxyz-ABCDEFG CORS_ORIGINS=http://localhost:4200 JOBS_ENABLED=false node dist/main &
python scripts/pruebas-seguridad.py http://localhost:3100 seguridad-local-0123456789abcdefghijklmnopqrstuvwxyz-ABCDEFG
# npm audit y secretos
(cd backend && npm audit) ; (cd frontend && npm audit) ; git log --all -S "JWT_SECRET=" --oneline
docker rm -f pg_seg
```

## Anexo. Correcciones posteriores a la auditoría (2026-10-11)

Resultado de `AUDITORIA.md` (partes A y B). Lo aplicado en código: el guard JWT **revalida en la BD** que la cuenta siga activa y toma el **rol vigente** (caché de 10 s; `common/auth/guards.ts`), por lo que desactivar a un usuario o quitarle el rol surte efecto casi de inmediato; la URL de los webhooks se valida contra **SSRF** (sin IP, localhost, nombres internos ni credenciales; `common/validation/url-publica.ts`); la recuperación de clave ya no delata por tiempo si el correo existe; el frontend añade `Strict-Transport-Security`, `Permissions-Policy` y una **CSP en modo solo-reporte** (`vercel.json`, hay que revisar la consola antes de hacerla obligatoria); el foco se mueve al contenido al cambiar de página; se añadió **CI** (`.github/workflows/ci.yml`) y **Dependabot** (`.github/dependabot.yml`). Scripts SQL **opcionales** para ejecutar a mano: `database/produccion_asegurar_cuentas_demo.sql` (cambia la clave pública `Demo1234!`) y `database/endurecer_rol_backend.sql` (rol `app_backend` con permisos mínimos; no probado contra Supabase real). Pendiente: `npm audit fix` sin `--force` en el backend (debe correrse en la máquina local), migración mayor NestJS/Angular, pruebas de integración con BD, envío real de webhooks (re-validar la IP resuelta por DNS).
