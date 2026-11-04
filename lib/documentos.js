// Versiones de los documentos legales. Una versión solo se activa con la fecha de revisión del abogado (lo exige la
// base de datos). Al activar: se cierra la versión vigente del mismo tipo y, si el documento es obligatorio en el
// onboarding, los onboardings completados que no tengan firmada la versión nueva pasan a requiere_actualizacion
// (el piloto vuelve a entrar con su enlace y solo ve el paso de documentos).
const uno = async (c, t, p) => (await c.query(t, p)).rows[0];
const err = (status, mensaje) => Object.assign(new Error(mensaje), { status });

/** Activa una versión ahora. Devuelve { cerradas: [versiones], requieren_firma: n }. */
export async function activar(c, documentoId) {
  const d = await uno(c, 'SELECT id, tipo, version, revisado_abogado_en, vigente_desde, obligatorio_onboarding FROM documento_legal WHERE id = $1 FOR UPDATE', [documentoId]);
  if (!d) throw err(404, 'No existe ese documento.');
  if (d.vigente_desde) throw err(400, 'Esa versión ya está activada.');
  if (!d.revisado_abogado_en) throw err(400, 'Antes de activarla, anota la fecha en que la revisó el abogado.');
  const cerradas = await c.query(`UPDATE documento_legal SET vigente_hasta = now()
    WHERE tipo = $1 AND id <> $2 AND vigente_desde IS NOT NULL AND (vigente_hasta IS NULL OR vigente_hasta > now()) RETURNING version`, [d.tipo, d.id]);
  await c.query('UPDATE documento_legal SET vigente_desde = now() WHERE id = $1', [d.id]);
  let requieren = 0;
  if (d.obligatorio_onboarding) {
    requieren = (await c.query(`UPDATE onboarding o SET estado = 'requiere_actualizacion' WHERE o.estado = 'completado'
      AND NOT EXISTS (SELECT 1 FROM aceptacion a WHERE a.persona_id = o.persona_id AND a.documento_legal_id = $1 AND a.revocada_en IS NULL)`, [d.id])).rowCount;
  }
  return { tipo: d.tipo, version: d.version, cerradas: cerradas.rows.map((r) => r.version), requieren_firma: requieren };
}
