// Acciones del panel: leads (F3), personas (ficha 360, edición, fusión), recuperar, WhatsApp, rondas y ajustes.
import { MENSAJES } from '../../src/config/mensajes.js';
import { SITE } from '../../src/config/site.js';
import { ErrorPanel } from '../admin.js';
import { asegurarOnboarding } from '../flujos.js';
import { normalizarTelefono } from '../telefono.js';
import { hashToken, nuevoToken } from '../tokens.js';
import * as V from '../validacion/panel.js';

const val = (esquema, datos) => V.validar(esquema, datos, ErrorPanel);
const uno = async (c, t, p) => (await c.query(t, p)).rows[0];
const filas = async (c, t, p) => (await c.query(t, p)).rows;
const temporadaVigente = (c) => uno(c, `SELECT id, codigo FROM temporada WHERE estado IN ('abierta', 'en_curso') ORDER BY inicio DESC NULLS LAST LIMIT 1`);

// ---------- Leads (F3) ----------

/** El teléfono se escribe primero: si ya existe, el panel abre su ficha en vez de duplicar. */
export async function buscarPorTelefono({ body, tx }) {
  const { telefono } = val(V.buscarTelefono, body);
  const p = await tx((c) => uno(c, 'SELECT id, nombre, apellidos FROM persona WHERE telefono = $1', [telefono]));
  return { telefono, persona: p ?? null };
}

export async function nuevoLead({ body, tx, admin, actor }) {
  const d = val(V.nuevoLead, body);
  return tx(async (c) => {
    const existe = await uno(c, 'SELECT id FROM persona WHERE telefono = $1 OR ($2::citext IS NOT NULL AND email = $2)', [d.telefono, d.email]);
    if (existe) throw new ErrorPanel(409, 'Esa persona ya existe: abre su ficha.', { persona_id: existe.id });
    const t = await temporadaVigente(c);
    const p = await uno(c, `INSERT INTO persona (nombre, apellidos, telefono, email, origen_alta, creado_por)
      VALUES ($1, $2, $3, $4, 'alta_manual', $5) RETURNING id`, [d.nombre, d.apellidos, d.telefono, d.email, actor]);
    await c.query(`INSERT INTO atribucion (persona_id, canal, utm_campaign, creado_por) VALUES ($1, $2, $3, $4)`, [p.id, d.canal, d.campana, actor]);
    const o = await uno(c, `INSERT INTO oportunidad (persona_id, temporada_id, origen, proxima_accion, proxima_accion_en, creado_por)
      VALUES ($1, $2, 'alta_manual', $3, $4, $5) RETURNING id`, [p.id, t.id, d.proxima_accion, d.proxima_accion_en ?? null, actor]);
    await c.query(`INSERT INTO interaccion (persona_id, oportunidad_id, tipo, resumen, ocurrida_en, admin_id, creado_por)
      VALUES ($1, $2, 'whatsapp_entrante', $3, now(), $4, $5)`, [p.id, o.id, d.nota, admin.id, actor]);
    return { persona_id: p.id, oportunidad_id: o.id };
  });
}

export async function cambiarEtapa({ params, body, tx }) {
  const d = val(V.etapa, body);
  if (d.etapa === 'perdida' && !d.motivo) throw new ErrorPanel(400, 'Indica el motivo de la pérdida.');
  await tx((c) => c.query(`UPDATE oportunidad SET etapa = $2, motivo_perdida = CASE WHEN $2 = 'perdida' THEN $3 ELSE motivo_perdida END WHERE id = $1`,
    [params.id, d.etapa, d.motivo]));
  return { ok: true };
}

export async function proximaAccion({ params, body, tx }) {
  const d = val(V.proxima, body);
  await tx((c) => c.query('UPDATE oportunidad SET proxima_accion = $2, proxima_accion_en = $3 WHERE id = $1',
    [params.id, d.proxima_accion, d.proxima_accion_en ?? null]));
  return { ok: true };
}

