-- =====================================================================
-- 08. Salida anticipada: las noches que el huésped ya no va a usar vuelven a la venta
-- =====================================================================
-- Hasta ahora el cupo se calculaba solo con las fechas de la reserva: si alguien reservaba del 14 al 16 y
-- hacía el check-out el 15, la noche del 15 seguía bloqueada aunque la habitación estuviera libre y limpia.
-- Esta versión descuenta la reserva únicamente hasta el día en que se registró la salida real.
--
-- Mantiene lo que ya hacía la versión del 07: una habitación EN_PREPARACION no se puede reservar.
-- Se puede ejecutar varias veces sin problema.
SET search_path = booking, public;

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
                                             AND (o.checkout_en AT TIME ZONE 'America/Guayaquil')::date <= n::date)), 0)
           - (SELECT count(*) FROM habitacion h WHERE h.unidad_id = u.id AND h.estado = 'EN_PREPARACION')), 0), 0)
  FROM unidad_alojamiento u
  CROSS JOIN generate_series(p_entrada, p_salida - 1, interval '1 day') n
  LEFT JOIN calendario_unidad c ON c.unidad_id = u.id AND c.fecha = n::date
  WHERE u.id = p_unidad $$;

COMMENT ON FUNCTION fn_cupo_unidad(uuid, date, date) IS
  'Cupo libre de una unidad entre dos fechas: descuenta reservas vivas (hasta la salida real si ya hubo check-out) y habitaciones en preparación.';
