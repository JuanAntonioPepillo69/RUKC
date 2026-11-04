// Protección de datos: exportar todo lo de una persona (acceso y portabilidad), candidatos a anonimizar (plazo de
// conservación vencido) y anonimización. Diseño: "Protección de datos" (Derechos y Anonimización).
// Plazo que se aplica (propuesta del diseño, a confirmar por John): datos del contrato "mientras participe + 1
// temporada", que aquí es más de 12 meses sin ninguna actividad (inscripción, pago, mensaje, solicitud, firma o
// crédito). La lista solo propone: nadie se anonimiza sin que John lo confirme.
import { borrarFoto } from './archivos.js';
import { descifrar } from './cifrado.js';

const uno = async (c, t, p) => (await c.query(t, p)).rows[0];
const filas = async (c, t, p) => (await c.query(t, p)).rows;
const err = (status, mensaje) => Object.assign(new Error(mensaje), { status });

const ULTIMA_ACTIVIDAD = `greatest(p.creado_en,
    (SELECT max(r.fecha)::timestamptz FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id WHERE i.piloto_persona_id = p.id),
    (SELECT max(coalesce(pg.recibido_en, pg.creado_en)) FROM pago pg WHERE pg.pagador_persona_id = p.id),
    (SELECT max(x.ocurrida_en) FROM interaccion x WHERE x.persona_id = p.id),
    (SELECT max(s.actualizado_en) FROM solicitud_inscripcion s WHERE s.persona_id = p.id),
    (SELECT max(a.aceptada_en) FROM aceptacion a WHERE a.persona_id = p.id),
    (SELECT max(m.creado_en) FROM movimiento_credito m WHERE m.persona_id = p.id))`;

/** Personas con el plazo vencido y nada pendiente (inscripción activa, crédito, solicitud RGPD o pago por verificar). */
export async function candidatos(c) {
  return filas(c, `SELECT * FROM (
      SELECT p.id, btrim(p.nombre || ' ' || coalesce(p.apellidos, '')) AS persona, p.telefono, p.email, ${ULTIMA_ACTIVIDAD} AS ultima_actividad
      FROM persona p WHERE p.estado = 'activa'
        AND NOT EXISTS (SELECT 1 FROM inscripcion i WHERE i.piloto_persona_id = p.id AND i.estado IN ('pendiente_pago', 'reservada', 'pagada'))
        AND NOT EXISTS (SELECT 1 FROM pago pg WHERE pg.pagador_persona_id = p.id AND pg.estado = 'pendiente_verificacion')
        AND NOT EXISTS (SELECT 1 FROM solicitud_rgpd s WHERE s.persona_id = p.id AND s.estado = 'pendiente')
        AND credito_saldo_cent(p.id) = 0
        AND NOT EXISTS (SELECT 1 FROM admin a WHERE a.email = p.email)
    ) x WHERE ultima_actividad < now() - interval '12 months' ORDER BY ultima_actividad`);
}

/** Todo lo que hay de una persona, para entregárselo (acceso o portabilidad). Incluye su documento descifrado. */
export async function exportar(c, personaId) {
  const persona = await uno(c, 'SELECT * FROM persona WHERE id = $1', [personaId]);
  if (!persona) throw err(404, 'No existe esa persona.');
  const de = (t, col = 'persona_id') => filas(c, `SELECT * FROM ${t} WHERE ${col} = $1`, [personaId]);
  const sensibles = await uno(c, 'SELECT * FROM datos_sensibles_piloto WHERE persona_id = $1', [personaId]);
  if (sensibles?.documento_cifrado) {
    sensibles.documento = descifrar(sensibles.documento_cifrado);
    delete sensibles.documento_cifrado;
  }
  const inscripciones = await filas(c, `SELECT i.codigo, r.numero AS ronda, r.fecha, ci.nombre AS circuito, i.precio_cent, i.estado, i.resolucion, i.categoria_origen,
      cat.codigo AS categoria, inscripcion_pagado_cent(i.id) AS pagado_cent FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id
    JOIN circuito ci ON ci.id = r.circuito_id LEFT JOIN categoria cat ON cat.id = i.categoria_id WHERE i.piloto_persona_id = $1 ORDER BY r.fecha`, [personaId]);
  const aceptaciones = await filas(c, `SELECT d.tipo, d.version, d.titulo, a.aceptado, a.opciones, a.contexto, a.nombre_tecleado, a.documento_ultimos3, a.ip, a.user_agent,
      a.aceptada_en, a.revocada_en FROM aceptacion a JOIN documento_legal d ON d.id = a.documento_legal_id WHERE a.persona_id = $1 ORDER BY a.aceptada_en`, [personaId]);
  const feedback = await filas(c, `SELECT r.numero AS ronda, e.estado, e.respondido_en, rf.pregunta_id, rf.valor_num, rf.valor_texto, rf.valor_opciones
    FROM envio_feedback e JOIN inscripcion i ON i.id = e.inscripcion_id JOIN ronda r ON r.id = i.ronda_id
    LEFT JOIN respuesta_feedback rf ON rf.envio_id = e.id WHERE i.piloto_persona_id = $1`, [personaId]);
  const quitar = (rows, ...cols) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !cols.includes(k))));
  return {
    generado_en: new Date().toISOString(),
    responsable: 'RUKC (raceupkc@gmail.com)',
    persona,
    perfil_piloto: await uno(c, 'SELECT * FROM perfil_piloto WHERE persona_id = $1', [personaId]),
    datos_sensibles: sensibles ?? null,
    tutela: await filas(c, `SELECT tu.relacion, btrim(p.nombre || ' ' || coalesce(p.apellidos, '')) AS tutor FROM tutela tu JOIN persona p ON p.id = tu.tutor_persona_id WHERE tu.menor_persona_id = $1`, [personaId]),
    inscripciones,
    pagos: quitar(await de('pago', 'pagador_persona_id'), 'justificante_path'),
    creditos: await de('movimiento_credito'),
    aceptaciones,
    consentimientos: await de('consentimiento'),
    solicitudes_web: quitar(await de('solicitud_inscripcion'), 'borrador_token_hash', 'ip_hash'),
    origen: await de('atribucion'),
    oportunidades: await de('oportunidad'),
    interacciones: await de('interaccion'),
    onboarding: quitar(await de('onboarding'), 'token_hash', 'borrador'),
    acceso_grupo: await de('acceso_grupo'),
    feedback,
    solicitudes_rgpd: await de('solicitud_rgpd'),
  };
}

