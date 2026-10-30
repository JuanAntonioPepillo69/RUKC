-- 0005 · Vistas para filtrar y exportar desde el panel.
-- Diseño: docs/base-datos/diseno-v1.0.md, "Vistas para filtrar y exportar".
-- Ninguna vista incluye columnas de datos_sensibles_piloto: como mucho, datos derivados (si es menor).

-- =========================================================================================
-- v_embudo · una fila por solicitud del formulario
-- =========================================================================================
CREATE VIEW v_embudo AS
SELECT
  s.id,
  s.codigo,
  s.estado,
  t.codigo                                         AS temporada,
  r.numero                                         AS ronda,
  r.fecha                                          AS ronda_fecha,
  c.nombre                                         AS circuito,
  s.categoria_elegida                              AS categoria,
  s.metodo_elegido                                 AS metodo,
  s.pagador_nombre,
  s.pagador_telefono,
  s.pagador_email,
  CASE WHEN s.piloto_es_pagador THEN s.pagador_nombre ELSE s.piloto_nombre END AS piloto_nombre,
  NOT s.piloto_es_pagador                          AS paga_otra_persona,
  at.canal,
  at.utm_source,
  at.utm_campaign,
  at.utm_content,
  s.persona_id,
  s.pedido_id,
  s.ultimo_guardado_en,
  s.enviada_en,
  s.pagada_en,
  s.abandonada_en,
  CASE WHEN s.estado IN ('borrador', 'enviada', 'pago_abandonado')
       THEN round(extract(epoch FROM now() - coalesce(s.enviada_en, s.ultimo_guardado_en, s.creado_en)) / 3600, 1)
  END                                              AS horas_sin_pagar,
  s.creado_en
FROM solicitud_inscripcion s
JOIN temporada t ON t.id = s.temporada_id
LEFT JOIN ronda r ON r.id = s.ronda_id
LEFT JOIN circuito c ON c.id = r.circuito_id
LEFT JOIN LATERAL (
  SELECT canal, utm_source, utm_campaign, utm_content FROM atribucion
  WHERE solicitud_id = s.id ORDER BY capturada_en DESC LIMIT 1
) at ON true;

-- =========================================================================================
-- v_leads · una fila por oportunidad
-- =========================================================================================
CREATE VIEW v_leads AS
SELECT
  o.id,
  o.persona_id,
  t.codigo                                          AS temporada,
  btrim(p.nombre || ' ' || coalesce(p.apellidos, '')) AS persona,
  p.telefono,
  p.email,
  o.etapa,
  o.origen,
  pri.canal                                         AS canal,
  pri.utm_campaign                                  AS campana,
  o.proxima_accion,
  o.proxima_accion_en,
  (o.proxima_accion_en IS NOT NULL AND o.proxima_accion_en < now()
   AND o.etapa IN ('nueva', 'contactada', 'interesada'))      AS accion_vencida,
  ui.ocurrida_en                                    AS ultima_interaccion_en,
  ui.tipo                                           AS ultima_interaccion_tipo,
  ui.resumen                                        AS ultima_interaccion,
  o.motivo_perdida,
  o.cerrada_en,
  o.creado_en
FROM oportunidad o
JOIN persona p ON p.id = o.persona_id
JOIN temporada t ON t.id = o.temporada_id
LEFT JOIN LATERAL (
  SELECT canal, utm_campaign FROM atribucion WHERE persona_id = o.persona_id ORDER BY capturada_en ASC LIMIT 1
) pri ON true
LEFT JOIN LATERAL (
  SELECT ocurrida_en, tipo, resumen FROM interaccion WHERE persona_id = o.persona_id ORDER BY ocurrida_en DESC LIMIT 1
) ui ON true;

