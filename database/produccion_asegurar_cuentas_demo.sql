-- =====================================================================
--  Posada EC — Asegurar las cuentas demo (hallazgo BE-A2 de AUDITORIA.md)
--  Las cuentas de 02_datos_demo.sql comparten la clave pública "Demo1234!".
--  EJECUTAR EN SUPABASE (SQL Editor) DESPUÉS DE LA DEFENSA o cuando ya no se necesite la demo.
--  1) Cambia la clave del ADMIN por una fuerte (reemplaza el texto entre comillas ANTES de ejecutar; no la subas a git).
--  2) Cambia la clave de TODAS las demás cuentas demo por un valor aleatorio (nadie podrá entrar con Demo1234!).
--  Para además bloquear las cuentas demo no-admin, descomenta el UPDATE del final.
--  Requiere la extensión pgcrypto (ya usada por 02_datos_demo.sql).
-- =====================================================================
BEGIN;

-- 1) Clave nueva del administrador (mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo)
UPDATE usuario
   SET password_hash = crypt('CAMBIAR_POR_UNA_CLAVE_FUERTE_Aa1!', gen_salt('bf', 12))
 WHERE email = 'admin.plataforma@gmail.com';

-- 2) Las demás cuentas demo: clave aleatoria que nadie conoce
UPDATE usuario
   SET password_hash = crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf', 12))
 WHERE email IN ('ana.paredes@gmail.com','bruno.salazar@hotmail.com','carla.mendoza@gmail.com','diego.torres@hotmail.com',
                 'elena.villacis@gmail.com','sofia.ruiz@gmail.com','mateo.cevallos@hotmail.com','lucia.andrade@gmail.com',
                 'andres.naranjo@hotmail.com');

-- 3) (Opcional) bloquear también el acceso de esas cuentas:
-- UPDATE usuario SET activo = false
--  WHERE email IN ('ana.paredes@gmail.com','bruno.salazar@hotmail.com','carla.mendoza@gmail.com','diego.torres@hotmail.com',
--                  'elena.villacis@gmail.com','sofia.ruiz@gmail.com','mateo.cevallos@hotmail.com','lucia.andrade@gmail.com',
--                  'andres.naranjo@hotmail.com');

-- Verificación: ninguna cuenta debe conservar el hash de "Demo1234!"
SELECT email, activo, (password_hash = crypt('Demo1234!', password_hash)) AS aun_con_clave_demo FROM usuario ORDER BY email;
COMMIT;
