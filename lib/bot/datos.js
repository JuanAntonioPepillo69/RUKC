// Acceso a datos del bot: lo que leen y escriben las herramientas. Separado de tools.js para que los tests puedan
// sustituir piezas (por ejemplo, las inscripciones de un contacto de prueba) sin tocar la base de datos real.
// Todas las consultas van parametrizadas. Las escrituras de negocio usan conTransaccion con actor "sistema".
import { conTransaccion, consulta } from '../db.js';
import { buscarOCrearPersona } from '../flujos.js';
import { silencia } from './escalado.js';
import { leerDocumentos } from './kb.js';

export const WEB = 'https://raceupkc.com';
export const MODO_HUMANO_ESCALADO_H = 24;

const uno = async (c, t, p) => (await c.query(t, p)).rows[0] ?? null;
const euros = (cent) => (cent == null ? null : Math.round(Number(cent)) / 100);

// --- Caché corta de la base de conocimiento (las funciones de Vercel se reutilizan entre peticiones) ------------
let cacheKb = { en: 0, docs: null };
export async function documentosKb({ fresco = false } = {}) {
  if (!fresco && cacheKb.docs && Date.now() - cacheKb.en < 60_000) return cacheKb.docs;
  const docs = await leerDocumentos(consulta);
  cacheKb = { en: Date.now(), docs };
  return docs;
}

// --- Ajustes -----------------------------------------------------------------------------------------------------
export async function ajuste(clave) {
  const [f] = await consulta('SELECT valor FROM bot_settings WHERE clave = $1', [clave]);
  return f?.valor ?? null;
}
export async function botActivo() {
  return (await ajuste('bot_activo')) !== 'false';
}

