-- =====================================================================
--  POSADA EC - Reto 2 · Habitaciones reales (hoteles), estados y check-out en recepción
--  Ejecutar DESPUÉS de 06_v2_clientes_checkin.sql. Es ADITIVA y se puede re-ejecutar.
--
--  Qué agrega:
--    1. habitacion: cada habitación física de un HOTEL, con número y estado
--       (DISPONIBLE → OCUPADA en el check-in → EN_PREPARACION en el check-out → DISPONIBLE cuando
--       el dueño la marca lista). Casas, departamentos y cabañas se alquilan completos y no la usan.
--    2. fn_sincronizar_habitaciones + trigger: mantienen una habitación por cada unidad de la
--       "cantidad" de cada tipo de habitación de un hotel (101, 102, 103...). Nunca borra ninguna.
--    3. orden_v2: habitación asignada (habitacion_id) y datos del check-out en recepción y de su
--       notificación a Booking (con reintentos).
-- =====================================================================
SET search_path = booking, public;

DO $$
BEGIN
  CREATE TYPE estado_habitacion AS ENUM ('DISPONIBLE', 'OCUPADA', 'EN_PREPARACION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS habitacion (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alojamiento_id uuid NOT NULL REFERENCES alojamiento(id) ON DELETE CASCADE,
  unidad_id      uuid NOT NULL REFERENCES unidad_alojamiento(id) ON DELETE CASCADE,
  numero         varchar(10) NOT NULL,
  estado         estado_habitacion NOT NULL DEFAULT 'DISPONIBLE',
  actualizada_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_habitacion_numero UNIQUE (alojamiento_id, numero)
);
CREATE INDEX IF NOT EXISTS ix_habitacion_unidad_estado ON habitacion (unidad_id, estado);

ALTER TABLE orden_v2
  ADD COLUMN IF NOT EXISTS habitacion_id           uuid REFERENCES habitacion(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checkout_recepcion      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checkout_observaciones  varchar(300),
  ADD COLUMN IF NOT EXISTS checkout_notificado_en  timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_notif_intentos integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checkout_notif_ultimo   timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_notif_error    varchar(300);

-- Crea las habitaciones que faltan para que haya una por cada unidad de "cantidad" (solo hoteles)
CREATE OR REPLACE FUNCTION fn_sincronizar_habitaciones(p_unidad uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_aloj uuid;
  v_cant integer;
  v_existentes integer;
  v_sig integer;
  v_creadas integer := 0;
BEGIN
  SELECT u.alojamiento_id, u.cantidad INTO v_aloj, v_cant
    FROM unidad_alojamiento u
    JOIN alojamiento a ON a.id = u.alojamiento_id
    JOIN tipo_alojamiento t ON t.id = a.tipo_id
   WHERE u.id = p_unidad AND t.nombre = 'Hotel';
  IF v_aloj IS NULL THEN RETURN 0; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_aloj::text));   -- dos altas a la vez no repiten número
  SELECT count(*) INTO v_existentes FROM habitacion WHERE unidad_id = p_unidad;
  SELECT COALESCE(max(numero::integer), 100) + 1 INTO v_sig
    FROM habitacion WHERE alojamiento_id = v_aloj AND numero ~ '^[0-9]+$';

  WHILE v_existentes + v_creadas < v_cant LOOP
    INSERT INTO habitacion (alojamiento_id, unidad_id, numero) VALUES (v_aloj, p_unidad, v_sig::text);
    v_sig := v_sig + 1;
    v_creadas := v_creadas + 1;
  END LOOP;
  RETURN v_creadas;
END $$;

CREATE OR REPLACE FUNCTION tg_sincronizar_habitaciones() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_sincronizar_habitaciones(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_unidad_habitaciones ON unidad_alojamiento;
CREATE TRIGGER trg_unidad_habitaciones AFTER INSERT OR UPDATE OF cantidad ON unidad_alojamiento
  FOR EACH ROW EXECUTE FUNCTION tg_sincronizar_habitaciones();

-- Hoteles que ya existen: se les crean sus habitaciones ahora
SELECT fn_sincronizar_habitaciones(id) FROM unidad_alojamiento;

-- Pendientes de avisar a Booking el check-out (los recorre el job notificar-checkin)
-- Una habitación EN_PREPARACION no se puede reservar: se descuenta del cupo del tipo hasta que el dueño la marque
-- DISPONIBLE (misma firma que en 01_esquema.sql; esta versión reemplaza a aquella, por eso 07 va después de 01).
CREATE OR REPLACE FUNCTION fn_cupo_unidad(p_unidad uuid, p_entrada date, p_salida date) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT GREATEST(COALESCE(min(
           COALESCE(c.cantidad_a_la_venta, u.cantidad)
           - COALESCE((SELECT sum(d.cantidad) FROM reserva_detalle d JOIN reserva r ON r.id = d.reserva_id
                        WHERE d.unidad_id = u.id AND r.estado IN ('PENDIENTE','CONFIRMADA','COMPLETADA')
                          AND r.fecha_entrada <= n::date AND r.fecha_salida > n::date), 0)
           - (SELECT count(*) FROM habitacion h WHERE h.unidad_id = u.id AND h.estado = 'EN_PREPARACION')), 0), 0)
  FROM unidad_alojamiento u
  CROSS JOIN generate_series(p_entrada, p_salida - 1, interval '1 day') n
  LEFT JOIN calendario_unidad c ON c.unidad_id = u.id AND c.fecha = n::date
  WHERE u.id = p_unidad $$;

CREATE INDEX IF NOT EXISTS ix_orden_v2_checkout_pendiente
  ON orden_v2 (checkout_en)
  WHERE checkout_recepcion AND checkout_notificado_en IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_backend') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON habitacion TO app_backend;
  END IF;
END $$;
