-- =====================================================================
--  POSADA EC - Reto 2 · Check-in / check-out digital y acuerdo B2B de promociones (contrato v2.2.0)
--  Ejecutar DESPUÉS de 04_v2_integracion.sql. Es ADITIVA y se puede re-ejecutar.
--
--  Qué agrega:
--    1. orden_v2: columnas de check-in, early check-in, habitación/clave digital y check-out con consumos.
--       El estado CHECKED_IN NO es un valor nuevo del enum estado_reserva: se deduce (CONFIRMADA + checkin_en).
--       El check-out pasa la reserva a COMPLETADA (= CHECKED_OUT del contrato) y habilita las reseñas.
--    2. contrato_promociones: acuerdo B2B (una sola fila) de GET/PUT /alojamientos/promociones/contrato.
-- =====================================================================
SET search_path = booking, public;

ALTER TABLE orden_v2
  ADD COLUMN IF NOT EXISTS checkin_en          timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_en         timestamptz,
  ADD COLUMN IF NOT EXISTS early_checkin       boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS early_checkin_desde timestamptz,
  ADD COLUMN IF NOT EXISTS habitacion_asignada varchar(100),
  ADD COLUMN IF NOT EXISTS clave_digital       varchar(40),
  ADD COLUMN IF NOT EXISTS consumos            jsonb,
  ADD COLUMN IF NOT EXISTS consumos_total      numeric(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS contrato_promociones (
  id                          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  permite_promociones         boolean      NOT NULL DEFAULT false,
  porcentaje_descuento_maximo numeric(5,2) NOT NULL DEFAULT 0 CHECK (porcentaje_descuento_maximo BETWEEN 0 AND 50),
  destinos_habilitados        text[]       NOT NULL DEFAULT '{}',
  vigencia_desde              date         NOT NULL DEFAULT CURRENT_DATE,
  vigencia_hasta              date,
  condiciones_combo           varchar(500),
  contacto_comercial          jsonb,
  updated_at                  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_promo_coherente CHECK (permite_promociones OR porcentaje_descuento_maximo = 0)
);
INSERT INTO contrato_promociones (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