-- =========================================================================================
-- v_inscripciones · una fila por inscripción
-- =========================================================================================
CREATE VIEW v_inscripciones AS
SELECT
  i.id,
  i.codigo,
  t.codigo                                           AS temporada,
  r.numero                                           AS ronda,
  r.fecha                                            AS ronda_fecha,
  c.nombre                                           AS circuito,
  i.piloto_persona_id,
  btrim(p.nombre || ' ' || coalesce(p.apellidos, '')) AS piloto,
  pp.nombre_competicion,
  dt.dorsal,
  p.telefono                                         AS piloto_telefono,
  cat.codigo                                         AS categoria,
  i.categoria_origen,
  pr.codigo                                          AS producto,
  i.precio_cent,
  inscripcion_pagado_cent(i.id)                      AS pagado_cent,
  inscripcion_credito_cent(i.id)                     AS credito_cent,
  i.precio_cent - inscripcion_pagado_cent(i.id) - inscripcion_credito_cent(i.id) AS saldo_cent,
  i.estado,
  i.resolucion,
  i.sobrecupo,
  i.motivo,
  ped.codigo                                         AS pedido,
  btrim(pag.nombre || ' ' || coalesce(pag.apellidos, '')) AS pagador,
  (ped.pagador_persona_id <> i.piloto_persona_id)    AS paga_otra_persona,
  ob.estado                                          AS onboarding,
  ag.estado                                          AS grupo,
  ef.estado                                          AS feedback,
  i.creado_en
FROM inscripcion i
JOIN ronda r ON r.id = i.ronda_id
JOIN temporada t ON t.id = r.temporada_id
JOIN circuito c ON c.id = r.circuito_id
JOIN persona p ON p.id = i.piloto_persona_id
JOIN producto pr ON pr.id = i.producto_id
JOIN pedido ped ON ped.id = i.pedido_id
JOIN persona pag ON pag.id = ped.pagador_persona_id
LEFT JOIN categoria cat ON cat.id = i.categoria_id
LEFT JOIN perfil_piloto pp ON pp.persona_id = i.piloto_persona_id
LEFT JOIN dorsal_temporada dt ON dt.persona_id = i.piloto_persona_id AND dt.temporada_id = r.temporada_id
LEFT JOIN onboarding ob ON ob.persona_id = i.piloto_persona_id AND ob.temporada_id = r.temporada_id
LEFT JOIN acceso_grupo ag ON ag.persona_id = i.piloto_persona_id AND ag.temporada_id = r.temporada_id
LEFT JOIN envio_feedback ef ON ef.inscripcion_id = i.id;

-- =========================================================================================
-- v_parrilla · una fila por ronda y categoría
-- =========================================================================================
CREATE VIEW v_parrilla AS
SELECT
  t.codigo                                         AS temporada,
  r.id                                             AS ronda_id,
  r.numero                                         AS ronda,
  r.fecha,
  c.nombre                                         AS circuito,
  r.estado                                         AS ronda_estado,
  cat.id                                           AS categoria_id,
  cat.codigo                                       AS categoria,
  cr.plazas,
  coalesce(n.inscritos, 0)                         AS inscritos,
  coalesce(n.pagados, 0)                           AS pagados,
  coalesce(n.reservados, 0)                        AS reservados,
  cr.plazas - coalesce(n.inscritos, 0)             AS libres,
  coalesce(n.inscritos, 0) > cr.plazas             AS en_sobrecupo,
  cr.estado_inscripcion                            AS estado_cupo
FROM cupo_ronda cr
JOIN ronda r ON r.id = cr.ronda_id
JOIN temporada t ON t.id = r.temporada_id
JOIN circuito c ON c.id = r.circuito_id
JOIN categoria cat ON cat.id = cr.categoria_id
LEFT JOIN LATERAL (
  SELECT count(*)                                              AS inscritos,
         count(*) FILTER (WHERE i.estado IN ('pagada', 'asistio')) AS pagados,
         count(*) FILTER (WHERE i.estado = 'reservada')         AS reservados
  FROM inscripcion i
  WHERE i.ronda_id = cr.ronda_id AND i.categoria_id = cr.categoria_id
    AND i.estado NOT IN ('trasladada', 'cancelada')
) n ON true;

