# API Gateway de Posada EC (Reto 2, S8): Kong en modo DB-less. La configuración es un archivo versionado.
FROM kong:3.7
USER root
COPY kong.tmpl.yml /etc/kong/kong.tmpl.yml
COPY entrypoint.sh /usr/local/bin/posada-gateway.sh
RUN chmod +x /usr/local/bin/posada-gateway.sh
USER kong
ENV KONG_DATABASE=off \
    KONG_PROXY_LISTEN=0.0.0.0:8000 \
    KONG_ADMIN_LISTEN=off \
    KONG_STATUS_LISTEN=0.0.0.0:8100 \
    KONG_DECLARATIVE_CONFIG=/tmp/kong.yml \
    KONG_PLUGINS=bundled \
    KONG_REAL_IP_HEADER=X-Forwarded-For \
    KONG_TRUSTED_IPS=0.0.0.0/0,::/0 \
    KONG_PROXY_ACCESS_LOG=/dev/stdout \
    KONG_PROXY_ERROR_LOG=/dev/stderr \
    KONG_LOG_LEVEL=notice
EXPOSE 8000 8100
ENTRYPOINT ["/usr/local/bin/posada-gateway.sh"]
