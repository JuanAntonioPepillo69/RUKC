// Panel: onboarding y grupo de WhatsApp (F5 pasos 10 y 11), aviso de edad mínima, foto del piloto y acreditación
// en la ronda (asistió o no presentado).
import { servirFoto } from '../archivos.js';
import { ErrorPanel } from '../admin.js';
import { MENSAJES } from '../../src/config/mensajes.js';
import { hashToken, nuevoToken } from '../tokens.js';
import * as V from '../validacion/panel.js';

const val = (esquema, datos) => V.validar(esquema, datos, ErrorPanel);
const uno = async (c, t, p) => (await c.query(t, p)).rows[0];
const filas = async (c, t, p) => (await c.query(t, p)).rows;
const pila = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const origen = (request) => new URL(request.url).origin.replace(/^http:\/\/localhost:\d+$/, 'https://raceupkc.com');
const wa = (telefono, texto) => `https://wa.me/${telefono.replace(/^\+/, '')}?text=${encodeURIComponent(texto)}`;

/** Pilotos inscritos en un circuito cuya edad mínima no alcanzan el día de la ronda. */
export const SQL_EDAD = `SELECT i.id AS inscripcion_id, p.id AS persona_id, btrim(p.nombre || ' ' || coalesce(p.apellidos, '')) AS piloto,
    r.numero AS ronda, r.fecha::text AS fecha, ci.nombre AS circuito, ci.edad_minima,
    date_part('year', age(r.fecha, ds.fecha_nacimiento))::int AS edad_en_ronda
  FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id JOIN circuito ci ON ci.id = r.circuito_id
  JOIN persona p ON p.id = i.piloto_persona_id JOIN datos_sensibles_piloto ds ON ds.persona_id = i.piloto_persona_id
  WHERE i.estado IN ('pendiente_pago', 'reservada', 'pagada') AND ci.edad_minima IS NOT NULL
    AND age(r.fecha, ds.fecha_nacimiento) < make_interval(years => ci.edad_minima)
  ORDER BY r.numero, piloto`;

export async function resumen({ tx }) {
  return tx(async (c) => {
    const t = await uno(c, `SELECT id, codigo, enlace_grupo_whatsapp FROM temporada WHERE estado IN ('abierta', 'en_curso') ORDER BY inicio DESC NULLS LAST LIMIT 1`);
    const grupo = await filas(c, `SELECT a.id, a.persona_id, a.estado, a.solicitado_en, a.decidido_en, a.motivo_rechazo, a.enlace_enviado_en, a.dentro_en,
        btrim(p.nombre || ' ' || coalesce(p.apellidos, '')) AS piloto, p.telefono, o.id AS onboarding_id
      FROM acceso_grupo a JOIN persona p ON p.id = a.persona_id
      LEFT JOIN onboarding o ON o.persona_id = a.persona_id AND o.temporada_id = a.temporada_id
      WHERE a.temporada_id = $1 AND a.estado IN ('pendiente_aprobacion', 'aprobado', 'enlace_enviado', 'rechazado')
      ORDER BY array_position(ARRAY['pendiente_aprobacion', 'aprobado', 'enlace_enviado', 'rechazado'], a.estado), a.solicitado_en`, [t?.id]);
    const edad = await filas(c, SQL_EDAD);
    return { temporada: t?.codigo ?? null, enlace_grupo: t?.enlace_grupo_whatsapp ?? null, grupo, edad };
  });
}

export async function guardarEnlaceGrupo({ body, tx }) {
  const { enlace } = val(V.enlaceGrupo, body);
  await tx((c) => c.query(`UPDATE temporada SET enlace_grupo_whatsapp = $1
    WHERE id = (SELECT id FROM temporada WHERE estado IN ('abierta', 'en_curso') ORDER BY inicio DESC NULLS LAST LIMIT 1)`, [enlace]));
  return { ok: true };
}

