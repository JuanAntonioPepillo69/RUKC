// Llamadas a Claude con el SDK oficial (@anthropic-ai/sdk). Variable: ANTHROPIC_API_KEY.
// Modelos: BOT_MODEL_CONVERSATION / BOT_MODEL_CLASSIFIER si existen; si no, bot_settings; si no, los de la
// especificación (claude-sonnet-5-5 para conversar, claude-haiku-5-5 para clasificar y resumir).
import Anthropic from '@anthropic-ai/sdk';
import { ajuste } from './datos.js';
import { RESUMEN_ESCALADO } from './prompts.js';

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
