#!/bin/sh
# Rellena kong.tmpl.yml con las URLs de los servicios y la API key (variables de entorno) y arranca Kong.
set -eu
: "${UPSTREAM_IDENTITY:?falta UPSTREAM_IDENTITY}"
: "${UPSTREAM_CATALOG:?falta UPSTREAM_CATALOG}"
: "${UPSTREAM_RESERVATIONS:?falta UPSTREAM_RESERVATIONS}"
: "${UPSTREAM_INTEGRATION:?falta UPSTREAM_INTEGRATION}"
: "${SERVICE_API_KEY:?falta SERVICE_API_KEY}"
# '|' como separador: las URLs llevan '/'. La API key no debe contener '|' ni '&'.
sed -e "s|__UPSTREAM_IDENTITY__|${UPSTREAM_IDENTITY}|g" \
    -e "s|__UPSTREAM_CATALOG__|${UPSTREAM_CATALOG}|g" \
    -e "s|__UPSTREAM_RESERVATIONS__|${UPSTREAM_RESERVATIONS}|g" \
    -e "s|__UPSTREAM_INTEGRATION__|${UPSTREAM_INTEGRATION}|g" \
    -e "s|__SERVICE_API_KEY__|${SERVICE_API_KEY}|g" \
    /etc/kong/kong.tmpl.yml > /tmp/kong.yml
exec /docker-entrypoint.sh kong docker-start
