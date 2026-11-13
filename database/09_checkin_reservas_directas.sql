-- =====================================================================
-- 09. Check-in y check-out también para las reservas directas (canal propio)
-- =====================================================================
-- Hasta ahora la llegada, la habitación asignada y la salida solo se guardaban en orden_v2 (reservas de Booking).
-- Las reservas directas no tienen orden_v2, así que estos datos se guardan en la propia reserva.
--
-- Solo AGREGA columnas a una tabla que ya existe: no crea tablas ni vistas, así que el conteo de tablas del
-- esquema que verifica el backend al arrancar no cambia. Se puede ejecutar varias veces sin problema.
-- Ejecutar DESPUÉS de 08_cupo_salida_anticipada.sql.
SET search_path = booking, public;

ALTER TABLE reserva
  ADD COLUMN IF NOT EXISTS checkin_en             timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_en            timestamptz,
  ADD COLUMN IF NOT EXISTS habitacion_id          uuid REFERENCES habitacion(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS habitacion_asignada    varchar(100),
  ADD COLUMN IF NOT EXISTS checkin_observaciones  varchar(300),
  ADD COLUMN IF NOT EXISTS checkin_huespedes      smallint,
  ADD COLUMN IF NOT EXISTS checkout_observaciones varchar(300),
  ADD COLUMN IF NOT EXISTS consumos               jsonb,
  ADD COLUMN IF NOT EXISTS consumos_total         numeric(12,2) NOT NULL DEFAULT 0;

-- El cupo también recupera las noches de una salida anticipada de una reserva directa
CREATE OR REPLACE FUNCTION fn_cupo_unidad(p_unidad uuid, p_entrada date, p_salida date) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT GREATEST(COALESCE(min(
           COALESCE(c.cantidad_a_la_venta, u.cantidad)
           - COALESCE((SELECT sum(d.cantidad) FROM reserva_detalle d JOIN reserva r ON r.id = d.reserva_id
                        WHERE d.unidad_id = u.id AND r.estado IN ('PENDIENTE','CONFIRMADA','COMPLETADA')
                          AND r.fecha_entrada <= n::date AND r.fecha_salida > n::date
                          -- El huésped ya se fue: las noches desde el día de su salida vuelven a estar libres
                          AND NOT EXISTS (SELECT 1 FROM orden_v2 o
                                           WHERE o.reserva_id = r.id AND o.checkout_en IS NOT NULL
                                             AND (o.checkout_en AT TIME ZONE 'America/Guayaquil')::date <= n::date)
                          AND NOT (r.checkout_en IS NOT NULL
                                   AND (r.checkout_en AT TIME ZONE 'America/Guayaquil')::date <= n::date)), 0)
           - (SELECT count(*) FROM habitacion h WHERE h.unidad_id = u.id AND h.estado = 'EN_PREPARACION')), 0), 0)
  FROM unidad_alojamiento u
  CROSS JOIN generate_series(p_entrada, p_salida - 1, interval '1 day') n
  LEFT JOIN calendario_unidad c ON c.unidad_id = u.id AND c.fecha = n::date
  WHERE u.id = p_unidad $$;