// --- Rondas --------------------------------------------------------------------------------------------------------
/** Martes anterior a la fecha de la ronda (cierre de inscripción), en formato YYYY-MM-DD. */
export function martesAnterior(fechaIso) {
  const d = new Date(`${fechaIso}T12:00:00Z`);
  const atras = ((d.getUTCDay() - 2 + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() - atras);
  return d.toISOString().slice(0, 10);
}

const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

export async function rondas({ soloAbiertas = true } = {}) {
  const filas = await consulta(
    `SELECT r.id, r.numero, r.fecha::text AS fecha, r.estado, r.hora_inicio::text AS hora_inicio,
            r.hora_acreditacion::text AS hora_acreditacion, r.hora_briefing::text AS hora_briefing, r.maps_url,
            c.nombre AS circuito, c.municipio, c.edad_minima, t.codigo AS temporada
     FROM ronda r JOIN circuito c ON c.id = r.circuito_id JOIN temporada t ON t.id = r.temporada_id
     WHERE t.estado IN ('abierta', 'en_curso')
     ORDER BY r.fecha, r.numero`);
  const cupos = await consulta(
    `SELECT v.ronda_id, v.categoria, c.nombre, v.plazas, v.libres, v.estado_cupo,
            cr.hora_llegada::text AS hora_llegada, cr.hora_briefing::text AS hora_briefing
     FROM v_parrilla v JOIN categoria c ON c.id = v.categoria_id
     LEFT JOIN cupo_ronda cr ON cr.ronda_id = v.ronda_id AND cr.categoria_id = v.categoria_id
     WHERE v.ronda_id = ANY($1::uuid[]) ORDER BY c.orden`, [filas.map((r) => r.id)]);
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  return filas
    .map((r) => {
      const cierre = martesAnterior(r.fecha);
      const cats = cupos.filter((c) => c.ronda_id === r.id).map((c) => ({
        categoria: c.nombre, plazas: Number(c.plazas), libres: Math.max(0, Number(c.libres)), inscripcion: c.estado_cupo,
        // Hora de llegada (acreditación y pesaje) y de briefing de esa categoría; si no tiene, las de la ronda.
        hora_llegada: hhmm(c.hora_llegada) ?? hhmm(r.hora_acreditacion), hora_briefing: hhmm(c.hora_briefing) ?? hhmm(r.hora_briefing),
      }));
      const abierta = ['programada', 'aplazada'].includes(r.estado) && r.fecha >= hoy && hoy <= cierre
        && cats.some((c) => c.inscripcion === 'abierta' && c.libres > 0);
      return {
        ronda_id: r.id, ronda: `R${r.numero}`, temporada: r.temporada, fecha: r.fecha, estado: r.estado,
        circuito: r.circuito, municipio: r.municipio,
        hora_acreditacion: hhmm(r.hora_acreditacion), hora_briefing: hhmm(r.hora_briefing), maps_url: r.maps_url,
        cierre_inscripcion: cierre, inscripcion_abierta: abierta, plazas_por_categoria: cats,
      };
    })
    .filter((r) => (soloAbiertas ? r.inscripcion_abierta : true));
}

export async function rondaPorReferencia(ref) {
  const s = String(ref || '').trim();
  const numero = /^r?\d+$/i.test(s) ? Number(s.replace(/^r/i, '')) : null;
  const [r] = await consulta(
    `SELECT r.id, r.numero, r.fecha::text AS fecha, c.nombre AS circuito
     FROM ronda r JOIN circuito c ON c.id = r.circuito_id JOIN temporada t ON t.id = r.temporada_id
     WHERE t.estado IN ('abierta', 'en_curso') AND ($1::uuid IS NOT NULL AND r.id = $1::uuid OR r.numero = $2)
     LIMIT 1`, [/^[0-9a-f-]{36}$/i.test(s) ? s : null, numero]);
  return r ?? null;
}

// --- Inscripciones del contacto ------------------------------------------------------------------------------------
/** Inscripciones de la temporada en curso en las que el teléfono es el piloto, el pagador o el tutor del piloto. */
export async function inscripcionesDe(telefono) {
  const filas = await consulta(
    `SELECT i.id, i.codigo, i.estado, i.precio_cent, inscripcion_saldo_cent(i.id) AS saldo_cent,
            r.numero, r.fecha::text AS fecha, c.nombre AS circuito, cat.nombre AS categoria,
            pil.nombre AS piloto, (pil.telefono = $1) AS soy_piloto,
            EXISTS (SELECT 1 FROM tutela tu JOIN persona pt ON pt.id = tu.tutor_persona_id
                    WHERE tu.menor_persona_id = pil.id AND pt.telefono = $1) AS soy_tutor
     FROM inscripcion i
     JOIN ronda r ON r.id = i.ronda_id
     JOIN temporada t ON t.id = r.temporada_id AND t.estado IN ('abierta', 'en_curso')
     JOIN circuito c ON c.id = r.circuito_id
     LEFT JOIN categoria cat ON cat.id = i.categoria_id
     JOIN persona pil ON pil.id = i.piloto_persona_id
     JOIN pedido pe ON pe.id = i.pedido_id
     JOIN persona pag ON pag.id = pe.pagador_persona_id
     WHERE pil.telefono = $1 OR pag.telefono = $1
        OR pil.id IN (SELECT tu.menor_persona_id FROM tutela tu JOIN persona pt ON pt.id = tu.tutor_persona_id WHERE pt.telefono = $1)
     ORDER BY r.fecha`, [telefono]);
  const solicitudes = await consulta(
    `SELECT s.codigo, s.metodo_elegido, s.enviada_en, r.numero, r.fecha::text AS fecha, c.nombre AS circuito
     FROM solicitud_inscripcion s
     JOIN ronda r ON r.id = s.ronda_id JOIN circuito c ON c.id = r.circuito_id
     WHERE s.estado = 'enviada' AND (s.pagador_telefono = $1 OR s.piloto_telefono = $1)
     ORDER BY s.enviada_en DESC`, [telefono]);
  return {
    inscripciones: filas.map((f) => ({
      codigo: f.codigo, ronda: `R${f.numero}`, fecha: f.fecha, circuito: f.circuito, categoria: f.categoria,
      piloto: f.piloto, relacion: f.soy_piloto ? 'piloto' : f.soy_tutor ? 'tutor' : 'pagador',
      estado: f.estado, precio_eur: euros(f.precio_cent), pendiente_eur: euros(Math.max(0, f.saldo_cent)),
    })),
    bizum_pendientes: solicitudes.filter((s) => s.metodo_elegido === 'bizum')
      .map((s) => ({ codigo: s.codigo, ronda: `R${s.numero}`, fecha: s.fecha, circuito: s.circuito })),
    // Formulario enviado con tarjeta y sin pago: reserva a medias.
    sin_pagar: solicitudes.filter((s) => s.metodo_elegido !== 'bizum')
      .map((s) => ({ codigo: s.codigo, ronda: `R${s.numero}`, fecha: s.fecha, circuito: s.circuito, metodo: s.metodo_elegido })),
  };
}

/** true si el contacto tiene una plaza reservada o pagada (propia o de su menor) en la temporada en curso. */
export async function tienePlaza(telefono) {
  const { inscripciones } = await inscripcionesDe(telefono);
  return inscripciones.some((i) => ['reservada', 'pagada'].includes(i.estado));
}

/** Enlace de invitación al grupo de pilotos: bot_settings.grupo_invite_code o, si no, el de la temporada. */
export async function enlaceGrupo() {
  const codigo = await ajuste('grupo_invite_code');
  if (codigo) return /^https?:\/\//.test(codigo) ? codigo : `https://chat.whatsapp.com/${codigo}`;
  const [t] = await consulta(
    `SELECT enlace_grupo_whatsapp FROM temporada WHERE estado IN ('abierta', 'en_curso') ORDER BY inicio DESC NULLS LAST LIMIT 1`);
  return t?.enlace_grupo_whatsapp ?? null;
}

// --- Escrituras ----------------------------------------------------------------------------------------------------
/** Crea o actualiza la persona y la oportunidad (lead) del contacto en la temporada en curso. */
export async function registrarLead(contacto, { nombre, interes, ronda_interes, experiencia }) {
  return conTransaccion(async (c) => {
    const t = await uno(c, `SELECT id FROM temporada WHERE estado IN ('abierta', 'en_curso') ORDER BY inicio DESC NULLS LAST LIMIT 1`);
    if (!t) throw new Error('No hay temporada abierta.');
    const persona = await buscarOCrearPersona(c, {
      nombreCompleto: nombre || contacto.display_name || 'Contacto de WhatsApp',
      telefono: contacto.phone_e164, origen: 'alta_manual', creadoPor: 'sistema',
    });
    if (persona.nueva) {
      await c.query(`UPDATE persona SET notas = 'Alta desde el bot de WhatsApp.' WHERE id = $1`, [persona.id]);
      await c.query(`INSERT INTO atribucion (persona_id, canal) VALUES ($1, 'whatsapp')`, [persona.id]);
    }
    await c.query(
      `INSERT INTO oportunidad (persona_id, temporada_id, origen) VALUES ($1, $2, 'alta_manual')
       ON CONFLICT (persona_id, temporada_id) DO NOTHING`, [persona.id, t.id]);
    const op = await uno(c, 'SELECT id, etapa FROM oportunidad WHERE persona_id = $1 AND temporada_id = $2', [persona.id, t.id]);
    if (op.etapa === 'nueva' || ((op.etapa === 'perdida' || op.etapa === 'sin_respuesta') && interes)) {
      await c.query(`UPDATE oportunidad SET etapa = 'contactada' WHERE id = $1`, [op.id]);
    }
    const partes = [interes && `interés: ${interes}`, ronda_interes && `ronda: ${ronda_interes}`, experiencia && `experiencia: ${experiencia}`]
      .filter(Boolean);
    if (partes.length) {
      await c.query(
        `INSERT INTO interaccion (persona_id, oportunidad_id, tipo, resumen, ocurrida_en)
         VALUES ($1, $2, 'whatsapp_entrante', $3, now())`, [persona.id, op.id, `Bot de WhatsApp · ${partes.join(' · ')}`.slice(0, 500)]);
    }
    await c.query('UPDATE wa_contacts SET persona_id = $2, lead_id = $3 WHERE id = $1', [contacto.id, persona.id, op.id]);
    return { persona_id: persona.id, lead_id: op.id, nueva: persona.nueva };
  }, { actor: 'sistema' });
}

/** Añade un consentimiento (nunca se edita: el vigente es el último por contacto y tipo). */
export async function registrarConsentimiento(contacto, { tipo, accion, fuente = 'whatsapp', texto_version, evidencia = null }) {
  const [f] = await consulta(
    `INSERT INTO wa_consents (contact_id, tipo, accion, fuente, otorgado_por, texto_version, evidencia)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [contacto.id, tipo, accion, fuente, contacto.rol === 'tutor' ? 'tutor' : 'titular', texto_version, evidencia]);
  return f.id;
}

/**
 * Baja comercial o total: marca el contacto, registra la revocación en wa_consents y cancela su cola de envíos
 * (la comercial solo corta C1 y C2). Una baja total no se rebaja a comercial.
 */
export async function registrarBaja(contacto, tipo, evidencia = null) {
  const total = tipo === 'total';
  const [c] = await consulta(
    `UPDATE wa_contacts SET baja = CASE WHEN baja = 'total' THEN 'total' ELSE $2 END WHERE id = $1 RETURNING baja`,
    [contacto.id, total ? 'total' : 'comercial']);
  await registrarConsentimiento(contacto, { tipo: 'comercial', accion: 'revoca', texto_version: 'whatsapp-baja-v1', evidencia });
  if (total) await registrarConsentimiento(contacto, { tipo: 'operativo', accion: 'revoca', texto_version: 'whatsapp-baja-v1', evidencia });
  const canceladas = await consulta(
    `UPDATE wa_outbox SET estado = 'cancelado', ultimo_error = 'baja del contacto'
     WHERE contact_id = $1 AND estado IN ('borrador', 'pendiente_confirmacion', 'confirmado')
       AND ($2 OR automatizacion IN ('C1', 'C2'))
     RETURNING id`, [contacto.id, total]);
  return { baja: c.baja, envios_cancelados: canceladas.length };
}

/**
 * Escalado. La conversación pasa a "escalada" y el tema se añade a temas_escalados. Si el tipo silencia, el contacto
 * pasa a modo humano 24 h. Devuelve { nuevo }: false si ese tema ya estaba escalado en esta conversación (no se vuelve
 * a avisar a John).
 */
export async function escalar(contacto, conversacionId, { motivo, resumen, tipo = 'otro', urgencia = 'normal' }) {
  const [antes] = await consulta('SELECT $2 = ANY(temas_escalados) AS repetido FROM wa_conversations WHERE id = $1',
    [conversacionId, tipo]);
  await consulta(
    `UPDATE wa_conversations SET estado = 'escalada', motivo_escalado = $2, resumen = coalesce($3, resumen),
       temas_escalados = CASE WHEN $4 = ANY(temas_escalados) THEN temas_escalados ELSE array_append(temas_escalados, $4) END
     WHERE id = $1`,
    [conversacionId, String(motivo).slice(0, 300), resumen ? String(resumen).slice(0, 2000) : null, tipo]);
  const nuevo = !antes?.repetido;
  if (!silencia({ tipo, urgencia })) return { nuevo, silencia: false };
  await consulta(
    `UPDATE wa_contacts SET modo = 'humano',
       modo_hasta = greatest(coalesce(modo_hasta, now()), now() + make_interval(hours => $2))
     WHERE id = $1`, [contacto.id, MODO_HUMANO_ESCALADO_H]);
  return { nuevo, silencia: true };
}
