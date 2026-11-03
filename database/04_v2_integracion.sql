-- =====================================================================
--  POSADA EC - Reto 2 · Extensión v2 del contrato (alojamientos-openapi-v2.yaml, v2.2.0)
--  Ejecutar DESPUÉS de 01, 02 y 03. Es ADITIVA y se puede re-ejecutar.
--
--  Qué agrega:
--    1. unidad_alojamiento.codigo_tipo  -> "tipoHabitacionCodigo" del contrato (SUITE_DELUXE, DOBLE_ESTANDAR...)
--    2. cotizacion_v2                   -> precio congelado 30 min (POST /availability)
--    3. orden_v2                        -> datos del canal (titular, saga_id, desglose fiscal, reembolso) de cada reserva
--    4. seq_reembolso_htl               -> código de reembolso estable REF-HTL-NNNNNN
--    5. cuenta de servicio del ESB      -> huésped "técnico" de las reservas que crea Booking
--  Total de tablas del schema booking: 27.
-- =====================================================================
SET search_path = booking, public;

-- ---------------------------------------------------------------------
-- 1. Código de tipo de habitación (tipoHabitacionCodigo)
-- ---------------------------------------------------------------------
ALTER TABLE unidad_alojamiento ADD COLUMN IF NOT EXISTS codigo_tipo varchar(40);

