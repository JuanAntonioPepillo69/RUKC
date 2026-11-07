-- 0009 · Seguimiento del envío de la ficha de piloto (onboarding).
-- John pide saber a quién ha mandado ya el enlace, a quién le falta y quién no responde (7-11-2026).
-- - onboarding.envios: cuántas veces se ha preparado el WhatsApp con el enlace (el primero y los recordatorios).
-- - v_onboarding.seguimiento: sin_enviar · enviada · empezada · sin_respuesta · completada.
--   "sin_respuesta" = enlace enviado (o ficha empezada) y sin ningún movimiento en 3 días o más. La última actividad es
--   onboarding.actualizado_en, que cambia con cada envío y con cada autoguardado del piloto.

ALTER TABLE onboarding ADD COLUMN IF NOT EXISTS envios smallint NOT NULL DEFAULT 0 CHECK (envios >= 0);

-- Los envíos hechos hasta hoy están en la línea de tiempo. Se rellenan sin tocar actualizado_en, que marca la actividad.
ALTER TABLE onboarding DISABLE TRIGGER onboarding_actualizado_en;
ALTER TABLE onboarding DISABLE TRIGGER onboarding_evento;
UPDATE onboarding o SET envios = x.n
FROM (SELECT persona_id, count(*)::int AS n FROM interaccion
      WHERE tipo = 'whatsapp_saliente' AND resumen = 'WhatsApp preparado: enlace de onboarding' GROUP BY persona_id) x
WHERE x.persona_id = o.persona_id AND o.envios = 0;
ALTER TABLE onboarding ENABLE TRIGGER onboarding_evento;
ALTER TABLE onboarding ENABLE TRIGGER onboarding_actualizado_en;

CREATE OR REPLACE VIEW v_onboarding AS
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
  o.creado_en,
  o.envios,
  CASE
    WHEN o.estado = 'completado' THEN 'completada'
    WHEN o.enlace_enviado_en IS NULL AND o.iniciado_en IS NULL THEN 'sin_enviar'
    WHEN o.actualizado_en < now() - interval '3 days' THEN 'sin_respuesta'
    WHEN o.iniciado_en IS NOT NULL THEN 'empezada'
    ELSE 'enviada'
  END                                               AS seguimiento,
  CASE WHEN o.estado <> 'completado' AND (o.enlace_enviado_en IS NOT NULL OR o.iniciado_en IS NOT NULL)
       THEN floor(extract(epoch FROM now() - o.actualizado_en) / 86400)::int END AS dias_sin_movimiento
FROM onboarding o
JOIN persona p ON p.id = o.persona_id
JOIN temporada t ON t.id = o.temporada_id
LEFT JOIN datos_sensibles_piloto ds ON ds.persona_id = o.persona_id
LEFT JOIN perfil_piloto pp ON pp.persona_id = o.persona_id
LEFT JOIN acceso_grupo ag ON ag.persona_id = o.persona_id AND ag.temporada_id = o.temporada_id;

-- La vista sigue siendo de solo lectura para la aplicación.
REVOKE INSERT, UPDATE, DELETE ON v_onboarding FROM rukc_app;
GRANT SELECT ON v_onboarding TO rukc_app;
