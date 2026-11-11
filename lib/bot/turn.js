// Bucle de turno del bot: una respuesta de texto a partir del historial, con las herramientas del canal.
// Sin dependencias de WhatsApp: recibe el historial ya montado y devuelve el texto que hay que enviar.
// Reglas de la especificación (3a, 3d y nota de la fase 1):
// - Máximo 4 llamadas a herramientas por turno. Si se supera: texto fijo de fallo y escalado.
// - Si Claude no responde en 20 s (todo el turno): texto fijo de fallo y escalado.
// - Una sola respuesta por turno, sin emojis ni markdown (se limpian aquí aunque el modelo los ponga).
// - Si el aviso de IA está pendiente y el modelo no lo ha incluido, se antepone el texto fijo del aviso.
// Las respuestas de Claude se añaden tal cual al historial del turno (incluidos sus bloques de razonamiento);
// entre turnos solo se guarda el texto.
import { DEFINICIONES, ejecutarHerramienta } from './tools.js';

export const LIMITE_MS = 20_000;
export const MAX_HERRAMIENTAS = 4;
export const TEXTO_FALLO = 'Ahora mismo no puedo contestarte bien, se lo paso a John.';
export const AVISO_IA = 'Te escribe el asistente automático de RUKC; si prefieres hablar con John, dímelo y te lo paso.';

// Emojis y pictogramas (incluye banderas, selectores de variante y uniones).
export const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

export const llevaAvisoIa = (texto) => /asistente autom[aá]tico/i.test(texto);

/** Quita emojis y marcas de markdown; deja saltos de línea simples. */
export function limpiarTexto(texto) {
  return String(texto || '')
    .replace(EMOJI, '')
    .replace(/\*\*|__/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, 4000);
}

const textoDe = (contenido) => contenido.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

/**
 * Ejecuta un turno.
 * - llm: { crear(params, { signal }) } (lib/bot/llm.js o un simulador en los tests).
 * - system: bloques de prompts.systemPublico. historial: MessageParam[] que termina en un mensaje del usuario.
 * - ctx: contexto de las herramientas ({ contacto, conversacionId, mensajeId, datos }); escalar_a_john deja ctx.escalado.
 * - avisoIaPendiente: si hay que garantizar el aviso de IA en esta respuesta.
 * Devuelve { ok, texto, textoModelo (antes de limpiar), fallo, llamadas, escalado, uso, ms }.
 */
export async function ejecutarTurno({
  llm, modelo, system, historial, ctx, avisoIaPendiente = false,
  definiciones = DEFINICIONES, ejecutar = ejecutarHerramienta,
  limiteMs = LIMITE_MS, maxHerramientas = MAX_HERRAMIENTAS, effort = 'low',
}) {
  const inicio = Date.now();
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), limiteMs);
  // El límite vale aunque la llamada no atienda la señal de cancelación.
  const agotado = new Promise((_, rechazar) => control.signal.addEventListener('abort', () => rechazar(new Error('tiempo agotado')), { once: true }));
  agotado.catch(() => {});
  const mensajes = [...historial];
  const llamadas = [];
  const uso = { entrada: 0, salida: 0, cache_lectura: 0, cache_escritura: 0, peticiones: 0 };
  let fallo = null;
  let texto = '';

  try {
    for (;;) {
      const res = await Promise.race([llm.crear({
        model: modelo,
        max_tokens: 4000,
        output_config: { effort },
        system,
        tools: definiciones,
        messages: mensajes,
      }, { signal: control.signal }), agotado]);
      uso.peticiones += 1;
      uso.entrada += res.usage?.input_tokens ?? 0;
      uso.salida += res.usage?.output_tokens ?? 0;
      uso.cache_lectura += res.usage?.cache_read_input_tokens ?? 0;
      uso.cache_escritura += res.usage?.cache_creation_input_tokens ?? 0;

      if (res.stop_reason === 'refusal') { fallo = 'rechazo'; break; }
      const usos = res.content.filter((b) => b.type === 'tool_use');
      if (res.stop_reason === 'tool_use' && usos.length) {
        if (llamadas.length + usos.length > maxHerramientas) { fallo = 'herramientas'; break; }
        mensajes.push({ role: 'assistant', content: res.content });
        const resultados = [];
        for (const u of usos) {
          const salida = await ejecutar(u.name, u.input, ctx);
          llamadas.push({ nombre: u.name, entrada: u.input, salida });
          resultados.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(salida), is_error: salida?.status === 'error' });
        }
        mensajes.push({ role: 'user', content: resultados });
        if (control.signal.aborted) { fallo = 'tiempo'; break; }
        continue;
      }
      texto = textoDe(res.content);
      if (!texto) fallo = 'vacio';
      break;
    }
  } catch (e) {
    fallo = control.signal.aborted ? 'tiempo' : 'error';
    if (fallo === 'error') console.error('turno', e?.status ?? '', e?.message);
  } finally {
    clearTimeout(reloj);
  }

  const textoModelo = texto;
  if (fallo) {
    texto = TEXTO_FALLO;
    if (!ctx.escalado) {
      const motivo = `el bot no ha podido responder (${fallo})`;
      try {
        await ctx.datos.escalar(ctx.contacto, ctx.conversacionId, { motivo, resumen: null, urgencia: 'normal' });
      } catch (e) {
        console.error('escalado por fallo', e.message);
      }
      ctx.escalado = { motivo, resumen: null, urgencia: 'normal' };
    }
  }
  texto = limpiarTexto(texto) || TEXTO_FALLO;
  if (avisoIaPendiente && !llevaAvisoIa(texto)) texto = `${AVISO_IA} ${texto}`;

  return { ok: !fallo, texto, textoModelo, fallo, llamadas, escalado: ctx.escalado ?? null, uso, ms: Date.now() - inicio };
}
