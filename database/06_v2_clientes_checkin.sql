-- =====================================================================
--  POSADA EC - Reto 2 · Huéspedes (/api/v2/clientes) y check-in en recepción notificado a Booking
--  Ejecutar DESPUÉS de 05_v2_checkin.sql. Es ADITIVA y se puede re-ejecutar.
--
--  Qué agrega:
--    1. cliente_v2: ficha del huésped que llega desde Booking (sin cuenta de acceso), sin duplicados
--       por correo ni por identificación.
--    2. orden_v2: vínculo con la ficha (cliente_id) y estado de la llegada física en recepción y de su
--       notificación a Booking (con reintentos).
-- =====================================================================
SET search_path = booking, public;

CREATE TABLE IF NOT EXISTS cliente_v2 (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         varchar(160) NOT NULL,
  email          varchar(160) NOT NULL,
  identificacion varchar(20)  NOT NULL,
  telefono       varchar(20),
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_cliente_v2_email UNIQUE (email),
  CONSTRAINT uq_cliente_v2_identificacion UNIQUE (identificacion),
  CONSTRAINT ck_cliente_v2_email CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

ALTER TABLE orden_v2
  ADD COLUMN IF NOT EXISTS cliente_id             uuid REFERENCES cliente_v2(id),
  ADD COLUMN IF NOT EXISTS checkin_recepcion      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checkin_admin          varchar(80),
  ADD COLUMN IF NOT EXISTS checkin_observaciones  varchar(300),
  ADD COLUMN IF NOT EXISTS checkin_huespedes      smallint,
  ADD COLUMN IF NOT EXISTS checkin_notificado_en  timestamptz,
  ADD COLUMN IF NOT EXISTS checkin_notif_intentos integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checkin_notif_ultimo   timestamptz,
  ADD COLUMN IF NOT EXISTS checkin_notif_error    varchar(300);

-- Pendientes de avisar a Booking (los recorre el job notificar-checkin)
CREATE INDEX IF NOT EXISTS ix_orden_v2_checkin_pendiente
  ON orden_v2 (checkin_en)
  WHERE checkin_en IS NOT NULL AND checkin_recepcion AND checkin_notificado_en IS NULL;

-- El rol restringido del backend (endurecer_rol_backend.sql) debe poder usar la tabla nueva
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_backend') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON cliente_v2 TO app_backend;
  END IF;
END $$;