export async function nuevaInteraccion({ body, tx, admin, actor }) {
  const d = val(V.interaccion, body);
  await tx((c) => c.query(`INSERT INTO interaccion (persona_id, oportunidad_id, tipo, resumen, ocurrida_en, admin_id, creado_por)
    VALUES ($1, $2, $3, $4, now(), $5, $6)`, [d.persona_id, d.oportunidad_id ?? null, d.tipo, d.resumen, admin.id, actor]));
  return { ok: true };
}

// ---------- Personas ----------

export async function buscarPersonas({ url, tx }) {
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 2) return { personas: [] };
  const tel = normalizarTelefono(q);
  return tx(async (c) => ({ personas: await filas(c,
    `SELECT id, nombre, apellidos, telefono, email FROM persona
     WHERE estado = 'activa' AND (telefono = $2 OR email = $1::citext OR (nombre || ' ' || coalesce(apellidos, '')) ILIKE '%' || $1 || '%')
     ORDER BY nombre LIMIT 20`, [q, tel]) }));
}

/** Ficha 360: resumen, línea de tiempo, inscripciones, pagos, aceptaciones e interacciones. Sin datos sensibles. */
export async function ficha({ params, tx }) {
  return tx(async (c) => {
    const p = await uno(c, 'SELECT * FROM v_persona_360 WHERE id = $1', [params.id]);
    if (!p) throw new ErrorPanel(404, 'No existe esa persona.');
    const [persona, oportunidades, inscripciones, pagos, aceptaciones, solicitudes] = await Promise.all([
      uno(c, 'SELECT id, nombre, apellidos, email, telefono, municipio, instagram, notas, estado, origen_alta FROM persona WHERE id = $1', [params.id]),
      filas(c, `SELECT o.id, t.codigo AS temporada, o.etapa, o.origen, o.proxima_accion, o.proxima_accion_en, o.motivo_perdida
                FROM oportunidad o JOIN temporada t ON t.id = o.temporada_id WHERE o.persona_id = $1 ORDER BY o.creado_en DESC`, [params.id]),
      filas(c, `SELECT id, codigo, ronda, ronda_fecha, circuito, categoria, precio_cent, pagado_cent, credito_cent, saldo_cent, estado, pagador, onboarding
                FROM v_inscripciones WHERE piloto_persona_id = $1 OR id IN (SELECT i.id FROM inscripcion i JOIN pedido pe ON pe.id = i.pedido_id WHERE pe.pagador_persona_id = $1)
                ORDER BY ronda_fecha`, [params.id]),
      filas(c, `SELECT id, codigo, fecha, metodo, importe_cent, estado, inscripciones, factura_ref FROM v_pagos WHERE pagador_persona_id = $1 ORDER BY fecha DESC`, [params.id]),
      filas(c, `SELECT a.aceptada_en, a.revocada_en, a.aceptado, a.contexto, d.tipo, d.version FROM aceptacion a JOIN documento_legal d ON d.id = a.documento_legal_id
                WHERE a.persona_id = $1 ORDER BY a.aceptada_en DESC`, [params.id]),
      filas(c, `SELECT id, codigo, estado, metodo_elegido, creado_en FROM solicitud_inscripcion WHERE persona_id = $1 ORDER BY creado_en DESC`, [params.id]),
    ]);
    return { resumen: p, persona, oportunidades, inscripciones, pagos, aceptaciones, solicitudes };
  });
}

export async function editarPersona({ params, body, tx }) {
  const d = val(V.editarPersona, body);
  const cols = Object.keys(d).filter((k) => d[k] !== undefined);
  if (!cols.length) return { ok: true };
  await tx((c) => c.query(`UPDATE persona SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 AND estado = 'activa'`,
    [params.id, ...cols.map((k) => d[k])]));
  return { ok: true };
}

