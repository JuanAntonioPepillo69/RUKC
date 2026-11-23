// Moderación del grupo de pilotos (petición de John del 23/11/2026).
// El bot no puede leer el grupo (ver lib/whatsapp/grupo.js): revisa los mensajes que John le reenvía desde el grupo o
// pega con "GRUPO: <texto>". Si uno es ofensivo o tiene mala intención, a John le llega un aviso con el motivo y, aparte,
// el mensaje listo para pegar en el grupo: un recordatorio de las normas de convivencia (Art. 55 y 57 del reglamento),
// sin nombrar ni citar a nadie. La pique sana entre pilotos no se marca. Nunca se avisa dos veces por el mismo mensaje.
import { consulta } from '../db.js';
import { limpiarTexto } from '../bot/turn.js';

export const SISTEMA_MODERADOR = `Eres el moderador del grupo de WhatsApp de los pilotos de RUKC (liga de karting de alquiler de Málaga). Revisas un mensaje del grupo que el organizador te ha reenviado y decides si hay que avisar.
Marca como problema solo si el mensaje:
- insulta, humilla o se burla de forma ofensiva de alguien (también de la organización o de un circuito);
- amenaza, acosa o intimida;
- discrimina por origen, género, orientación, religión, edad, peso o aspecto;
- tiene contenido sexual, violento o de mal gusto fuera de lugar;
- comparte datos personales de otra persona (teléfono, dirección, fotos privadas) sin su permiso;
- es spam, una estafa, venta no autorizada o un enlace sospechoso;
- anima a conducir de forma peligrosa, a hacer trampas con el peso o el lastre, o a correr bajo alcohol o drogas;
- difama a la liga o a otra persona con acusaciones falsas o malintencionadas.
No es un problema: la pique sana entre pilotos ("el domingo te paso", "prepárate que voy a por ti"), las bromas sin mala intención, las quejas educadas, las críticas razonadas ni los tacos sueltos sin ir contra nadie.
Responde solo con un objeto JSON, sin nada más:
{"problema": true|false, "gravedad": "baja"|"media"|"alta", "motivo": "una frase para el organizador", "mensaje_grupo": "texto para el grupo"}
- motivo y mensaje_grupo solo si problema es true; si no, cadenas vacías.
- mensaje_grupo: lo publica el organizador en el grupo. Español de España, hablando al grupo (vosotros), firme pero cercano, de 2 a 4 líneas, sin emojis ni markdown. Recuerda la norma que toca, citando el artículo del reglamento de <normas> si encaja. No nombres ni cites a nadie, ni el mensaje: es un recordatorio general. No amenaces con sanciones que no estén en <normas>.`;

/** Normas que se citan en el aviso al grupo: Art. 55 (respeto) y 57 (redes sociales). */
async function normas() {
  const { articulo } = await import('./grupo.js');
  const textos = await Promise.all(['55', '56', '57'].map((n) => articulo(n).catch(() => null)));
  return textos.filter(Boolean).join('\n\n') || 'Respeto entre todas las personas de la liga.';
}

function leerJson(texto) {
  const m = String(texto || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * Revisa un mensaje del grupo. `anteriores`: los mensajes reenviados justo antes, para el contexto.
 * Devuelve { problema, gravedad, motivo, mensaje_grupo } o null si no se ha podido revisar. d: { llm }.
 */
export async function revisarMensaje({ texto, anteriores = [], d = {} }) {
  const { modelos, llmAnthropic } = await import('../bot/llm.js');
  const llm = d.llm ?? llmAnthropic;
  const { conversacion: modelo } = await modelos();
  try {
    const res = await llm.crear({
      model: modelo,
      max_tokens: 600,
      output_config: { effort: 'low' },
      system: SISTEMA_MODERADOR,
      messages: [{ role: 'user', content: `<normas>\n${await normas()}\n</normas>\n<contexto_previo>\n${anteriores.slice(-8).join('\n') || 'ninguno'}\n</contexto_previo>\n<mensaje>\n${String(texto).slice(0, 2000)}\n</mensaje>` }],
    }, { signal: AbortSignal.timeout(30_000), uso: 'admin' });
    if (res.stop_reason === 'refusal') return null;
    const j = leerJson(res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
    if (!j || typeof j.problema !== 'boolean') return null;
    return {
      problema: j.problema,
      gravedad: ['baja', 'media', 'alta'].includes(j.gravedad) ? j.gravedad : 'media',
      motivo: String(j.motivo || '').trim(),
      mensaje_grupo: limpiarTexto(String(j.mensaje_grupo || '')),
    };
  } catch (e) {
    console.warn('moderación', e.message);
    return null;
  }
}

/**
 * Revisa un mensaje reenviado del grupo y, si hace falta, avisa a John con el mensaje listo para el grupo.
 * `responder(texto)` manda un texto a John por el canal admin. Nunca lanza.
 */
export async function moderarReenviado({ texto, conversacionId, responder, d = {} }) {
  try {
    const t = String(texto || '').replace(/^\s*grupo\s*:\s*/i, '').trim();
    if (!t || /^\[El contacto ha enviado/.test(t)) return { revisado: false };
    const previos = await consulta(
      `SELECT cuerpo FROM wa_messages
       WHERE conversation_id = $1 AND autor = 'john_admin' AND direccion = 'entrada' AND created_at > now() - interval '15 minutes'
         AND (raw->'context'->>'forwarded' = 'true' OR raw->'context'->>'frequently_forwarded' = 'true' OR cuerpo ~* '^\\s*grupo\\s*:')
       ORDER BY created_at`, [conversacionId]);
    const anteriores = previos.map((p) => String(p.cuerpo || '').replace(/^\s*grupo\s*:\s*/i, '').trim()).filter((x) => x && x !== t);
    const r = await revisarMensaje({ texto: t, anteriores, d });
    if (!r?.problema) return { revisado: Boolean(r), problema: false };
    const cita = t.length > 300 ? `${t.slice(0, 300)}…` : t;
    await responder([
      `${r.gravedad === 'alta' ? 'URGENTE · ' : ''}Mensaje del grupo con posible problema (gravedad ${r.gravedad}):`,
      `«${cita}»`,
      `Motivo: ${r.motivo || 'sin detallar'}.`,
      r.mensaje_grupo ? 'Si quieres avisar en el grupo, copia el mensaje siguiente y pégalo:' : 'Revísalo tú antes de decir nada en el grupo.',
    ].join('\n'));
    if (r.mensaje_grupo) await responder(r.mensaje_grupo);
    return { revisado: true, problema: true, gravedad: r.gravedad };
  } catch (e) {
    console.error('moderación', e.message);
    return { revisado: false, error: e.message };
  }
}
