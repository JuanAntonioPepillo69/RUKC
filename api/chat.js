// POST /api/chat · Chat de la web con el asistente de RUKC (lib/bot/web.js).
// Cuerpo: { mensajes: [{ rol: 'user' | 'assistant', texto }] } (el historial lo guarda el navegador; RUKC no guarda la
// conversación). Respuesta: { texto, whatsapp (enlace o null), ft }.
// Protecciones: solo desde nuestra web (Origin), 12 mensajes cada 10 minutos y 60 al día por IP (se guarda un hash, no
// la IP), un tope global para todas las IPs juntas (CHAT_WEB_MAX_10MIN y CHAT_WEB_MAX_DIA; tope de gasto en Claude
// aunque el abuso llegue desde muchas IPs) y el interruptor general del bot (PARA TODO también apaga el chat web).
import { consulta } from '../lib/db.js';
import { dentroDelLimite, dentroDelLimiteGlobal, json, leerJson, origenValido } from '../lib/http.js';
import * as datosBot from '../lib/bot/datos.js';
import { llmAnthropic, modelos } from '../lib/bot/llm.js';
import { TEXTO_APAGADO_WEB, enlaceWhatsapp, historialDe, turnoWeb } from '../lib/bot/web.js';

const db = { query: async (texto, params) => ({ rows: await consulta(texto, params) }) };
const PREDETERMINADAS = { llm: llmAnthropic, datos: datosBot };
const tope = (nombre, porDefecto) => {
  const n = Number(process.env[nombre]);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
};
const TEXTO_OCUPADO = 'El chat está muy solicitado ahora mismo. Escríbenos por WhatsApp y te contestamos.';

export async function manejar(request, deps = {}) {
  const d = { ...PREDETERMINADAS, ...deps };
  if (!origenValido(request)) return json({ error: 'Origen no permitido.' }, 403);
  const cuerpo = await leerJson(request);
  const { historial, error } = historialDe(cuerpo?.mensajes);
  if (error) return json({ error }, 400);
  try {
    if (!(await dentroDelLimite(db, request, 'chat', 12, 10)) || !(await dentroDelLimite(db, request, 'chat-dia', 60, 1440))) {
      return json({ error: 'Has escrito muchos mensajes seguidos. Espera unos minutos o escríbenos por WhatsApp.', whatsapp: enlaceWhatsapp('Tenía una duda en el chat de la web.') }, 429);
    }
    // Después del límite por IP, para que una sola IP insistente no gaste el cupo de todos.
    if (!(await dentroDelLimiteGlobal(db, 'chat', tope('CHAT_WEB_MAX_10MIN', 60), 10))
      || !(await dentroDelLimiteGlobal(db, 'chat-dia', tope('CHAT_WEB_MAX_DIA', 400), 1440))) {
      return json({ error: TEXTO_OCUPADO, whatsapp: enlaceWhatsapp('Tenía una duda en el chat de la web.') }, 429);
    }
    if (!(await d.datos.botActivo())) return json({ texto: TEXTO_APAGADO_WEB, whatsapp: enlaceWhatsapp(''), ft: false });
    const modelo = d.modelo ?? (await modelos()).conversacion;
    const res = await turnoWeb(historial, { ...d, modelo });
    return json({ texto: res.texto, whatsapp: res.whatsapp, ft: res.ft });
  } catch (e) {
    console.error('chat web', e.message);
    return json({ error: 'No he podido responder ahora mismo. Inténtalo en un momento o escríbenos por WhatsApp.', whatsapp: enlaceWhatsapp('Tenía una duda en el chat de la web.') }, 503);
  }
}

export const POST = (request) => manejar(request);