/**
 * Fusión de duplicados: todo lo del duplicado pasa a la persona principal y el duplicado queda anonimizado con una
 * nota. No se fusiona si el duplicado tiene aceptaciones firmadas (no se pueden mover) o choca con un onboarding,
 * un acceso al grupo, una oportunidad o un dorsal de la misma temporada.
 */
export async function fusionar({ params, body, tx }) {
  const { duplicado_id } = val(V.fusionar, body);
  if (duplicado_id === params.id) throw new ErrorPanel(400, 'Elige otra persona.');
  return tx(async (c) => {
    const [a, b] = await Promise.all([uno(c, 'SELECT * FROM persona WHERE id = $1 FOR UPDATE', [params.id]), uno(c, 'SELECT * FROM persona WHERE id = $1 FOR UPDATE', [duplicado_id])]);
    if (!a || !b || a.estado !== 'activa' || b.estado !== 'activa') throw new ErrorPanel(404, 'No existe una de las dos personas.');
    if ((await uno(c, 'SELECT count(*)::int AS n FROM aceptacion WHERE persona_id = $1 OR firmante_persona_id = $1', [b.id])).n) {
      throw new ErrorPanel(409, 'El duplicado tiene documentos firmados: fusiónalo al revés (deja como principal la persona que firmó).');
    }
    for (const [tabla, col] of [['onboarding', 'temporada_id'], ['acceso_grupo', 'temporada_id'], ['oportunidad', 'temporada_id'], ['dorsal_temporada', 'temporada_id']]) {
      const choque = await uno(c, `SELECT count(*)::int AS n FROM ${tabla} x WHERE x.persona_id = $1 AND x.${col} IN (SELECT ${col} FROM ${tabla} WHERE persona_id = $2)`, [b.id, a.id]);
      if (choque.n) throw new ErrorPanel(409, `Las dos personas tienen ${tabla.replace('_', ' ')} en la misma temporada: resuélvelo antes de fusionar.`);
    }
    if ((await uno(c, `SELECT count(*)::int AS n FROM perfil_piloto WHERE persona_id = $1`, [b.id])).n
        && (await uno(c, `SELECT count(*)::int AS n FROM perfil_piloto WHERE persona_id = $1`, [a.id])).n) {
      throw new ErrorPanel(409, 'Las dos personas tienen ficha de piloto: resuélvelo antes de fusionar.');
    }
    const mover = [['solicitud_inscripcion', 'persona_id'], ['pedido', 'pagador_persona_id'], ['inscripcion', 'piloto_persona_id'],
      ['pago', 'pagador_persona_id'], ['atribucion', 'persona_id'], ['oportunidad', 'persona_id'], ['interaccion', 'persona_id'],
      ['movimiento_credito', 'persona_id'], ['onboarding', 'persona_id'], ['acceso_grupo', 'persona_id'], ['consentimiento', 'persona_id'],
      ['dorsal_temporada', 'persona_id'], ['perfil_piloto', 'persona_id'], ['solicitud_rgpd', 'persona_id']];
    for (const [tabla, col] of mover) await c.query(`UPDATE ${tabla} SET ${col} = $1 WHERE ${col} = $2`, [a.id, b.id]);
    // El duplicado queda anonimizado y, después, el principal toma lo que no tenga (nunca se sobrescribe).
    await c.query(`UPDATE persona SET estado = 'anonimizada', anonimizada_en = now(), nombre = 'Fusionada', apellidos = NULL, email = NULL,
      telefono = NULL, municipio = NULL, instagram = NULL, notas = $2 WHERE id = $1`, [b.id, `Fusionada con ${a.id}`]);
    await c.query(`UPDATE persona SET email = coalesce(email, $2), telefono = coalesce(telefono, $3), apellidos = coalesce(apellidos, $4),
      municipio = coalesce(municipio, $5), instagram = coalesce(instagram, $6) WHERE id = $1`, [a.id, b.email, b.telefono, b.apellidos, b.municipio, b.instagram]);
    return { ok: true, persona_id: a.id };
  });
}

