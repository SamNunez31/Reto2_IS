#!/usr/bin/env bash
# Despliega los 4 microservicios + el gateway en Azure Container Apps (Reto 2).
# Ejecutar en Azure Cloud Shell (bash) o en una terminal con "az login" hecho.
#
#   RG=<grupo-de-recursos> APP_ORIGINAL=posada-alojamientos-api \
#   TAG_BACKEND=2.0.0 TAG_GATEWAY=1.0.0 bash desplegar-microservicios-azure.sh
#
# Copia las variables de entorno (DATABASE_URL, JWT_SECRET, SERVICE_API_KEY, STOCK_REST_*, ...) de la app
# original. Las sensibles se crean como SECRETOS de Container Apps (secretref:), no como variables en claro.
# Los archivos temporales con valores se crean con permisos 600 y se borran al terminar (trap). NO toca la app original.
set -euo pipefail
umask 077
trap 'rm -f /tmp/env_original.json /tmp/env_base.txt /tmp/env_secretos.txt' EXIT
: "${RG:?define RG (grupo de recursos)}"
APP_ORIGINAL="${APP_ORIGINAL:-posada-alojamientos-api}"
TAG_BACKEND="${TAG_BACKEND:-2.0.0}"
TAG_GATEWAY="${TAG_GATEWAY:-1.0.0}"
HUB="${HUB:-samlu31}"
MIN_ACTIVAS="${MIN_ACTIVAS:-1}"   # réplicas mínimas de gateway, reservations e integration (demo). 0 = escala a cero.

command -v jq >/dev/null || { echo "Falta jq"; exit 1; }
ENV_ID=$(az containerapp show -n "$APP_ORIGINAL" -g "$RG" --query properties.environmentId -o tsv)
az containerapp show -n "$APP_ORIGINAL" -g "$RG" --query "properties.template.containers[0].env" -o json > /tmp/env_original.json
if jq -e '.[] | select(.secretRef != null)' /tmp/env_original.json >/dev/null; then
  echo "AVISO: la app original usa secretos de Azure (secretRef); esas variables no se copian. Agrégalas a mano."
fi
# Solo las variables con valor; se quitan las que el script define por servicio.
jq -r '.[] | select(.value != null) | select(.name != "SERVICE_ROLE" and .name != "PORT" and .name != "API_PUBLIC_URL" and .name != "NODE_ENV") | "\(.name)=\(.value)"' /tmp/env_original.json > /tmp/env_base.txt
echo "Variables copiadas: $(wc -l < /tmp/env_base.txt)"
# Se separan las variables sensibles (secretos de Azure) de las normales.
PATRON_SECRETO='^(DATABASE_URL|JWT_SECRET|SERVICE_API_KEY|METRICS_TOKEN|[A-Z_]*(PASSWORD|TOKEN|SECRET|KEY)[A-Z_]*)='
grep -E "$PATRON_SECRETO" /tmp/env_base.txt > /tmp/env_secretos.txt || true
grep -vE "$PATRON_SECRETO" /tmp/env_base.txt > /tmp/env_base_plano.txt || true
mv /tmp/env_base_plano.txt /tmp/env_base.txt
# Si la app original no tenía METRICS_TOKEN, se genera uno para proteger /metrics de cada servicio.
grep -q '^METRICS_TOKEN=' /tmp/env_secretos.txt || echo "METRICS_TOKEN=$(openssl rand -hex 24)" >> /tmp/env_secretos.txt
mapfile -t BASE < /tmp/env_base.txt
mapfile -t SECRETOS < /tmp/env_secretos.txt
# nombre de secreto de Azure: minúsculas y guiones (JWT_SECRET -> jwt-secret)
nombre_secreto() { echo "$1" | tr 'A-Z_' 'a-z-'; }
SECRETS_ARGS=(); ENV_SECRETOS=()
for kv in "${SECRETOS[@]}"; do
  k="${kv%%=*}"; v="${kv#*=}"
  SECRETS_ARGS+=("$(nombre_secreto "$k")=$v")
  ENV_SECRETOS+=("$k=secretref:$(nombre_secreto "$k")")
done
echo "Secretos de Azure: ${#SECRETOS[@]} · variables normales: ${#BASE[@]}"

crear_servicio() { # nombre rol min
  local nombre="$1" rol="$2" min="$3"
  echo ">> $nombre (SERVICE_ROLE=$rol, min=$min)"
  az containerapp create -n "$nombre" -g "$RG" --environment "$ENV_ID" \
    --image "docker.io/$HUB/posada-backend:$TAG_BACKEND" \
    --ingress internal --target-port 3000 --transport auto \
    --cpu 0.25 --memory 0.5Gi --min-replicas "$min" --max-replicas 2 \
    --secrets "${SECRETS_ARGS[@]}" \
    --env-vars "${BASE[@]}" "${ENV_SECRETOS[@]}" NODE_ENV=production PORT=3000 "SERVICE_ROLE=$rol" -o none
}

crear_servicio posada-identity     identity     0
crear_servicio posada-catalog      catalog      0
crear_servicio posada-reservations reservations "$MIN_ACTIVAS"
crear_servicio posada-integration  integration  "$MIN_ACTIVAS"

fqdn() { az containerapp show -n "$1" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv; }
API_KEY=$(grep '^SERVICE_API_KEY=' /tmp/env_secretos.txt | cut -d= -f2-)
[ -n "$API_KEY" ] || { echo "No encontré SERVICE_API_KEY en la app original"; exit 1; }

echo ">> posada-gateway (Kong)"
az containerapp create -n posada-gateway -g "$RG" --environment "$ENV_ID" \
  --image "docker.io/$HUB/posada-gateway:$TAG_GATEWAY" \
  --ingress external --target-port 8000 --transport auto \
  --cpu 0.5 --memory 1Gi --min-replicas "$MIN_ACTIVAS" --max-replicas 2 \
  --secrets "service-api-key=$API_KEY" \
  --env-vars \
    "UPSTREAM_IDENTITY=https://$(fqdn posada-identity)" \
    "UPSTREAM_CATALOG=https://$(fqdn posada-catalog)" \
    "UPSTREAM_RESERVATIONS=https://$(fqdn posada-reservations)" \
    "UPSTREAM_INTEGRATION=https://$(fqdn posada-integration)" \
    "SERVICE_API_KEY=secretref:service-api-key" -o none

GW="https://$(fqdn posada-gateway)"
echo ">> Actualizando API_PUBLIC_URL de los servicios a $GW"
for s in posada-identity posada-catalog posada-reservations posada-integration; do
  az containerapp update -n "$s" -g "$RG" --set-env-vars "API_PUBLIC_URL=$GW" -o none
done

echo
echo "LISTO. URL base del nodo (para Booking y el frontend): $GW"
echo "Pruebas:  curl $GW/gateway/health   |   curl $GW/api/v2/alojamientos/health"