-- =========================================================================================
-- v_pagos · una fila por pago
-- =========================================================================================
CREATE VIEW v_pagos AS
SELECT
  pg.id,
  pg.codigo,
  coalesce(pg.recibido_en, pg.creado_en)            AS fecha,
  pg.metodo,
  pg.importe_cent,
  coalesce(re.reembolsado_cent, 0)                  AS reembolsado_cent,
  coalesce(ap.aplicado_cent, 0)                     AS aplicado_cent,
  pg.importe_cent - coalesce(re.reembolsado_cent, 0) - coalesce(ap.aplicado_cent, 0) AS sin_aplicar_cent,
  pg.estado,
  ec.nombre_comercial                               AS entidad,
  pg.pagador_persona_id,
  btrim(p.nombre || ' ' || coalesce(p.apellidos, '')) AS pagador,
  p.telefono                                        AS pagador_telefono,
  ap.inscripciones,
  pg.referencia_externa,
  pg.factura_ref,
  (pg.factura_ref IS NULL AND pg.estado IN ('confirmado', 'reembolsado_parcial')) AS sin_factura,
  r.numero                                          AS ronda_cobro,
  pg.cobrado_por,
  pg.confirmado_en,
  pg.confirmado_por,
  pg.stripe_payment_intent_id,
  pg.creado_en
FROM pago pg
JOIN persona p ON p.id = pg.pagador_persona_id
JOIN entidad_cobradora ec ON ec.id = pg.entidad_cobradora_id
LEFT JOIN ronda r ON r.id = pg.ronda_id
LEFT JOIN LATERAL (
  SELECT sum(a.importe_cent)::int AS aplicado_cent, string_agg(i.codigo, ', ' ORDER BY i.codigo) AS inscripciones
  FROM aplicacion_pago a JOIN inscripcion i ON i.id = a.inscripcion_id WHERE a.pago_id = pg.id
) ap ON true
LEFT JOIN LATERAL (
  SELECT sum(importe_cent)::int AS reembolsado_cent FROM reembolso WHERE pago_id = pg.id AND estado = 'emitido'
) re ON true;

-- =========================================================================================
-- v_caja · una fila por día (Europe/Madrid), método y entidad
-- =========================================================================================
CREATE VIEW v_caja AS
WITH cobros AS (
  SELECT (coalesce(confirmado_en, recibido_en) AT TIME ZONE 'Europe/Madrid')::date AS dia, metodo, entidad_cobradora_id,
         sum(importe_cent)::int AS cobrado_cent
  FROM pago WHERE estado IN ('confirmado', 'reembolsado_parcial', 'reembolsado')
  GROUP BY 1, 2, 3
), devoluciones AS (
  SELECT (re.emitido_en AT TIME ZONE 'Europe/Madrid')::date AS dia, pg.metodo, pg.entidad_cobradora_id,
         sum(re.importe_cent)::int AS reembolsado_cent
  FROM reembolso re JOIN pago pg ON pg.id = re.pago_id
  WHERE re.estado = 'emitido'
  GROUP BY 1, 2, 3
)
SELECT
  coalesce(c.dia, d.dia)                                 AS dia,
  coalesce(c.metodo, d.metodo)                           AS metodo,
  ec.nombre_comercial                                    AS entidad,
  coalesce(c.cobrado_cent, 0)                            AS cobrado_cent,
  coalesce(d.reembolsado_cent, 0)                        AS reembolsado_cent,
  coalesce(c.cobrado_cent, 0) - coalesce(d.reembolsado_cent, 0) AS neto_cent
FROM cobros c
FULL JOIN devoluciones d ON d.dia = c.dia AND d.metodo = c.metodo AND d.entidad_cobradora_id = c.entidad_cobradora_id
JOIN entidad_cobradora ec ON ec.id = coalesce(c.entidad_cobradora_id, d.entidad_cobradora_id);

