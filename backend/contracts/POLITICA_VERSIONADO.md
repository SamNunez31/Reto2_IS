# Política de versionado y compatibilidad de contratos

Aplica a todos los contratos de Posada EC: los OpenAPI por servicio (`backend/contracts/services/*-openapi.yaml`), el de eventos
(`backend/contracts/events/posada-events-asyncapi.yaml`) y los `.proto` (`backend/proto/`). Referencia del curso: Semana 7
(esquemas, compatibilidad y gestión de contratos) y Semana 9 (pruebas de contrato).

## 1. Qué contratos existen y quién manda

| Contrato | Archivo | Dueño | Versión actual |
|---|---|---|---|
| Contrato oficial de Alojamientos que consume Booking (v2) | `backend/contracts/alojamientos-openapi-v2.yaml` | **Booking** (Josselyn Cadena). Posada EC es *proveedor* | 2.2.0 |
| Contrato oficial de Alojamientos v1 | `backend/contracts/alojamientos-openapi.yaml` | Booking. No se modifica (`npm run contract:check`) | 1.x |
| Contrato propio completo (monolito) | `backend/contracts/posada-ec-openapi.yaml` | Posada EC. Se regenera desde la API real | 1.0.0 |
| Un contrato por microservicio | `backend/contracts/services/<servicio>-openapi.yaml` | Posada EC. Se generan con `npm run contract:split` | 1.0.0 |
| Eventos de dominio | `backend/contracts/events/posada-events-asyncapi.yaml` | Posada EC | 1.0.0 |
| Stock hacia Booking (gRPC) | `backend/proto/inventory.proto` | **Booking**. Posada EC es *cliente*. No se edita | v3 |

Regla de oro: **lo que pertenece a Booking no se toca**. Si hace falta un cambio, se pide por escrito y se registra en el CHANGELOG.

## 2. Número de versión (SemVer) `MAYOR.MENOR.PARCHE`

| Cambio | Sube | Ejemplos |
|---|---|---|
| Rompe a un consumidor existente | **MAYOR** | quitar o renombrar un campo; cambiar un tipo; volver *requerido* un campo opcional; estrechar una restricción (`maxLength`, `pattern`); quitar un valor de un `enum`; cambiar un código de estado; en Protobuf, reutilizar el número de un campo borrado |
| Agrega sin romper | **MENOR** | campo **opcional** nuevo; endpoint nuevo; evento nuevo; relajar una restricción; valor nuevo de un `enum` *(solo si los consumidores toleran valores desconocidos)* |
| No cambia el comportamiento del contrato | **PARCHE** | corregir una descripción, un ejemplo o un typo |

Un cambio **MAYOR** nunca reemplaza a la versión anterior de golpe: se publica la nueva en una ruta nueva (`/api/v3/...`) o un
canal nuevo, y la anterior sigue viva durante el periodo de convivencia (§4).

## 3. Compatibilidad exigida: BACKWARD

Un consumidor que ya entiende la versión N debe seguir funcionando con la versión N+1. En la práctica:

1. Campos nuevos **siempre opcionales**. El que consume aplica su propio valor por defecto.
2. Los consumidores **ignoran los campos que no conocen** (tolerant reader). Por eso los esquemas de respuesta y de eventos
   **no** usan `additionalProperties: false`. Excepción: las *peticiones* del canal v2 sí rechazan con 400 los campos
   desconocidos, porque así lo exige el contrato de Booking.
3. Los `enum` se tratan como abiertos del lado del consumidor.
4. Los identificadores públicos son estables: el código entero del alojamiento y el `orderId`; el UUID interno no sale a otros sistemas.
5. Los errores usan siempre `application/problem+json` (RFC 7807) con el código en el enum del contrato; un código nuevo es MENOR.

Los contratos que parten de otro (Booking) siguen **su** política: aquí solo se comprueba que Posada EC los cumple
(`npm run contract:check`, `npm run test:v2`).

## 4. Ciclo de vida y deprecación

`Diseño → Validación → Implementación → Prueba de contrato → Publicación → Deprecación → Retiro`

- **Deprecación:** se marca `deprecated: true` en el contrato, se anota en el CHANGELOG y se anuncia la fecha de retiro en el
  encabezado de respuesta `X-API-Deprecation-Date` (ya lo envía la API; hoy `API_DEPRECATION_DATE=2027-12-31` en `.env`).
- **Convivencia mínima:** una versión MAYOR anterior sigue disponible hasta esa fecha de retiro, que debe ser
  posterior a la entrega del siguiente reto.
- **Retiro:** solo después de la fecha de retiro y con el CHANGELOG actualizado.

## 5. Cómo se hace cumplir (no basta con documentar)

| Qué se comprueba | Comando | Cuándo |
|---|---|---|
| El contrato propio contiene las 17 operaciones oficiales y las respeta | `npm run contract:check` | antes de cada commit |
| Los contratos por servicio están al día respecto al contrato propio | `npm run contract:split -- --check` | antes de cada commit |
| La API real cumple el contrato v2 (125 comprobaciones) | `npm run test:v2` | antes de cada prueba con Booking |
| Un cambio de esquema no es MAYOR escondido | revisión del diff + CHANGELOG | en cada cambio de contrato |

**Pendiente (Semana 9):** pruebas de contrato proveedor↔consumidor (Pact) entre los servicios y con Booking, y comparación
automática BACKWARD de esquemas en CI.

## 6. Reglas de trabajo

1. Todo cambio de contrato va **antes** que el código (contract-first) y en el mismo commit que su entrada del CHANGELOG, pero
   nunca se cambia contrato y código sin revisar quién consume.
2. Los contratos generados no se editan a mano: se cambia el código o `scripts/dividir-contratos.js` y se regeneran.
3. Cada servicio publica **su** versión: un cambio en Catálogo no obliga a subir la versión de Reservas.
4. Los contratos viven en Git junto al código; el `.yaml` sin servidor que lo cumpla no cuenta como contrato.
