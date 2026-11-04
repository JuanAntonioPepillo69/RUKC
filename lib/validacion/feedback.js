// Validación del feedback post-carrera (F6): plantillas del panel y respuestas del piloto.
import { z } from 'zod';

export const TIPOS = ['escala_0_10', 'escala_1_5', 'opcion_unica', 'opcion_multiple', 'texto'];
const CON_OPCIONES = ['opcion_unica', 'opcion_multiple'];

const pregunta = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, 'El identificador de cada pregunta: minúsculas, números y _ (por ejemplo, nota_general).'),
  tipo: z.enum(TIPOS),
  texto: z.string().trim().min(3, 'Escribe el texto de cada pregunta.').max(300),
  obligatoria: z.boolean(),
  opciones: z.array(z.string().trim().min(1).max(120)).max(20).optional().nullable(),
}).strict().superRefine((p, ctx) => {
  const con = CON_OPCIONES.includes(p.tipo);
  if (con && (p.opciones?.length ?? 0) < 2) ctx.addIssue({ code: 'custom', message: `La pregunta «${p.id}» necesita al menos 2 opciones.` });
  if (con && new Set(p.opciones).size !== p.opciones.length) ctx.addIssue({ code: 'custom', message: `La pregunta «${p.id}» tiene opciones repetidas.` });
  if (!con && p.opciones?.length) ctx.addIssue({ code: 'custom', message: `La pregunta «${p.id}» no lleva opciones.` });
}).transform((p) => ({ ...p, opciones: CON_OPCIONES.includes(p.tipo) ? p.opciones : undefined }));

const version = z.string().trim().regex(/^[\w.-]{1,30}$/, 'La versión: letras, números, punto, guion o _ (por ejemplo, v2).');

const preguntas = z.array(pregunta).max(30).superRefine((ps, ctx) => {
  const ids = ps.map((p) => p.id);
  const repetido = ids.find((id, i) => ids.indexOf(id) !== i);
  if (repetido) ctx.addIssue({ code: 'custom', message: `El identificador «${repetido}» está repetido.` });
});

export const plantilla = z.object({ version, preguntas }).strict();
export const duplicar = z.object({ version }).strict();

/** Filtro de la pantalla Feedback: una pregunta, un operador y un valor. */
export const filtro = z.object({
  pregunta: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
  op: z.enum(['lt', 'lte', 'eq', 'gte', 'gt', 'contiene']),
  valor: z.string().trim().min(1).max(120),
});

/**
 * Comprueba las respuestas del piloto contra las preguntas de su plantilla. Devuelve las filas de respuesta_feedback
 * ({ pregunta_id, valor_num, valor_texto, valor_opciones }) o lanza un error con status 400 y la pregunta que falla.
 */
export function validarRespuestas(preguntasPlantilla, respuestas) {
  if (!respuestas || typeof respuestas !== 'object' || Array.isArray(respuestas)) throw Object.assign(new Error('Revisa las respuestas.'), { status: 400 });
  const err = (p, m) => Object.assign(new Error(m), { status: 400, campo: p.id });
  const desconocida = Object.keys(respuestas).find((k) => !preguntasPlantilla.some((p) => p.id === k));
  if (desconocida) throw Object.assign(new Error('Revisa las respuestas.'), { status: 400 });
  const filas = [];
  for (const p of preguntasPlantilla) {
    let v = respuestas[p.id];
    if (typeof v === 'string') v = v.trim();
    const vacia = v == null || v === '' || (Array.isArray(v) && !v.length);
    if (vacia) { if (p.obligatoria) throw err(p, `Responde: «${p.texto}»`); continue; }
    const fila = { pregunta_id: p.id, valor_num: null, valor_texto: null, valor_opciones: null };
    if (p.tipo === 'escala_0_10' || p.tipo === 'escala_1_5') {
      const [min, max] = p.tipo === 'escala_0_10' ? [0, 10] : [1, 5];
      if (!Number.isInteger(v) || v < min || v > max) throw err(p, `Elige un número del ${min} al ${max} en «${p.texto}»`);
      fila.valor_num = v;
    } else if (p.tipo === 'opcion_unica') {
      if (!p.opciones.includes(v)) throw err(p, `Elige una opción en «${p.texto}»`);
      fila.valor_texto = v;
    } else if (p.tipo === 'opcion_multiple') {
      if (!Array.isArray(v) || !v.every((x) => p.opciones.includes(x)) || new Set(v).size !== v.length) throw err(p, `Revisa las opciones de «${p.texto}»`);
      fila.valor_opciones = v;
    } else {
      if (typeof v !== 'string' || v.length > 2000) throw err(p, `La respuesta a «${p.texto}» es demasiado larga (máximo 2000 caracteres).`);
      fila.valor_texto = v;
    }
    filas.push(fila);
  }
  return filas;
}