/**
 * Enlace nuevo al onboarding por WhatsApp (el anterior deja de valer). El primero lleva el mensaje de bienvenida; los
 * siguientes, el de recordatorio. Cuenta los envíos para el seguimiento (v_onboarding.seguimiento).
 */
export async function reenviarEnlace({ params, tx, admin, actor, request }) {
  return tx(async (c) => {
    const o = await uno(c, `SELECT o.id, o.estado, o.persona_id, o.envios, p.nombre, p.telefono FROM onboarding o JOIN persona p ON p.id = o.persona_id WHERE o.id = $1 FOR UPDATE OF o`, [params.id]);
    if (!o) throw new ErrorPanel(404, 'No existe ese onboarding.');
    if (!o.telefono) throw new ErrorPanel(400, 'No tiene teléfono.');
    const token = nuevoToken();
    await c.query('UPDATE onboarding SET token_hash = $2, enlace_enviado_en = now(), envios = envios + 1 WHERE id = $1', [o.id, hashToken(token)]);
    const recordatorio = o.envios > 0;
    const datos = { nombre: pila(o.nombre), enlace: `${origen(request)}/onboarding/${token}` };
    const texto = recordatorio ? MENSAJES.onboarding_recordatorio(datos) : MENSAJES.onboarding(datos);
    await c.query(`INSERT INTO interaccion (persona_id, tipo, resumen, ocurrida_en, admin_id, creado_por) VALUES ($1, 'whatsapp_saliente', $2, now(), $3, $4)`,
      [o.persona_id, recordatorio ? `WhatsApp preparado: recordatorio de la ficha (envío ${o.envios + 1})` : 'WhatsApp preparado: enlace de onboarding', admin.id, actor]);
    return { url: wa(o.telefono, texto), texto, envios: o.envios + 1 };
  });
}

async function acceso(c, id) {
  const a = await uno(c, `SELECT a.*, p.nombre, p.telefono, t.enlace_grupo_whatsapp FROM acceso_grupo a JOIN persona p ON p.id = a.persona_id
    JOIN temporada t ON t.id = a.temporada_id WHERE a.id = $1 FOR UPDATE OF a`, [id]);
  if (!a) throw new ErrorPanel(404, 'No existe esa solicitud de grupo.');
  return a;
}

export async function aprobarGrupo({ params, tx, admin }) {
  await tx(async (c) => {
    await acceso(c, params.id);
    await c.query(`UPDATE acceso_grupo SET estado = 'aprobado', decidido_por = $2, motivo_rechazo = NULL WHERE id = $1`, [params.id, admin.id]);
  });
  return { ok: true };
}

export async function rechazarGrupo({ params, body, tx, admin }) {
  const { motivo } = val(V.motivoObligatorio, body);
  await tx(async (c) => {
    await acceso(c, params.id);
    await c.query(`UPDATE acceso_grupo SET estado = 'rechazado', decidido_por = $2, motivo_rechazo = $3 WHERE id = $1`, [params.id, admin.id, motivo]);
  });
  return { ok: true };
}

export async function reabrirGrupo({ params, tx }) {
  await tx(async (c) => {
    await acceso(c, params.id);
    await c.query(`UPDATE acceso_grupo SET estado = 'pendiente_aprobacion', decidido_en = NULL, decidido_por = NULL WHERE id = $1`, [params.id]);
  });
  return { ok: true };
}

