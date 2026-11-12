-- =====================================================================
--  POSADA EC - PASO 2 de 2: APLICAR nombres con sentido a las reservas de prueba
--  Corre primero el PASO 1 (vista previa). Este script SÍ modifica datos y no se puede deshacer.
--  Cambia solo el TEXTO: nombre del titular en las reservas de Booking con nombre de prueba, la ficha del cliente
--  y los motivos de cancelación de prueba. No borra nada ni toca fechas, totales, códigos, cédulas ni correos.
--  Cada titular recibe siempre el mismo nombre (se calcula a partir de su ficha).
--  Todo va con el esquema "booking." explícito y sin tablas temporales (el editor de Supabase las pierde entre instrucciones).
-- =====================================================================
WITH p AS (
  SELECT ARRAY['Andrea','Carlos','Daniela','Esteban','Fernanda','Gabriel','Helena','Ivan','Jimena','Kevin','Lorena','Mauricio','Natalia','Oscar','Paula',
               'Ricardo','Sofia','Tomas','Valeria','Xavier']::text[] AS nom,
         ARRAY['Aguirre','Barrera','Cedeño','Dávila','Espinoza','Flores','Guerrero','Haro','Iturralde','Jaramillo','Landázuri','Montalvo','Narváez','Ordóñez',
               'Pazmiño','Quishpe','Rivadeneira','Salazar','Tapia','Urbina','Vásconez','Yánez']::text[] AS ape
), base AS (
  SELECT o.reserva_id, o.cliente_id, o.titular->>'nombreCompleto' AS antes,
         abs(hashtext(COALESCE(o.cliente_id::text, o.reserva_id::text))) AS h
    FROM booking.orden_v2 o
   WHERE o.titular->>'nombreCompleto' ~* '(prueba|automatizad|test|demo|\mqa\M)' OR o.titular->>'nombreCompleto' ~ '[0-9]'
), nuevo AS (
  SELECT b.reserva_id, b.cliente_id, b.antes,
         p.nom[1 + b.h % array_length(p.nom, 1)] || ' '
      || p.ape[1 + (b.h / 20) % array_length(p.ape, 1)] || ' '
      || p.ape[1 + ((b.h / 20) % array_length(p.ape, 1) + 1 + (b.h / 440) % (array_length(p.ape, 1) - 1)) % array_length(p.ape, 1)] AS despues
    FROM base b, p
),
a AS (
  UPDATE booking.orden_v2 o SET titular = jsonb_set(o.titular, '{nombreCompleto}', to_jsonb(n.despues))
    FROM nuevo n WHERE n.reserva_id = o.reserva_id RETURNING 1
), b AS (
  UPDATE booking.cliente_v2 c SET nombre = n.despues, updated_at = now()
    FROM (SELECT DISTINCT cliente_id, despues FROM nuevo WHERE cliente_id IS NOT NULL) n WHERE c.id = n.cliente_id RETURNING 1
)
SELECT (SELECT count(*) FROM a) AS reservas_renombradas, (SELECT count(*) FROM b) AS fichas_renombradas;

UPDATE booking.orden_v2 SET motivo_cancelacion = 'Cancelación solicitada desde Booking'
 WHERE motivo_cancelacion ~* '(prueba|automatizad|\mqa\M|test|arreglo)';

UPDATE booking.cancelacion SET motivo = 'Cancelación solicitada desde Booking'
 WHERE motivo ~* '(prueba|automatizad|\mqa\M|test|arreglo)';

-- Control: debe dar 0 (si no, mándame lo que salga)
SELECT count(*) AS titulares_de_prueba_que_quedan FROM booking.orden_v2
 WHERE titular->>'nombreCompleto' ~* '(prueba|automatizad|test|demo|\mqa\M)' OR titular->>'nombreCompleto' ~ '[0-9]';
