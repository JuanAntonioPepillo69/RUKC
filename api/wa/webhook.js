// /api/wa/webhook · avisos de YCloud (WhatsApp).
// 1. Firma YCloud-Signature sobre el cuerpo en bruto, antes de leerlo. Si no valida: 401 y queda en `evento`.
// 2. Idempotencia: cada aviso se guarda en wa_webhook_events por su id; si ya estaba, 200 sin hacer nada más.
// 3. Responde 200 al momento y procesa después con waitUntil (el bot puede tardar hasta ~25 s).
// Eventos que se usan: whatsapp.inbound_message.received, whatsapp.smb.message.echoes y whatsapp.message.updated.
// Variables: YCLOUD_WEBHOOK_SECRET (la da YCloud al crear el endpoint), YCLOUD_API_KEY, YCLOUD_PHONE_E164,
// ADMIN_PHONE_E164, ANTHROPIC_API_KEY y DATABASE_URL.
import { waitUntil } from '@vercel/functions';
import { consulta } from '../../lib/db.js';
import { hashIp, ipCliente, json } from '../../lib/http.js';
import { procesarEvento } from '../../lib/whatsapp/entrante.js';
import { firmaValida } from '../../lib/whatsapp/signature.js';

/** Procesa un aviso ya registrado y deja su resultado en wa_webhook_events. Nunca lanza. */
export async function procesarRegistrado(filaId, evento, deps) {
  try {
    const resultado = await procesarEvento(evento, deps);
    await consulta(
      `UPDATE wa_webhook_events SET estado = 'procesado', procesado_at = now(), error = $2 WHERE id = $1`,
      [filaId, resultado?.nota ?? null]);
    return resultado;
  } catch (e) {
    console.error('wa-webhook', evento.type, e.message);
    await consulta(`UPDATE wa_webhook_events SET estado = 'error', procesado_at = now(), error = $2 WHERE id = $1`,
      [filaId, String(e.message).slice(0, 1000)]).catch(() => {});
    return { error: e.message };
  }
}

/** Manejador con dependencias sustituibles (los tests pasan un simulador de Claude y de YCloud). */
export async function manejar(request, deps) {
  const secreto = process.env.YCLOUD_WEBHOOK_SECRET;
  if (!secreto) return new Response('webhook not configured', { status: 503 });

  const cuerpo = await request.text();
  if (!firmaValida(cuerpo, request.headers.get('ycloud-signature'), secreto)) {
    await consulta(
      `INSERT INTO evento (actor, entidad, accion, despues, ip) VALUES ('ycloud', 'wa_webhook_events', 'firma_invalida', $1, $2)`,
      [JSON.stringify({ bytes: cuerpo.length }), hashIp(ipCliente(request))]).catch(() => {});
    return json({ error: 'firma no válida' }, 401);
  }

  let evento;
  try { evento = JSON.parse(cuerpo); } catch { return json({ error: 'JSON no válido' }, 400); }
  if (!evento?.id || !evento?.type) return json({ error: 'faltan id o type' }, 400);

  let fila;
  try {
    [fila] = await consulta(
      `INSERT INTO wa_webhook_events (provider_event_id, tipo, payload) VALUES ($1, $2, $3)
       ON CONFLICT (provider_event_id) DO NOTHING RETURNING id`, [String(evento.id), String(evento.type), cuerpo]);
  } catch (e) {
    console.error('wa-webhook registro', e.message);
    return json({ error: 'no se pudo guardar' }, 503);   // YCloud lo reintenta
  }
  if (!fila) return json({ recibido: true, duplicado: true });

  const trabajo = procesarRegistrado(fila.id, evento, deps);
  if (deps?.esperar) await trabajo;   // tests: esperar al proceso completo
  else waitUntil(trabajo);
  return json({ recibido: true });
}

export const POST = (request) => manejar(request);
