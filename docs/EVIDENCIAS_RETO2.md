# Evidencias del Reto 2 — cómo generarlas

Cada bloque dice qué comando correr y qué captura guardar para el entregable. Reemplaza `GW` por la URL del gateway (`https://posada-gateway....azurecontainerapps.io`) o `http://localhost:8080` en local.

## A. Arquitectura y gateway (entregables 1 y 5)
```bash
curl -i $GW/gateway/health                       # 200 {"status":"UP","gateway":"kong",...}
curl -i $GW/api/v2/alojamientos/health           # responde reservations; ver X-Service-Name y X-Gateway
curl -i $GW/api/v2/alojamientos/categorias       # responde catalog
curl -i $GW/api/v1/auth/login -X POST -H "content-type: application/json" -d "{}"   # responde identity (400 validación)
```
Captura: cabeceras `X-Service-Name: posada-reservations | posada-catalog | posada-identity`, `X-Gateway: posada-kong` y `X-Correlation-Id`. Azure Portal → Container Apps: captura de las 5 apps en *Running*.

## B. Aislamiento por servicio
Con las URLs internas no se puede llamar desde fuera; en local (`docker compose -f docker-compose.microservicios.yml up`) los servicios no publican puerto. Para demostrar que un servicio rechaza rutas ajenas en local, ejecutar dentro de la red:
```bash
docker compose -f docker-compose.microservicios.yml exec catalog wget -qO- http://identity:3000/api/v1/auth/login || true
docker compose -f docker-compose.microservicios.yml exec gateway kong version
docker run --rm --network posada_default curlimages/curl -si http://catalog:3000/api/v1/auth/login   # 404 problem+json "no pertenece al servicio catalog"
```

## C. Pruebas de integración (entregable 7)
```bash
cd backend
npm test                                   # unitarias + contrato de consumidor (genera pacts/*.json)
npm run test:roles                         # reparto de rutas por servicio
npm run gateway:check                      # kong.tmpl.yml al día
BASE_URL=$GW DATABASE_URL=... JWT_SECRET=... node scripts/prueba-v2.cjs   # 125 comprobaciones contra el sistema desplegado
PROVIDER_URL=$GW SERVICE_API_KEY=... npm run pact:verificar   # el proveedor cumple el contrato de Booking
```
Capturas: salida de cada comando. Para demostrar que el contrato *protege*: en `alojamientos-v2.service.ts` renombrar temporalmente `vertical` a `rubro`, correr `npm run pact:verificar` (falla) y revertir.

## D. Observabilidad y trazabilidad (entregable 8)
```bash
curl -i $GW/api/v2/alojamientos/health -H "X-Correlation-Id: demo-reto2-0001"   # el mismo id vuelve en la respuesta
curl -s http://localhost:8100/metrics | grep -E "kong_http_requests_total|kong_latency" | head            # métricas de Kong (local)
curl -s http://localhost:3000/metrics | head -30     # métricas de un servicio (compose: docker compose exec reservations wget -qO- localhost:3000/metrics)
```
Azure Portal → `posada-reservations` → Registro de consola (o Log Analytics): buscar `demo-reto2-0001` y capturar la línea JSON `{"msg":"http","correlation_id":"demo-reto2-0001",...,"ms":...}`.

## E. Seguridad y auditoría (entregable 8)
```bash
curl -i $GW/api/v2/alojamientos/orders/create -X POST -H "content-type: application/json" -d "{}"            # 401 sin credenciales
curl -i $GW/api/v2/alojamientos/orders/create -X POST -H "X-API-Key: $SERVICE_API_KEY" -d "{}" -H "content-type: application/json"   # 400 falta Idempotency-Key
for i in $(seq 1 260); do curl -s -o /dev/null -w "%{http_code} " $GW/api/v2/alojamientos/categorias; done     # aparece 429 (rate limit 240/min por IP)
```
Captura de auditoría: en el registro de consola de `posada-reservations` buscar `"msg":"auditoria"` con `"evento":"operacion_critica"` (quién, scope, ruta, resultado, `idempotency_key`).

## F. Despliegue en Azure (PowerShell en tu PC, luego Cloud Shell)
```powershell
cd C:\Users\pc\Desktop\Reto2_IS
docker build -t samlu31/posada-backend:2.0.0 ./backend
docker push samlu31/posada-backend:2.0.0
docker build -t samlu31/posada-gateway:1.0.0 ./gateway
docker push samlu31/posada-gateway:1.0.0
```
En Docker Hub confirma que el repositorio `posada-gateway` quedó **Public** (Settings → Visibility). Luego en Azure Cloud Shell (bash), subiendo `scripts/desplegar-microservicios-azure.sh`:
```bash
RG=<tu-grupo-de-recursos> bash desplegar-microservicios-azure.sh
```
Al final imprime la URL base nueva. Esa URL es la que se manda a Joselyn y la que va en `frontend/src/environments/environment.ts` (`apiUrl: '<URL>/api/v1'`) y en el `connect-src` de `frontend/vercel.json`; además agrega la URL del frontend de Vercel en `CORS_ORIGINS` si cambió.
Al terminar la demostración, para no gastar crédito: `az containerapp update -n posada-gateway -g <RG> --min-replicas 0` (igual para reservations e integration).

## G. Mensaje para Joselyn
> Hola Joselyn, la URL base de NODE_ALO_PEC ahora es `https://<gateway>…azurecontainerapps.io` (pasa por el API Gateway). El resto de la ficha sigue igual: mismo contrato v2.2.0, mismas llaves, mismo node id. La URL anterior sigue activa unos días por si necesitas comparar.