/**
 * Anonimiza una persona: vacía sus datos personales, borra sus datos sensibles y su foto y deja los importes para
 * la contabilidad. Las aceptaciones firmadas no se tocan (son la prueba de la firma; la base de datos no deja).
 * Devuelve la ruta de la foto para borrarla después de confirmar la transacción.
 */
export async function anonimizar(c, personaId, motivo) {
  const p = await uno(c, 'SELECT estado FROM persona WHERE id = $1 FOR UPDATE', [personaId]);
  if (!p) throw err(404, 'No existe esa persona.');
  if (p.estado === 'anonimizada') throw err(400, 'Ya está anonimizada.');
  if ((await uno(c, `SELECT count(*)::int AS n FROM inscripcion WHERE piloto_persona_id = $1 AND estado IN ('pendiente_pago', 'reservada', 'pagada')`, [personaId])).n) {
    throw err(400, 'Tiene inscripciones activas: cancélalas o espera a que termine la ronda.');
  }
  const foto = (await uno(c, 'SELECT foto_blob_path FROM perfil_piloto WHERE persona_id = $1', [personaId]))?.foto_blob_path ?? null;
  await c.query(`UPDATE persona SET nombre = 'Anonimizada', apellidos = NULL, email = NULL, telefono = NULL, municipio = NULL, instagram = NULL, notas = NULL,
    estado = 'anonimizada', anonimizada_en = now() WHERE id = $1`, [personaId]);
  await c.query('DELETE FROM datos_sensibles_piloto WHERE persona_id = $1', [personaId]);
  await c.query(`UPDATE perfil_piloto SET nombre_competicion = 'Anónimo', foto_blob_path = NULL, ligas_previas = NULL, circuitos_rodados = NULL,
    altura_cm = NULL, objetivo = NULL, como_nos_conocio = NULL, comentarios = NULL WHERE persona_id = $1`, [personaId]);
  await c.query(`UPDATE interaccion SET resumen = 'Anonimizado' WHERE persona_id = $1`, [personaId]);
  await c.query('UPDATE atribucion SET fbclid = NULL, fbc = NULL, fbp = NULL, referrer = NULL WHERE persona_id = $1', [personaId]);
  // Las solicitudes no descartadas exigen un contacto: queda una dirección que no existe.
  await c.query(`UPDATE solicitud_inscripcion SET pagador_nombre = NULL, pagador_telefono = NULL,
      pagador_email = CASE WHEN estado = 'descartada' THEN NULL ELSE 'anonimizada@rukc.invalid' END,
      piloto_nombre = CASE WHEN piloto_es_pagador OR estado IN ('borrador', 'descartada') THEN NULL ELSE 'Anonimizada' END,
      piloto_telefono = NULL, ip_hash = NULL, user_agent = NULL WHERE persona_id = $1`, [personaId]);
  await c.query(`UPDATE onboarding SET borrador = NULL, token_hash = encode(gen_random_bytes(32), 'hex') WHERE persona_id = $1`, [personaId]);
  await c.query('UPDATE consentimiento SET revocado_en = now() WHERE persona_id = $1 AND revocado_en IS NULL', [personaId]);
  await c.query(`INSERT INTO evento (actor, entidad, entidad_id, accion, despues, ip) VALUES (current_setting('rukc.actor', true), 'persona', $1, 'anonimizacion', $2, current_setting('rukc.ip', true))`,
    [personaId, { motivo }]);
  return { foto };
}

/** Anonimiza y, después de la transacción, borra la foto del almacén. `tx(fn)` abre la transacción. */
export async function anonimizarConFoto(tx, personaId, motivo) {
  const { foto } = await tx((c) => anonimizar(c, personaId, motivo));
  if (foto) await borrarFoto(foto).catch((e) => console.error('rgpd foto', e.message));
  return { ok: true, foto_borrada: Boolean(foto) };
}
