// Cliente de YCloud para WhatsApp: envío de texto libre y de plantillas, indicador de "escribiendo" y registro de
// cada mensaje saliente en wa_messages (con su estado, que después actualizan los avisos whatsapp.message.updated).
// API: https://api.ycloud.com/v2 con la cabecera X-API-Key. Variables: YCLOUD_API_KEY y YCLOUD_PHONE_E164.
import { consulta } from '../db.js';

const BASE = 'https://api.ycloud.com/v2';
const TIEMPO_MAX_MS = 10_000;

// Estados de YCloud → estados de wa_messages.
const ESTADOS = { accepted: 'aceptado', sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido' };
const ORDEN = ['aceptado', 'enviado', 'entregado', 'leido'];
export const estadoLocal = (s) => ESTADOS[String(s || '').toLowerCase()] ?? null;

function configuracion() {
  const clave = process.env.YCLOUD_API_KEY;
  const desde = process.env.YCLOUD_PHONE_E164;
  if (!clave || !desde) throw Object.assign(new Error('Faltan YCLOUD_API_KEY o YCLOUD_PHONE_E164'), { codigo: 'sin_configurar' });
  return { clave, desde };
}

async function llamar(ruta, cuerpo) {
  const { clave } = configuracion();
  const r = await fetch(`${BASE}${ruta}`, {
    method: 'POST',
    headers: { 'X-API-Key': clave, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(TIEMPO_MAX_MS),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`YCloud ${ruta}: ${r.status} ${json?.error?.message || json?.message || ''}`.trim());
    e.status = r.status;
    e.respuesta = json;
    throw e;
  }
  return json;
}

/** Marca como leído el mensaje entrante y enseña "escribiendo…" (se quita al responder o a los 25 s). No lanza. */
export async function escribiendo(idEntrante) {
  if (!idEntrante) return false;
  try {
    await llamar(`/whatsapp/inboundMessages/${encodeURIComponent(idEntrante)}/typing`);
    return true;
  } catch (e) {
    console.warn('ycloud typing', e.message);
    return false;
  }
}

/**
 * Envía un mensaje (texto, imagen o plantilla) y lo registra en wa_messages. Nunca lanza por un fallo de envío: el mensaje
 * queda con estado "fallido" y su error, y se devuelve { ok: false }.
 * - contacto: fila de wa_contacts (id y phone_e164).
 * - texto, imagen ({ link, caption }: YCloud descarga la imagen del enlace) o plantilla ({ name, language, components }
 *   de templates.js).
 * - autor: bot · john_admin · sistema.  externalId: clave propia para conciliar (opcional).
 */
export async function enviar({ contacto, conversacionId = null, texto, imagen, plantilla, autor = 'bot', responderA, externalId }) {
  const { desde } = configuracion();
  const cuerpo = { from: desde, to: contacto.phone_e164 };
  if (plantilla) Object.assign(cuerpo, { type: 'template', template: plantilla });
  else if (imagen) Object.assign(cuerpo, { type: 'image', image: { link: imagen.link, ...(imagen.caption ? { caption: imagen.caption } : {}) } });
  else Object.assign(cuerpo, { type: 'text', text: { body: texto, preview_url: false } });
  if (responderA) cuerpo.context = { message_id: responderA };
  if (externalId) cuerpo.externalId = externalId;

  let respuesta = null;
  let error = null;
  try {
    respuesta = await llamar('/whatsapp/messages/sendDirectly', cuerpo);
  } catch (e) {
    error = e;
    console.error('ycloud enviar', e.message);
  }
  const estado = error ? 'fallido' : (estadoLocal(respuesta?.status) ?? 'aceptado');
  const [fila] = await consulta(
    `INSERT INTO wa_messages (conversation_id, contact_id, direccion, autor, tipo, plantilla, cuerpo,
       provider_message_id, wamid, estado, error_code, categoria_precio, raw)
     VALUES ($1, $2, 'salida', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (provider_message_id) DO UPDATE SET estado = EXCLUDED.estado
     RETURNING id`,
    [conversacionId, contacto.id, autor, plantilla ? 'plantilla' : imagen ? 'media' : 'texto', plantilla?.name ?? null,
      plantilla ? JSON.stringify(plantilla.components) : imagen ? `[Imagen] ${imagen.caption ?? ''}`.trim() : texto,
      respuesta?.id ?? null, respuesta?.wamid ?? null, estado,
      error ? String(respuesta?.errorCode ?? error.respuesta?.error?.code ?? error.status ?? 'error') : (respuesta?.errorCode ?? null),
      respuesta?.pricingCategory ?? null,
      JSON.stringify(respuesta ?? { error: error?.message, respuesta: error?.respuesta ?? null })]);
  return { ok: !error && estado !== 'fallido', id: fila.id, providerId: respuesta?.id ?? null, wamid: respuesta?.wamid ?? null, error: error?.message };
}

/**
 * Aplica un aviso whatsapp.message.updated a wa_messages. El estado solo avanza (aceptado → enviado → entregado →
 * leído), salvo "fallido", que siempre se registra. Devuelve true si encontró el mensaje.
 */
export async function actualizarEstado(m) {
  const estado = estadoLocal(m?.status);
  if (!estado || (!m.id && !m.wamid)) return false;
  const filas = await consulta(
    `UPDATE wa_messages SET
       estado = CASE WHEN $3 = 'fallido' THEN 'fallido'
                     WHEN estado = 'fallido' THEN estado
                     WHEN coalesce(array_position($4::text[], $3), 0) > coalesce(array_position($4::text[], estado), 0) THEN $3
                     ELSE estado END,
       wamid = coalesce(wamid, $2),
       error_code = coalesce($5, error_code),
       categoria_precio = coalesce($6, categoria_precio),
       facturable = coalesce($7, facturable)
     WHERE direccion = 'salida' AND (provider_message_id = $1 OR ($2::text IS NOT NULL AND wamid = $2))
     RETURNING id`,
    [m.id ?? null, m.wamid ?? null, estado, ORDEN, m.errorCode != null ? String(m.errorCode) : null, m.pricingCategory ?? null,
      m.totalPrice != null ? Number(m.totalPrice) > 0 : null]);
  return filas.length > 0;
}
