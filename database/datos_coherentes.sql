-- =====================================================================
--  POSADA EC - Nombres y motivos de PRUEBA -> datos con sentido (Supabase o local)
--  NO borra nada: solo cambia el TEXTO de las reservas del canal Booking que tienen nombres de prueba
--  ("Prueba Automatizada directo1", nombres con códigos o números) por nombres ecuatorianos realistas, y los motivos de
--  cancelación de prueba ("Limpieza prueba QA", "prueba del arreglo #170") por uno neutro.
--  Cada titular recibe SIEMPRE el mismo nombre (se calcula a partir de su ficha), así que no cambia entre ejecuciones.
--  No toca fechas, totales, códigos de reserva, cédulas ni correos. Las reservas con nombres reales no se tocan.
--
--  CÓMO USARLO: termina en ROLLBACK, así que la primera vez solo MUESTRA "antes -> después".
--  Si la lista es la esperada, cambia la última línea ROLLBACK por COMMIT y ejecútalo de nuevo.
--  (Una vez con COMMIT no hay forma de volver a los nombres anteriores: copia la lista de la vista previa si la quieres guardar.)
-- =====================================================================
SET search_path = booking, public;
BEGIN;

CREATE TEMP TABLE _nuevo ON COMMIT DROP AS
WITH p AS (
  SELECT ARRAY['Andrea','Carlos','Daniela','Esteban','Fernanda','Gabriel','Helena','Ivan','Jimena','Kevin','Lorena','Mauricio','Natalia','Oscar','Paula',
               'Ricardo','Sofia','Tomas','Valeria','Xavier']::text[] AS nom,
         ARRAY['Aguirre','Barrera','Cedeño','Dávila','Espinoza','Flores','Guerrero','Haro','Iturralde','Jaramillo','Landázuri','Montalvo','Narváez','Ordóñez',
               'Pazmiño','Quishpe','Rivadeneira','Salazar','Tapia','Urbina','Vásconez','Yánez']::text[] AS ape
), base AS (
  SELECT o.reserva_id, o.cliente_id, o.titular->>'nombreCompleto' AS antes,
         abs(hashtext(COALESCE(o.cliente_id::text, o.reserva_id::text))) AS h
    FROM orden_v2 o
   WHERE o.titular->>'nombreCompleto' ~* '(prueba|automatizad|test|demo|\mqa\M)' OR o.titular->>'nombreCompleto' ~ '[0-9]'
)
SELECT b.reserva_id, b.cliente_id, b.antes,
       p.nom[1 + b.h % array_length(p.nom, 1)] || ' '
    || p.ape[1 + (b.h / 20) % array_length(p.ape, 1)] || ' '
    || p.ape[1 + ((b.h / 20) % array_length(p.ape, 1) + 1 + (b.h / 440) % (array_length(p.ape, 1) - 1)) % array_length(p.ape, 1)] AS despues
  FROM base b, p;

SELECT 'VISTA PREVIA: nombre antes -> después' AS que, antes, despues, count(*) AS reservas FROM _nuevo GROUP BY antes, despues ORDER BY antes;

UPDATE orden_v2 o SET titular = jsonb_set(o.titular, '{nombreCompleto}', to_jsonb(n.despues))
  FROM _nuevo n WHERE n.reserva_id = o.reserva_id;

UPDATE cliente_v2 c SET nombre = n.despues, updated_at = now()
  FROM (SELECT DISTINCT cliente_id, despues FROM _nuevo WHERE cliente_id IS NOT NULL) n WHERE c.id = n.cliente_id;

-- Motivos de cancelación que son de prueba
UPDATE orden_v2 SET motivo_cancelacion = 'Cancelación solicitada desde Booking'
 WHERE motivo_cancelacion ~* '(prueba|automatizad|\mqa\M|test|arreglo)';
UPDATE cancelacion SET motivo = 'Cancelación solicitada desde Booking'
 WHERE motivo ~* '(prueba|automatizad|\mqa\M|test|arreglo)';

-- Control: debe quedar en 0 (lo que siga apareciendo aquí hay que revisarlo a mano)
SELECT 'titulares de prueba que quedan' AS que, count(*) AS cantidad FROM orden_v2
 WHERE titular->>'nombreCompleto' ~* '(prueba|automatizad|test|demo|\mqa\M)' OR titular->>'nombreCompleto' ~ '[0-9]';
-- Solo informativo: cuentas de usuario con nombre de prueba (este script no las modifica)
SELECT 'usuarios con nombre de prueba' AS que, email, nombres, apellidos FROM usuario
 WHERE (nombres || ' ' || apellidos) ~* '(prueba|automatizad|test|\mqa\M)' OR (nombres || apellidos) ~ '[0-9]';

ROLLBACK;   -- <- cámbialo por COMMIT cuando la vista previa sea la esperada
