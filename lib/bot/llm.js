// Llamadas a Claude con el SDK oficial (@anthropic-ai/sdk). Variable: ANTHROPIC_API_KEY.
// Modelos: BOT_MODEL_CONVERSATION / BOT_MODEL_CLASSIFIER si existen; si no, bot_settings; si no, los de la
// especificación (claude-sonnet-5-5 para conversar, claude-haiku-5-5 para clasificar y resumir).
import Anthropic from '@anthropic-ai/sdk';
import { ajuste } from './datos.js';
import { CLASIFICADOR_TEMA, CLASIFICADOR_URGENCIA, RESUMEN_ESCALADO } from './prompts.js';

export const MODELO_CONVERSACION = 'claude-sonnet-5-5';
export const MODELO_CLASIFICADOR = 'claude-haiku-5-5';

let _cliente;
// Sin reintentos automáticos: el turno tiene un límite de 20 s y el fallo se gestiona con el texto fijo y el escalado.
const cliente = () => (_cliente ??= new Anthropic({ maxRetries: 0 }));

export async function modelos() {
  const conv = process.env.BOT_MODEL_CONVERSATION || (await ajuste('modelo_conversacion').catch(() => null)) || MODELO_CONVERSACION;
  const clas = process.env.BOT_MODEL_CLASSIFIER || (await ajuste('modelo_clasificador').catch(() => null)) || MODELO_CLASIFICADOR;
  return { conversacion: conv, clasificador: clas };
}

/**
 * Interfaz que usa el bucle de turno: crear(params, { signal }) → mensaje de la API.
 * Lleva el reintento en servidor ante un rechazo de seguridad (fallbacks "default"), que en Sonnet 5.5 elige el
 * modelo de respaldo según la categoría del rechazo.
 */
export const llmAnthropic = {
  crear: (params, { signal } = {}) => cliente().beta.messages.create({
    ...params,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  }, { signal }),
};

/** Resumen corto de un escalado para John, con Haiku. Si falla o tarda más de `limiteMs`, devuelve null. */
export async function resumirEscalado({ modelo, conversacion, motivo, limiteMs = 8000 }) {
  try {
    const res = await cliente().messages.create({
      model: modelo,
      max_tokens: 600,
      output_config: { effort: 'low' },
      system: RESUMEN_ESCALADO,
      messages: [{ role: 'user', content: `<conversacion>\n${conversacion}\n</conversacion>\nMotivo del escalado: ${motivo}` }],
    }, { signal: AbortSignal.timeout(limiteMs) });
    if (res.stop_reason === 'refusal') return null;
    return res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim() || null;
  } catch (e) {
    console.warn('resumen escalado', e.message);
    return null;
  }
}

/** Pregunta de sí o no a Haiku, sin razonamiento y con una palabra de salida. Devuelve true, false o null si falla. */
async function siONo({ modelo, system, texto, limiteMs = 5000, siRechaza = false }) {
  try {
    const res = await cliente().messages.create({
      model: modelo,
      max_tokens: 5,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: `<mensaje>\n${String(texto ?? '').slice(0, 1000)}\n</mensaje>` }],
    }, { signal: AbortSignal.timeout(limiteMs) });
    if (res.stop_reason === 'refusal') return siRechaza;
    const t = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (/^s[ií]/i.test(t)) return true;
    if (/^no/i.test(t)) return false;
    return null;
  } catch (e) {
    console.warn('clasificador', e.message);
    return null;
  }
}

/**
 * ¿El mensaje vuelve a tener que ver con RUKC? Se usa solo en conversaciones cortadas por fuera de tema (unos 300
 * tokens de Haiku: una fracción de céntimo cada mil mensajes). null si falla; quien llama lo trata como "sí".
 */
export const esDeRukc = ({ modelo, texto, limiteMs }) => siONo({ modelo, system: CLASIFICADOR_TEMA, texto, limiteMs });

/**
 * ¿El mensaje habla de una urgencia? Se usa mientras la conversación está en manos de John y el bot no contesta, para
 * que una urgencia no se quede sin respuesta. null si falla (se trata como "no": John ya está con esa conversación).
 */
export const esUrgencia = ({ modelo, texto, limiteMs }) => siONo({ modelo, system: CLASIFICADOR_URGENCIA, texto, limiteMs, siRechaza: true });