// ---------- Recuperar ----------

export async function descartarSolicitud({ params, tx }) {
  await tx((c) => c.query(`UPDATE solicitud_inscripcion SET estado = 'descartada' WHERE id = $1`, [params.id]));
  return { ok: true };
}

/**
 * Prepara un WhatsApp con el mensaje de src/config/mensajes.js y lo registra: interacción si hay persona; si no,
 * una fila en evento. La confirmación genera un enlace de onboarding nuevo (el anterior deja de valer).
 */
export async function whatsapp({ body, tx, admin, actor, request }) {
  const d = val(V.whatsapp, body);
  return tx(async (c) => {
    let destino, texto, personaId = d.persona_id ?? null;
    const pila = (n) => String(n || '').trim().split(/\s+/)[0] || '';
    if (d.solicitud_id) {
      const s = await uno(c, `SELECT s.*, r.numero FROM solicitud_inscripcion s LEFT JOIN ronda r ON r.id = s.ronda_id WHERE s.id = $1`, [d.solicitud_id]);
      if (!s) throw new ErrorPanel(404, 'No existe esa solicitud.');
      destino = s.pagador_telefono;
      personaId = s.persona_id;
      texto = MENSAJES[d.tipo]({ nombre: pila(s.pagador_nombre), ronda: s.numero, codigo: s.codigo });
    } else if (d.inscripcion_id) {
      const i = await uno(c, `SELECT i.id, i.piloto_persona_id, i.precio_cent, r.numero, r.temporada_id, ci.nombre AS circuito, p.nombre, p.telefono,
        inscripcion_saldo_cent(i.id) AS saldo FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id JOIN circuito ci ON ci.id = r.circuito_id
        JOIN persona p ON p.id = i.piloto_persona_id WHERE i.id = $1`, [d.inscripcion_id]);
      if (!i) throw new ErrorPanel(404, 'No existe esa inscripción.');
      destino = i.telefono;
      personaId = i.piloto_persona_id;
      let enlace = '';
      if (d.tipo === 'confirmacion') {
        const oid = await asegurarOnboarding(c, i.piloto_persona_id, i.temporada_id);
        const token = nuevoToken();
        await c.query('UPDATE onboarding SET token_hash = $2, enlace_enviado_en = now() WHERE id = $1', [oid, hashToken(token)]);
        enlace = `${new URL(request.url).origin.replace(/^http:\/\/localhost:\d+$/, 'https://raceupkc.com')}/onboarding/${token}`;
      }
      texto = MENSAJES[d.tipo]({ nombre: pila(i.nombre), ronda: i.numero, circuito: i.circuito, enlace, importe: i.saldo / 100 });
    } else if (d.persona_id) {
      const p = await uno(c, 'SELECT nombre, telefono FROM persona WHERE id = $1', [d.persona_id]);
      if (!p) throw new ErrorPanel(404, 'No existe esa persona.');
      destino = p.telefono;
      texto = MENSAJES[d.tipo]({ nombre: pila(p.nombre) });
    } else throw new ErrorPanel(400, 'Falta a quién va el mensaje.');
    if (!destino) throw new ErrorPanel(400, 'No tiene teléfono.');

    if (personaId) {
      await c.query(`INSERT INTO interaccion (persona_id, tipo, resumen, ocurrida_en, admin_id, creado_por)
        VALUES ($1, 'whatsapp_saliente', $2, now(), $3, $4)`, [personaId, `WhatsApp preparado: ${d.tipo.replace(/_/g, ' ')}`, admin.id, actor]);
    } else {
      await c.query(`INSERT INTO evento (actor, entidad, entidad_id, accion, despues, ip) VALUES ($1, 'solicitud_inscripcion', $2, 'whatsapp', $3, current_setting('rukc.ip', true))`,
        [actor, d.solicitud_id, { tipo: d.tipo }]);
    }
    return { url: `https://wa.me/${destino.replace(/^\+/, '')}?text=${encodeURIComponent(texto)}`, texto };
  });
}

