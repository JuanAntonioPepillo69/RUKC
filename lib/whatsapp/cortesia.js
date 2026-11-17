// Mensajes de cortesía y reacciones: no necesitan respuesta del bot.
// Problema visto del 12 al 16/11: el bot contestaba a cada "ok", "gracias", "perfecto", emoji suelto o reacción con
// otro mensaje ("Veo tu reacción, Victor…", "Gracias, Sergio. Nos vemos en pista."), en bucle mientras el contacto
// siguiera despidiéndose. Y cuando el "ok" o el 👍 era la respuesta al recordatorio de una semana (D1), no se anotaba
// como confirmación.
// Reglas:
// - Reacción (👍 en un mensaje): nunca se contesta. Si es positiva y va sobre el D1 sin responder, se anota que va.
// - Cortesía ("ok", "vale, gracias", "allí nos vemos", un emoji): si lo último que recibió el contacto es el D1 sin
//   responder, se anota que va y se contesta el mismo texto fijo que al botón «Confirmo asistencia». Si no, y lo último
//   que le dijimos no le pedía nada (sin pregunta ni oferta), no se contesta.
// - Si entre los mensajes sin contestar hay alguno que no es cortesía (una pregunta), contesta el bot como siempre.
import { consulta } from '../db.js';
import { EMOJI } from '../bot/turn.js';

const uno = async (t, p) => (await consulta(t, p))[0] ?? null;

// Palabras que, solas o combinadas, son un acuse o una despedida. Sin saludos ("hola", "buenas"): un saludo puede ser
// el principio de una duda.
const PALABRAS = new Set(`
ok oki okis okey okei okay okeys okeis okk vale perfecto perfecta perfect genial gracias grax graciass muchas muchisimas mil
de acuerdo entendido entendida recibido recibida alli alla ahi nos vemos vemo hasta el la los luego pronto igualmente
saludos saludo un abrazo abrazos estupendo guay top si claro hecho nada mas listo apuntado apuntada crack fiera a ti
vosotros tambien bien muy todo correcto eso es super fenomenal ideal sale va dale y ya lo se pues estaremos estare
en pista domingo sabado finde ninguna duda dudas por ahora momento de nuevo tranqui tranquilo genio maquina jefe
circuito carrera ronda karting campillos mijas malaga dia semana que vaya
`.trim().split(/\s+/));

const normalizar = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(EMOJI, ' ').replace(/[^a-zñ\s]/g, ' ').replace(/(.)\1{2,}/g, '$1').trim();

/** true si el texto es solo un acuse, un agradecimiento, una despedida o emojis. */
export function esCortesia(texto) {
  const t = String(texto || '').trim();
  if (!t || t.length > 80 || /\?/.test(t)) return false;
  const palabras = normalizar(t).split(/\s+/).filter(Boolean);
  if (!palabras.length) return /\p{Extended_Pictographic}/u.test(t); // solo emojis
  return palabras.length <= 10 && palabras.every((p) => PALABRAS.has(p) || PALABRAS.has(p.replace(/s$/, '')));
}

const REACCIONES_SI = /^(\u{1F44D}|\u{1F44C}|\u{2705}|\u{2714}|\u{2764}|\u{1F4AA}|\u{1F525}|\u{1F44F}|\u{1F64C}|\u{1F60E}|\u{1F3CE}|\u{1F3C1}|\u{1F60D}|\u{1F970}|\u{1F600}|\u{1F601}|\u{1F603}|\u{1F604}|\u{1F642}|\u{1F60A}|\u{1F64F})/u;
/** ¿La reacción dice que sí (pulgar, ok, check, corazón…)? */
export const reaccionPositiva = (emoji) => REACCIONES_SI.test(String(emoji || ''));

// Lo último que le dijimos le pide algo: una pregunta o una oferta ("si quieres te paso con el equipo").
const PIDE_ALGO = /\?\s*$|\?[^?]{0,40}$|si quieres|quieres que|te paso con|te lo paso|dime si|av[ií]same si|me dices si/i;

/** Último mensaje que hemos mandado al contacto en la conversación (bot, sistema o John), sin los fallidos. */
async function ultimaSalida(conversacionId) {
  return uno(
    `SELECT id, autor, tipo, plantilla, cuerpo, wamid, provider_message_id, created_at FROM wa_messages
     WHERE conversation_id = $1 AND direccion = 'salida' AND estado IS DISTINCT FROM 'fallido'
     ORDER BY created_at DESC LIMIT 1`, [conversacionId]);
}

/** D1 enviado a este contacto en los últimos 8 días, de una ronda que aún no se ha corrido y sin respuesta anotada. */
export async function d1SinRespuesta(contacto) {
  return uno(
    `SELECT o.id, r.numero FROM wa_outbox o JOIN ronda r ON r.id = o.ronda_id
     WHERE o.contact_id = $1 AND o.automatizacion = 'D1' AND o.estado = 'enviado' AND NOT (o.variables ? 'respuesta')
       AND o.updated_at > now() - interval '8 days' AND r.fecha >= (now() AT TIME ZONE 'Europe/Madrid')::date
     ORDER BY o.updated_at DESC LIMIT 1`, [contacto.id]);
}

/**
 * Qué hacer con lo que el contacto ha escrito y nadie ha contestado:
 * - 'responder': hay algo que no es cortesía, o lo último que le dijimos le pedía algo, o es su primer mensaje.
 * - 'confirma_d1': todo es cortesía y lo último que recibió es el recordatorio de una semana, sin responder.
 * - 'callar': todo es cortesía y no hay nada que contestar.
 */
export async function decidirCortesia(contacto, conversacionId) {
  const salida = await ultimaSalida(conversacionId);
  if (!salida) return { accion: 'responder' };
  const sinContestar = await consulta(
    `SELECT tipo, cuerpo, raw->>'type' AS tipo_wa FROM wa_messages
     WHERE conversation_id = $1 AND direccion = 'entrada' AND created_at > $2 ORDER BY created_at`, [conversacionId, salida.created_at]);
  if (!sinContestar.length) return { accion: 'callar' };
  const cortesia = sinContestar.every((m) => m.tipo_wa === 'reaction' || (m.tipo === 'texto' && esCortesia(m.cuerpo)));
  if (!cortesia) return { accion: 'responder' };
  if (salida.plantilla === 'rukc_recordatorio_semana' && await d1SinRespuesta(contacto)) {
    return { accion: 'confirma_d1', cita: sinContestar.map((m) => m.cuerpo).join(' ').slice(0, 300) };
  }
  if (salida.tipo !== 'plantilla' && PIDE_ALGO.test(String(salida.cuerpo || '').trim())) return { accion: 'responder' };
  return { accion: 'callar' };
}

/** Reacción a un mensaje: ¿va sobre el D1 de este contacto? (por el wamid del mensaje al que reacciona). */
export async function reaccionAlD1(contacto, wamidReaccionado) {
  if (!wamidReaccionado) return false;
  return Boolean(await uno(
    `SELECT 1 FROM wa_messages WHERE contact_id = $1 AND direccion = 'salida' AND plantilla = 'rukc_recordatorio_semana'
       AND (wamid = $2 OR provider_message_id = $2) LIMIT 1`, [contacto.id, wamidReaccionado]));
}