-- =========================================================================================
-- v_onboarding · una fila por piloto y temporada
-- =========================================================================================
CREATE VIEW v_onboarding AS
SELECT
  o.id,
  o.persona_id,
  t.codigo                                          AS temporada,
  btrim(p.nombre || ' ' || coalesce(p.apellidos, '')) AS piloto,
  p.telefono,
  o.estado,
  o.paso_actual,
  (ds.fecha_nacimiento IS NOT NULL AND ds.fecha_nacimiento > (current_date - interval '18 years')::date) AS menor,
  EXISTS (SELECT 1 FROM tutela tu WHERE tu.menor_persona_id = o.persona_id) AS tiene_tutor,
  (SELECT count(*) FROM aceptacion a JOIN documento_legal d ON d.id = a.documento_legal_id
   WHERE a.persona_id = o.persona_id AND a.aceptado AND a.revocada_en IS NULL AND d.obligatorio_onboarding
     AND d.vigente_desde <= now() AND (d.vigente_hasta IS NULL OR d.vigente_hasta > now()))::int AS documentos_aceptados,
  (SELECT count(*) FROM documento_legal d
   WHERE d.obligatorio_onboarding AND d.vigente_desde <= now() AND (d.vigente_hasta IS NULL OR d.vigente_hasta > now()))::int AS documentos_obligatorios,
  (pp.foto_blob_path IS NOT NULL)                   AS tiene_foto,
  ag.estado                                         AS grupo,
  o.enlace_enviado_en,
  o.iniciado_en,
  o.completado_en,
  o.token_expira_en,
  o.creado_en
FROM onboarding o
JOIN persona p ON p.id = o.persona_id
JOIN temporada t ON t.id = o.temporada_id
LEFT JOIN datos_sensibles_piloto ds ON ds.persona_id = o.persona_id
LEFT JOIN perfil_piloto pp ON pp.persona_id = o.persona_id
LEFT JOIN acceso_grupo ag ON ag.persona_id = o.persona_id AND ag.temporada_id = o.temporada_id;

-- =========================================================================================
-- v_feedback · una fila por envío
-- =========================================================================================
CREATE VIEW v_feedback AS
SELECT
  e.id,
  e.inscripcion_id,
  t.codigo                                          AS temporada,
  r.numero                                          AS ronda,
  r.fecha                                           AS ronda_fecha,
  i.piloto_persona_id,
  btrim(p.nombre || ' ' || coalesce(p.apellidos, '')) AS piloto,
  p.telefono,
  pf.version                                        AS plantilla,
  e.estado,
  e.enviado_en,
  e.abierto_en,
  e.respondido_en,
  e.recordatorio_en,
  e.expira_en,
  (SELECT jsonb_object_agg(rf.pregunta_id, coalesce(to_jsonb(rf.valor_num), to_jsonb(rf.valor_texto), to_jsonb(rf.valor_opciones)))
   FROM respuesta_feedback rf WHERE rf.envio_id = e.id) AS respuestas,
  (SELECT min(rf.valor_num) FROM respuesta_feedback rf WHERE rf.envio_id = e.id) AS nota_minima,
  e.creado_en
FROM envio_feedback e
JOIN inscripcion i ON i.id = e.inscripcion_id
JOIN ronda r ON r.id = i.ronda_id
JOIN temporada t ON t.id = r.temporada_id
JOIN persona p ON p.id = i.piloto_persona_id
JOIN plantilla_feedback pf ON pf.id = e.plantilla_id;

-- =========================================================================================
-- v_creditos · una fila por persona con movimientos
-- =========================================================================================
CREATE VIEW v_creditos AS
SELECT
  m.persona_id,
  btrim(p.nombre || ' ' || coalesce(p.apellidos, '')) AS persona,
  p.telefono,
  sum(m.importe_cent)::int                          AS saldo_cent,
  max(m.creado_en)                                  AS ultimo_movimiento_en,
  min(m.caduca_en) FILTER (WHERE m.importe_cent > 0 AND m.caduca_en > now()) AS caducidad_proxima
