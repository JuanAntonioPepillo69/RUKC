-- Datos iniciales de la Temporada 2 (separados de las migraciones). Se puede ejecutar más de una vez:
-- lo que ya existe no se duplica. Uso: npm run db:sembrar
-- Diseño: docs/base-datos/diseno-v1.0.md. Fechas de las rondas: las publicadas en raceupkc.com.

-- Temporada T2: reserva de 30 € (3000 céntimos) y 14 días de aviso para traslados.
-- franja_ambas_categorias = true es el valor provisional de la regla 1 ("puede correr en ambas categorías").
INSERT INTO temporada (codigo, nombre, inicio, fin, estado, importe_reserva_cent, dias_aviso_traslado, franja_ambas_categorias)
VALUES ('T2', 'Temporada 2', '2026-10-17', '2027-07-03', 'en_curso', 3000, 14, true)
ON CONFLICT (codigo) DO NOTHING;

-- Circuitos. Municipio, edad mínima y seguro vacíos: los rellena John desde el panel.
INSERT INTO circuito (nombre) VALUES
  ('Karting Mijas'), ('Karting Campillos'), ('Kart&Fun Málaga'), ('Karting del Sol'), ('Kart&Fun Estepona')
ON CONFLICT (nombre) DO NOTHING;

-- Las 8 rondas.
INSERT INTO ronda (temporada_id, numero, circuito_id, fecha, notas)
SELECT t.id, v.numero, c.id, v.fecha::date, v.notas
FROM (VALUES
  (1, 'Karting Mijas',     '2026-10-17', NULL),
  (2, 'Karting Campillos', '2026-11-22', NULL),
  (3, 'Kart&Fun Málaga',   '2026-12-12', NULL),
  (4, 'Karting del Sol',   '2027-02-06', NULL),
  (5, 'Kart&Fun Málaga',   '2027-03-13', NULL),
  (6, 'Kart&Fun Estepona', '2027-04-24', NULL),
  (7, 'Karting Mijas',     '2027-06-05', NULL),
  (8, 'Karting Campillos', '2027-07-03', 'Final y gala')
) AS v (numero, circuito, fecha, notas)
JOIN temporada t ON t.codigo = 'T2'
JOIN circuito c ON c.nombre = v.circuito
ON CONFLICT (temporada_id, numero) DO NOTHING;

-- La R1 ya se celebró. (Una ronda nueva siempre empieza programada; se pasa a celebrada con su transición.)
UPDATE ronda SET estado = 'celebrada'
WHERE numero = 1 AND estado = 'programada' AND temporada_id = (SELECT id FROM temporada WHERE codigo = 'T2');

-- Categorías: quien pese menos del mínimo lleva lastre hasta ahí.
INSERT INTO categoria (temporada_id, codigo, nombre, peso_minimo_kg, orden)
SELECT t.id, v.codigo, v.nombre, v.minimo, v.orden
FROM (VALUES ('LIG', 'Ligeros', 70.0, 1), ('PES', 'Pesados', 85.0, 2)) AS v (codigo, nombre, minimo, orden)
JOIN temporada t ON t.codigo = 'T2'
ON CONFLICT (temporada_id, codigo) DO NOTHING;

-- Regla de categoría por peso con equipo: hasta 80,0 → LIG; hasta 84,9 → elección; resto → PES.
INSERT INTO regla_categoria (temporada_id, hasta_kg, resultado)
SELECT t.id, v.hasta, v.resultado
FROM (VALUES (80.0, 'LIG'), (84.9, 'eleccion'), (NULL::numeric, 'PES')) AS v (hasta, resultado)
JOIN temporada t ON t.codigo = 'T2'
ON CONFLICT (temporada_id, hasta_kg) DO NOTHING;

-- Cupos: 50 plazas por ronda y categoría, todos cerrados (se abren a mano desde el panel).
INSERT INTO cupo_ronda (ronda_id, categoria_id, plazas, estado_inscripcion)
SELECT r.id, cat.id, 50, 'cerrada'
FROM ronda r
JOIN temporada t ON t.id = r.temporada_id AND t.codigo = 'T2'
JOIN categoria cat ON cat.temporada_id = t.id
ON CONFLICT (ronda_id, categoria_id) DO NOTHING;

-- Productos y tarifas: carrera suelta 99 €, temporada completa 690 €, temporada resto 630 €.
INSERT INTO producto (temporada_id, codigo, rondas_incluidas)
SELECT t.id, v.codigo, v.rondas
FROM (VALUES ('carrera_suelta', 1), ('temporada_completa', 8), ('temporada_resto', NULL::smallint)) AS v (codigo, rondas)
JOIN temporada t ON t.codigo = 'T2'
ON CONFLICT (temporada_id, codigo) DO NOTHING;

INSERT INTO tarifa (producto_id, precio_cent, vigente_desde)
SELECT p.id, v.precio, '2026-09-01 00:00:00+02'
FROM (VALUES ('carrera_suelta', 9900), ('temporada_completa', 69000), ('temporada_resto', 63000)) AS v (codigo, precio)
JOIN temporada t ON t.codigo = 'T2'
JOIN producto p ON p.temporada_id = t.id AND p.codigo = v.codigo
WHERE NOT EXISTS (SELECT 1 FROM tarifa x WHERE x.producto_id = p.id);

-- Entidad cobradora: nombre comercial RUKC; titular, NIF, tipo y fechas los rellena John.
INSERT INTO entidad_cobradora (nombre_comercial)
SELECT 'RUKC' WHERE NOT EXISTS (SELECT 1 FROM entidad_cobradora);

-- Documentos legales en BORRADOR, sin activar: no se pueden activar sin fecha de revisión del abogado.
INSERT INTO documento_legal (tipo, version, titulo, contenido_md, obligatorio_onboarding, revocable)
SELECT v.tipo, 'borrador-1', 'BORRADOR · ' || v.titulo,
       E'**BORRADOR · pendiente de revisión por el abogado. No usar con pilotos.**\n\nTexto pendiente de redactar: ' || v.titulo || '.',
       v.obligatorio, v.revocable
FROM (VALUES
  ('asuncion_riesgos',    'Asunción de riesgos',                 true,  false),
  ('cesion_imagen',       'Cesión de imagen (web, redes y anuncios)', true,  true),
  ('reglamento',          'Aceptación del reglamento',           true,  false),
  ('privacidad',          'Política de privacidad',              false, false),
  ('condiciones_reserva', 'Condiciones de la reserva',           false, false),
  ('consentimiento_peso', 'Consentimiento para tratar el peso',  false, true),
  ('aviso_borradores',    'Aviso de guardado de borradores',     false, false)
) AS v (tipo, titulo, obligatorio, revocable)
ON CONFLICT (tipo, version) DO NOTHING;

-- Plantilla de feedback v1 vacía hasta que se definan las preguntas (regla 8).
INSERT INTO plantilla_feedback (version, preguntas, activa)
VALUES ('v1', '[]', false)
ON CONFLICT (version) DO NOTHING;
