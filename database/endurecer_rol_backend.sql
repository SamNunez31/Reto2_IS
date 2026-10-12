-- =====================================================================
--  Posada EC — Rol de base de datos con permisos mínimos (hallazgo BE-M4 de AUDITORIA.md)
--  Hoy el backend se conecta con el rol "postgres" (omite RLS, puede hacer DDL).
--  Este script crea "app_backend": solo DML sobre el esquema booking y EJECUTAR funciones, sin DDL ni otros esquemas.
--  Como RLS está activada sin políticas, se crea una política que permite todo SOLO a app_backend.
--
--  CÓMO USARLO (opcional, no se aplica solo):
--   1. Probar primero en un proyecto Supabase de pruebas (NO está probado contra Supabase real).
--   2. Reemplazar CAMBIAR_POR_UNA_CLAVE_LARGA por una clave larga y aleatoria.
--   3. Ejecutar este script en el SQL Editor.
--   4. En Render, cambiar DATABASE_URL para usar el usuario "app_backend" (en Supabase con pooler: app_backend.<project-ref>).
--   5. Probar /health (db: up), login y una reserva. Si algo falla, volver a poner la DATABASE_URL anterior: no se borra nada.
-- =====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_backend') THEN
    CREATE ROLE app_backend LOGIN PASSWORD 'CAMBIAR_POR_UNA_CLAVE_LARGA' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA booking TO app_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA booking TO app_backend;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA booking TO app_backend;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA booking TO app_backend;
-- Extensiones usadas por el esquema (crypt/gen_random_uuid, etc.)
GRANT USAGE ON SCHEMA extensions TO app_backend;
GRANT USAGE ON SCHEMA public TO app_backend;

-- Lo que se cree en el futuro en booking también queda cubierto
ALTER DEFAULT PRIVILEGES IN SCHEMA booking GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_backend;
ALTER DEFAULT PRIVILEGES IN SCHEMA booking GRANT USAGE, SELECT ON SEQUENCES TO app_backend;
ALTER DEFAULT PRIVILEGES IN SCHEMA booking GRANT EXECUTE ON FUNCTIONS TO app_backend;

-- RLS: política "todo permitido" solo para app_backend (la API pública de Supabase sigue sin acceso)
DO $$ DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'booking' LOOP
    EXECUTE format('DROP POLICY IF EXISTS app_backend_total ON booking.%I', t);
    EXECUTE format('CREATE POLICY app_backend_total ON booking.%I FOR ALL TO app_backend USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Sin DDL: no puede crear objetos en el esquema
REVOKE CREATE ON SCHEMA booking FROM app_backend;
REVOKE CREATE ON SCHEMA public FROM app_backend;