FROM movimiento_credito m
JOIN persona p ON p.id = m.persona_id
GROUP BY m.persona_id, p.nombre, p.apellidos, p.telefono;

-- =========================================================================================
-- v_persona_360 · una fila por persona: todo lo anterior resumido + línea de tiempo
-- =========================================================================================
CREATE VIEW v_persona_360 AS
SELECT
  p.id,
  p.nombre,
  p.apellidos,
  p.email,
  p.telefono,
  p.municipio,
  p.instagram,
  p.estado,
  p.origen_alta,
  (pp.persona_id IS NOT NULL)                       AS es_piloto,
  pp.nombre_competicion,
  (SELECT dt.dorsal FROM dorsal_temporada dt JOIN temporada t ON t.id = dt.temporada_id
   WHERE dt.persona_id = p.id ORDER BY t.inicio DESC NULLS LAST LIMIT 1) AS dorsal,
  (SELECT o.etapa FROM oportunidad o WHERE o.persona_id = p.id ORDER BY o.creado_en DESC LIMIT 1) AS etapa,
  (SELECT count(*) FROM inscripcion i WHERE i.piloto_persona_id = p.id AND i.estado NOT IN ('trasladada', 'cancelada'))::int AS inscripciones_activas,
  (SELECT coalesce(sum(inscripcion_saldo_cent(i.id)), 0) FROM inscripcion i
   WHERE i.piloto_persona_id = p.id AND i.estado IN ('pendiente_pago', 'reservada', 'pagada', 'asistio'))::int AS saldo_pendiente_cent,
  credito_saldo_cent(p.id)                          AS credito_cent,
  (SELECT count(*) FROM pago pg WHERE pg.pagador_persona_id = p.id)::int AS pagos,
  (SELECT o.estado FROM onboarding o WHERE o.persona_id = p.id ORDER BY o.creado_en DESC LIMIT 1) AS onboarding,
  (SELECT a.estado FROM acceso_grupo a WHERE a.persona_id = p.id ORDER BY a.creado_en DESC LIMIT 1) AS grupo,
  (SELECT a.canal FROM atribucion a WHERE a.persona_id = p.id ORDER BY a.capturada_en ASC LIMIT 1) AS primer_canal,
  (SELECT a.canal FROM atribucion a WHERE a.persona_id = p.id ORDER BY a.capturada_en DESC LIMIT 1) AS ultimo_canal,
  (SELECT max(x.ocurrida_en) FROM interaccion x WHERE x.persona_id = p.id) AS ultima_interaccion_en,
  (SELECT jsonb_agg(l ORDER BY l.fecha DESC) FROM (
     SELECT x.ocurrida_en AS fecha, 'interaccion' AS clase, x.tipo AS detalle, x.resumen AS texto
       FROM interaccion x WHERE x.persona_id = p.id
     UNION ALL
     SELECT i.creado_en, 'inscripcion', i.estado, i.codigo FROM inscripcion i WHERE i.piloto_persona_id = p.id
     UNION ALL
     SELECT coalesce(pg.recibido_en, pg.creado_en), 'pago', pg.estado, pg.codigo || ' · ' || pg.metodo || ' · ' || pg.importe_cent || ' cent'
       FROM pago pg WHERE pg.pagador_persona_id = p.id
     UNION ALL
     SELECT s.creado_en, 'solicitud', s.estado, s.codigo FROM solicitud_inscripcion s WHERE s.persona_id = p.id
     ORDER BY 1 DESC
     LIMIT 100
   ) l)                                             AS linea_tiempo,
  p.creado_en
FROM persona p
LEFT JOIN perfil_piloto pp ON pp.persona_id = p.id;
