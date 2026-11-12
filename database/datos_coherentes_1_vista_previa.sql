-- =====================================================================
--  POSADA EC - PASO 1 de 2: VISTA PREVIA de nombres de prueba -> nombres con sentido
--  SOLO LEE: no cambia nada. Muestra "antes -> después" de cada nombre de prueba
--  ("Prueba Automatizada directo1", nombres con códigos o números, test/demo/QA).
--  Si la lista te parece bien, corre el PASO 2 (datos_coherentes_2_aplicar.sql).
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
)
SELECT antes AS nombre_antes, despues AS nombre_despues, count(*) AS reservas
  FROM nuevo GROUP BY antes, despues ORDER BY antes;