// ---------- Rondas e inscripciones ----------

export async function rondas({ tx }) {
  return tx(async (c) => {
    const lista = await filas(c, `SELECT r.id, r.numero, r.fecha::text AS fecha, r.estado, r.notas, ci.nombre AS circuito
      FROM ronda r JOIN circuito ci ON ci.id = r.circuito_id
      WHERE r.temporada_id = (SELECT id FROM temporada WHERE estado IN ('abierta', 'en_curso') ORDER BY inicio DESC NULLS LAST LIMIT 1)
      ORDER BY r.numero`);
    const parrilla = await filas(c, `SELECT ronda_id, categoria, plazas, inscritos, pagados, reservados, libres, en_sobrecupo, estado_cupo FROM v_parrilla`);
    return { rondas: lista.map((r) => ({ ...r, cupos: parrilla.filter((p) => p.ronda_id === r.id) })) };
  });
}

export async function cambiarCupo({ params, body, tx }) {
  const d = val(V.cupo, body);
  const r = await tx((c) => c.query(`UPDATE cupo_ronda SET estado_inscripcion = $3 WHERE ronda_id = $1
    AND categoria_id = (SELECT cat.id FROM categoria cat JOIN ronda r ON r.temporada_id = cat.temporada_id WHERE r.id = $1 AND cat.codigo = $2)`,
    [params.id, d.categoria, d.estado]));
  if (!r.rowCount) throw new ErrorPanel(404, 'No existe ese cupo.');
  return { ok: true };
}

export async function aplazarRonda({ params, body, tx }) {
  const d = val(V.fechaRonda, body);
  await tx((c) => c.query(`UPDATE ronda SET estado = 'aplazada', fecha = $2, notas = coalesce($3, notas) WHERE id = $1`, [params.id, d.fecha, d.motivo]));
  return { ok: true, aviso: 'Cambia también la fecha en la pestaña Rondas de la hoja: si no coinciden, la web no se publica.' };
}

export async function reprogramarRonda({ params, body, tx }) {
  const d = val(V.fechaRonda, body);
  await tx((c) => c.query(`UPDATE ronda SET estado = 'programada', fecha = $2 WHERE id = $1`, [params.id, d.fecha]));
  return { ok: true, aviso: 'Cambia también la fecha en la pestaña Rondas de la hoja: si no coinciden, la web no se publica.' };
}

export async function cambiarCategoria({ params, body, tx }) {
  const d = val(V.categoriaInscripcion, body);
  await tx((c) => c.query(`UPDATE inscripcion i SET categoria_id = cat.id, categoria_origen = CASE WHEN cat.id IS NULL THEN 'pendiente' ELSE 'por_peso' END
    FROM ronda r LEFT JOIN categoria cat ON cat.temporada_id = r.temporada_id AND cat.codigo = $2
    WHERE i.id = $1 AND r.id = i.ronda_id`, [params.id, d.categoria]));
  return { ok: true };
}

// ---------- Ajustes ----------

export async function entidad({ tx }) {
  return tx(async (c) => ({ entidad: await uno(c, 'SELECT id, nombre_comercial, titular_legal, nif, tipo, activa_desde::text AS activa_desde FROM entidad_cobradora WHERE activa_hasta IS NULL'),
    contacto: SITE.email }));
}

export async function guardarEntidad({ body, tx }) {
  const d = val(V.entidad, body);
  await tx((c) => c.query(`UPDATE entidad_cobradora SET nombre_comercial = $1, titular_legal = $2, nif = $3, tipo = $4, activa_desde = $5
    WHERE activa_hasta IS NULL`, [d.nombre_comercial, d.titular_legal, d.nif, d.tipo ?? null, d.activa_desde ?? null]));
  return { ok: true };
}
