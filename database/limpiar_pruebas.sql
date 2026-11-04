-- =====================================================================
--  POSADA EC - Limpieza de reservas de PRUEBA (Supabase o local)
--  Borra SOLO las reservas cuyo huésped es la cuenta de servicio del ESB
--  (esb-booking@servicio.posada.ec): son las que crean test:v2 y las pruebas con Booking.
--  Las reservas del marketplace y de usuarios reales NO se tocan.
--
--  CÓMO USARLO: el script termina en ROLLBACK, así que la primera vez solo MUESTRA qué borraría.
--  Si los conteos son los esperados, cambia la última línea ROLLBACK por COMMIT y vuelve a ejecutarlo.
--  Al liberar reservas sube el cupo disponible: después corre `npm run stock:cargar` para avisar a Booking.
-- =====================================================================
SET search_path = booking, public;
BEGIN;

CREATE TEMP TABLE _prueba ON COMMIT DROP AS
  SELECT r.id FROM reserva r JOIN usuario u ON u.id = r.huesped_id
   WHERE u.email = 'esb-booking@servicio.posada.ec';

SELECT 'reservas de prueba a borrar' AS que, count(*) AS cantidad FROM _prueba;

DELETE FROM resena          WHERE reserva_id IN (SELECT id FROM _prueba);
DELETE FROM factura         WHERE reserva_id IN (SELECT id FROM _prueba);
DELETE FROM pago            WHERE reserva_id IN (SELECT id FROM _prueba);
DELETE FROM cancelacion     WHERE reserva_id IN (SELECT id FROM _prueba);
DELETE FROM orden_preview   WHERE reserva_id IN (SELECT id FROM _prueba);
DELETE FROM orden_v2        WHERE reserva_id IN (SELECT id FROM _prueba);
DELETE FROM evento_outbox   WHERE agregado_id IN (SELECT id FROM _prueba);
DELETE FROM reserva         WHERE id IN (SELECT id FROM _prueba);   -- reserva_detalle se borra en cascada

-- Datos de apoyo que solo sirven para las pruebas
DELETE FROM cotizacion_v2   WHERE id NOT IN (SELECT cotizacion_id FROM orden_v2 WHERE cotizacion_id IS NOT NULL);
DELETE FROM idempotencia WHERE propietario = (SELECT id::text FROM usuario WHERE email = 'esb-booking@servicio.posada.ec');

SELECT 'reservas restantes' AS que, count(*) AS cantidad FROM reserva
UNION ALL SELECT 'órdenes v2 restantes', count(*) FROM orden_v2;

ROLLBACK;   -- <- cámbialo por COMMIT cuando los conteos sean los esperados