/** WhatsApp con el enlace del grupo; el acceso pasa a enlace_enviado. */
export async function enviarGrupo({ params, tx, admin, actor }) {
  return tx(async (c) => {
    const a = await acceso(c, params.id);
    if (!a.enlace_grupo_whatsapp) throw new ErrorPanel(400, 'Falta el enlace del grupo de la temporada: ponlo arriba en esta pantalla.');
    if (!a.telefono) throw new ErrorPanel(400, 'No tiene teléfono.');
    if (!['aprobado', 'enlace_enviado'].includes(a.estado)) throw new ErrorPanel(400, 'Primero aprueba su acceso al grupo.');
    if (a.estado === 'aprobado') await c.query(`UPDATE acceso_grupo SET estado = 'enlace_enviado' WHERE id = $1`, [a.id]);
    await c.query(`INSERT INTO interaccion (persona_id, tipo, resumen, ocurrida_en, admin_id, creado_por) VALUES ($1, 'whatsapp_saliente', $2, now(), $3, $4)`,
      [a.persona_id, 'WhatsApp preparado: enlace del grupo de pilotos', admin.id, actor]);
    return { url: wa(a.telefono, MENSAJES.grupo({ nombre: pila(a.nombre), enlace: a.enlace_grupo_whatsapp })) };
  });
}

export async function marcarDentro({ params, tx }) {
  await tx(async (c) => {
    const a = await acceso(c, params.id);
    if (a.estado === 'aprobado') await c.query(`UPDATE acceso_grupo SET estado = 'enlace_enviado' WHERE id = $1`, [a.id]);
    await c.query(`UPDATE acceso_grupo SET estado = 'dentro' WHERE id = $1`, [a.id]);
  });
  return { ok: true };
}

/** Foto del piloto, solo con sesión del panel. */
export async function foto({ params, tx }) {
  const p = await tx((c) => uno(c, 'SELECT foto_blob_path FROM perfil_piloto WHERE persona_id = $1', [params.id]));
  const r = await servirFoto(p?.foto_blob_path);
  if (!r) throw new ErrorPanel(404, 'No tiene foto.');
  return r;
}

// ---------- Acreditación en la ronda ----------

export async function acreditacion({ params, tx }) {
  return tx(async (c) => ({
    inscripciones: await filas(c, `SELECT i.id, i.estado, i.motivo, btrim(p.nombre || ' ' || coalesce(p.apellidos, '')) AS piloto, cat.codigo AS categoria,
        d.dorsal, o.estado AS onboarding, inscripcion_saldo_cent(i.id) AS saldo_cent
      FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id JOIN persona p ON p.id = i.piloto_persona_id
      LEFT JOIN categoria cat ON cat.id = i.categoria_id
      LEFT JOIN dorsal_temporada d ON d.persona_id = i.piloto_persona_id AND d.temporada_id = r.temporada_id
      LEFT JOIN onboarding o ON o.persona_id = i.piloto_persona_id AND o.temporada_id = r.temporada_id
      WHERE i.ronda_id = $1 AND i.estado IN ('pendiente_pago', 'reservada', 'pagada', 'asistio', 'no_presentado')
      ORDER BY cat.codigo NULLS LAST, d.dorsal NULLS LAST, piloto`, [params.id]),
  }));
}

/** Marca asistió o no presentado. Asistió exige onboarding completado o un motivo de excepción (también lo exige la base de datos). */
export async function asistencia({ params, body, tx }) {
  const d = val(V.asistencia, body);
  return tx(async (c) => {
    const i = await uno(c, `SELECT i.id, i.estado, o.estado AS onboarding FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id
      LEFT JOIN onboarding o ON o.persona_id = i.piloto_persona_id AND o.temporada_id = r.temporada_id WHERE i.id = $1 FOR UPDATE OF i`, [params.id]);
    if (!i) throw new ErrorPanel(404, 'No existe esa inscripción.');
    if (i.estado === 'pendiente_pago') throw new ErrorPanel(400, 'No tiene ningún pago confirmado: cobra antes la reserva.');
    if (d.estado === 'asistio' && i.onboarding !== 'completado' && !d.motivo) {
      throw new ErrorPanel(400, 'No ha completado el onboarding: indica el motivo de la excepción.', { necesita_motivo: true });
    }
    await c.query(`UPDATE inscripcion SET estado = $2, motivo = coalesce($3, motivo) WHERE id = $1`, [i.id, d.estado, d.motivo]);
    return { ok: true };
  });
}