-- "Suite Deluxe" -> SUITE_DELUXE  (sin tildes, solo A-Z 0-9 _, mínimo 2 caracteres)
CREATE OR REPLACE FUNCTION fn_codigo_tipo(p_nombre text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c text;
BEGIN
  c := upper(translate(coalesce(p_nombre, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
  c := trim(both '_' from regexp_replace(c, '[^A-Z0-9]+', '_', 'g'));
  IF c = '' THEN c := 'TIPO'; END IF;
  IF length(c) < 2 THEN c := c || '_X'; END IF;
  RETURN left(c, 40);
END $$;

-- Relleno de las unidades existentes; si dos nombres dan el mismo código se añade _2, _3...
WITH base AS (
  SELECT id, fn_codigo_tipo(nombre) AS c,
         row_number() OVER (PARTITION BY alojamiento_id, fn_codigo_tipo(nombre) ORDER BY nombre, id) AS n
    FROM unidad_alojamiento WHERE codigo_tipo IS NULL)
UPDATE unidad_alojamiento u
   SET codigo_tipo = CASE WHEN b.n = 1 THEN b.c ELSE left(b.c, 36) || '_' || b.n END
  FROM base b WHERE u.id = b.id;

ALTER TABLE unidad_alojamiento ALTER COLUMN codigo_tipo SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_unidad_codigo_tipo') THEN
    ALTER TABLE unidad_alojamiento ADD CONSTRAINT uq_unidad_codigo_tipo UNIQUE (alojamiento_id, codigo_tipo);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_unidad_codigo_tipo') THEN
    ALTER TABLE unidad_alojamiento ADD CONSTRAINT ck_unidad_codigo_tipo CHECK (codigo_tipo ~ '^[A-Z0-9_]{2,40}$');
  END IF;
END $$;

-- Las unidades nuevas (panel del anfitrión, datos de carga) obtienen su código solas
CREATE OR REPLACE FUNCTION tg_unidad_codigo_tipo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.codigo_tipo IS NULL THEN
    NEW.codigo_tipo := fn_codigo_tipo(NEW.nombre);
    IF EXISTS (SELECT 1 FROM unidad_alojamiento WHERE alojamiento_id = NEW.alojamiento_id AND codigo_tipo = NEW.codigo_tipo) THEN
      NEW.codigo_tipo := left(NEW.codigo_tipo, 33) || '_' || substr(replace(NEW.id::text, '-', ''), 1, 6);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_unidad_codigo_tipo ON unidad_alojamiento;
CREATE TRIGGER trg_unidad_codigo_tipo BEFORE INSERT ON unidad_alojamiento
  FOR EACH ROW EXECUTE FUNCTION tg_unidad_codigo_tipo();

-- ---------------------------------------------------------------------
-- 2. Cotización con precio congelado (30 min, NO retiene inventario)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cotizacion_v2 (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidad_id       uuid NOT NULL REFERENCES unidad_alojamiento(id),
  fecha_entrada   date NOT NULL,
  fecha_salida    date NOT NULL,
  cantidad        smallint NOT NULL DEFAULT 1,
  plan_tarifa     varchar(30) NOT NULL DEFAULT 'STANDARD',
  subtotal        numeric(12,2) NOT NULL,
  iva_porcentaje  numeric(5,2)  NOT NULL,
  iva_valor       numeric(12,2) NOT NULL,
  tasa_municipal  numeric(12,2) NOT NULL,
  descuento_combo numeric(12,2) NOT NULL DEFAULT 0,
  total           numeric(12,2) NOT NULL,
  noches_detalle  jsonb         NOT NULL,         -- [{fecha, precio}]
  creada_en       timestamptz   NOT NULL DEFAULT now(),
  valida_hasta    timestamptz   NOT NULL DEFAULT now() + interval '30 minutes',
  CONSTRAINT ck_cot2_fechas CHECK (fecha_salida > fecha_entrada),
  CONSTRAINT ck_cot2_total  CHECK (total >= 0 AND cantidad >= 1)
);
CREATE INDEX IF NOT EXISTS ix_cot2_valida ON cotizacion_v2 (valida_hasta);

-- ---------------------------------------------------------------------
-- 3. Datos del canal de cada reserva creada por /orders/create
--    (titular = dato personal: no se escribe en logs ni en eventos)
-- ---------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS seq_reembolso_htl START WITH 10001;

CREATE TABLE IF NOT EXISTS orden_v2 (
  reserva_id          uuid PRIMARY KEY REFERENCES reserva(id),
  cotizacion_id       uuid REFERENCES cotizacion_v2(id),
  unidad_id           uuid NOT NULL REFERENCES unidad_alojamiento(id),
  cantidad            smallint NOT NULL DEFAULT 1,
  saga_id             varchar(64),
  plan_tarifa         varchar(30) NOT NULL DEFAULT 'STANDARD',
  regimen             varchar(30),
  ocupantes           jsonb NOT NULL,
  titular             jsonb NOT NULL,
  acompanantes        jsonb,
  peticiones          varchar(500),
  payment_method      varchar(30),
  payment_reference   varchar(64),
  paquete             jsonb,
  subtotal            numeric(12,2) NOT NULL,
  iva_porcentaje      numeric(5,2)  NOT NULL,
  iva_valor           numeric(12,2) NOT NULL,
  tasa_municipal      numeric(12,2) NOT NULL,
  descuento_combo     numeric(12,2) NOT NULL DEFAULT 0,
  total               numeric(12,2) NOT NULL,
  noches_detalle      jsonb NOT NULL,
  -- cancelación (se llena una sola vez; un reintento devuelve los mismos valores)
  codigo_reembolso    varchar(20) UNIQUE,
  porcentaje_reembolso numeric(5,2),
  monto_reembolsado   numeric(12,2),
  penalidad           numeric(12,2),
  solicitado_por      varchar(20),
  motivo_cancelacion  varchar(300),
  cancelada_en        timestamptz,
  creada_en           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_orden2_saga ON orden_v2 (saga_id) WHERE saga_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 5. Cuenta de servicio del ESB de Booking
--    Es el "huésped" técnico de las reservas del canal. No puede iniciar sesión
--    (el hash no es un bcrypt válido); solo se usa con el token de `npm run token:servicio`.
-- ---------------------------------------------------------------------
INSERT INTO usuario (email, password_hash, nombres, apellidos, rol, activo)
VALUES ('esb-booking@servicio.posada.ec', '!SIN-LOGIN!', 'ESB Booking', 'Cuenta de servicio', 'USUARIO', true)
ON CONFLICT (email) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Horarios del ecosistema Booking: check-out MÁXIMO 11:00 (check-in >= 14:00).
-- Se corrige lo existente, se cambia el valor por defecto y un trigger recorta
-- cualquier alta posterior (p. ej. datos extra del catálogo) a 11:00.
-- ---------------------------------------------------------------------------
UPDATE alojamiento SET hora_checkout = '11:00' WHERE hora_checkout > '11:00';
ALTER TABLE alojamiento ALTER COLUMN hora_checkout SET DEFAULT '11:00';

CREATE OR REPLACE FUNCTION fn_checkout_maximo() RETURNS trigger AS $$
BEGIN
  IF NEW.hora_checkout IS NULL OR NEW.hora_checkout > TIME '11:00' THEN
    NEW.hora_checkout := TIME '11:00';
  END IF;
  IF NEW.hora_checkin IS NOT NULL AND NEW.hora_checkin < TIME '14:00' THEN
    NEW.hora_checkin := TIME '14:00';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_checkout_maximo ON alojamiento;
CREATE TRIGGER tg_checkout_maximo BEFORE INSERT OR UPDATE OF hora_checkout, hora_checkin ON alojamiento
  FOR EACH ROW EXECUTE FUNCTION fn_checkout_maximo();
