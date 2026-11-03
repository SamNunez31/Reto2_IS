# Posada EC · Prueba de integración local con Booking (Tailscale)

Guía personalizada para tu proyecto. Basada en `GUIA_PRUEBA_INTEGRACION_LOCAL.md` del grupo de Booking.
En esta prueba **tú eres el proveedor**: Booking te llama por REST, y tú le envías stock por gRPC.

## 1. Datos para anotar (rellena antes de la reunión)

| Dato | Valor |
|---|---|
| Sistema | Posada EC (MS_ALO, alojamientos) |
| Mi IP de Tailscale | `100.69.38.11` (`tailscale ip -4`) |
| Puerto REST | `3000` |
| URL base | `http://100.69.38.11:3000/api/v2` |
| Código de nodo (para `service_id` en gRPC) | pedir al líder de Booking |
| IP de Tailscale de Booking (destino gRPC) | `<IP Booking>:50051`, sin TLS |
| Token de prueba para Booking | `npm run token:servicio` (desde la carpeta backend) |

## 2. Levantar mi proyecto en local

```powershell
# En la raíz de Reto2_IS: base de datos local (puerto 5433)
docker compose up -d
# Si la BD ya existía de antes y NO tiene las tablas v2 (04_v2_integracion.sql), recréala desde cero:
#   docker compose down -v ; docker compose up -d

# Backend
cd backend
npm ci
npm run start:dev
```

Debe aparecer en el log `servidor_escuchando` con `host: 0.0.0.0` y `puerto: 3000`.

Con el backend en marcha, en otra terminal (carpeta `backend`):

```powershell
npm run test:v2          # recorre el contrato v2 completo; debe terminar en "48 OK, 0 FALLAS"
npm run token:servicio   # imprime el token Bearer que se le entrega a Booking
```

Endpoints que Booking probará primero (todos bajo `http://<mi IP>:3000/api/v2/alojamientos`):
`GET /health` · `GET /` (catálogo) · `POST /availability` · `POST /orders/create` · `GET /orders/{orderId}` · `POST /orders/{orderId}/cancel`.
`orders/create` y `orders/{id}/cancel` exigen `Authorization: Bearer <token>` e `Idempotency-Key` (UUID).
El archivo `backend/.env` ya viene con `APP_ENV=development` (en `production` el backend
redirige a HTTPS y la prueba es en `http://`), `HOST=0.0.0.0` y la BD local.

## 3. Tailscale y firewall (esto lo haces tú en tu computadora)

1. Instala Tailscale (https://tailscale.com/download) e inicia sesión.
2. Anota tu IP: `tailscale ip -4`.
3. Cuando arranque el backend, Windows pregunta por el firewall: marca **Redes privadas y públicas** (Tailscale suele quedar como "pública") → *Permitir acceso*.
4. Si no apareció la ventana, en PowerShell **como administrador**:
   ```powershell
   New-NetFirewallRule -DisplayName "Prueba integracion Posada EC" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Any
   ```
   Para deshacerlo: `Remove-NetFirewallRule -DisplayName "Prueba integracion Posada EC"`.
5. En la reunión: Tailscale web → *Machines* → tu equipo → **⋯ → Share** → pega el enlace en el chat y acepta los de los demás.
6. En `backend/.env` pon `API_PUBLIC_URL=http://100.69.38.11:3000` (los enlaces `_links` de las órdenes lo usan).

## 4. Comprobar que me ven

Desde otra computadora de la red: `curl -v http://100.69.38.11:3000/health` (cualquier respuesta, incluso 404, significa que hay conexión).

## 5. Reglas durante la prueba

- Nos llamamos por IP `100.x.x.x`, nunca por `localhost`. Todo en `http://`, gRPC sin TLS.
- Las llamadas son de servidor a servidor (no hay problema de CORS).
- No se cambia la lógica de negocio durante la reunión: solo configuración.
- Anotar cada error: endpoint, respuesta y hora.

## 6. Si algo falla

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Se queda cargando | Firewall | Repetir paso 3.3 / 3.4 |
| `Connection refused` | Servidor apagado o puerto distinto | Revisar que el log diga `0.0.0.0:3000` |
| `301/308` a https | `APP_ENV=production` | Poner `APP_ENV=development` y reiniciar |
| `401/403` | Falta el token o el scope | Revisar el token de prueba |
| `429` | Límite de 100 peticiones/min por IP | Esperar un minuto o subir el límite en `app.module.ts` |
| Dejó de funcionar | La compu se durmió | Despertarla y revisar Tailscale |

## 7. Stock por gRPC (Posada EC → Booking)

Posada EC es el CLIENTE: empuja el stock al servidor de Booking (puerto 50051, sin TLS).

1. Pide a Booking su IP de Tailscale y el código de nodo. En `backend/.env`:
   ```
   STOCK_GRPC_TARGET=100.x.y.z:50051
   STOCK_SERVICE_ID=<código de nodo, o déjalo en "alojamientos">
   ```
   y reinicia el backend (el log debe decir `stock_grpc_activo`).
2. Carga inicial: `npm run stock:cargar -- 30` (desde `backend`). Debe terminar en "N aceptados, 0 fallidos" y mostrar 3 líneas de verificación `COINCIDE`.
   Si sale `ITEM_NOT_FOUND`, Booking aún no tiene registrados tus items (`HTL-1001:HABITACION_ESTANDAR`...): pídeles que los den de alta.
3. Después, cada reserva o cancelación (de Booking o del marketplace) manda sola el stock de sus noches, en ≤ 5 s.
4. Para ensayar SIN Booking: terminal 1 `npm run stock:falso`; terminal 2 con `STOCK_GRPC_TARGET=127.0.0.1:50051`.
5. Si Booking dice que el stock no coincide, llamará a `GET /api/v2/alojamientos/HTL-1001/inventario?desde=…&hasta=…` (necesita el token de servicio).
