// Motor del feedback anónimo: qué bloques y preguntas se ven, qué falta y qué se guarda. Lo usan igual el navegador
// (src/scripts/feedback-anonimo.ts) y el servidor (api/feedback-anonimo.js), para que las condiciones se validen en
// los dos sitios con la misma lógica. Estructura de las preguntas: src/config/feedback/preguntas.js.
//
// Condiciones (`si`):
//   { p: 'C1', en: ['primera'] }   la respuesta a C1 es una de esas (en las múltiples: alguna de las marcadas)
//   { p: 'C7', no: ['no_lastre'] } C7 no tiene ninguna de esas (sin responder también cuenta)
//   { p: 'C6', max: 3 }            la nota de C6 es 3 o menos (sin responder no cuenta)
//   { cfg: 'modulo', en | no | es } sobre la configuración de la ronda
//   { y: [...] } / { o: [...] }    todas / alguna
import { BANCO_VERSION, BLOQUES, PREGUNTAS } from '../../src/config/feedback/preguntas.js';

export const MAX_TEXTO = 2000;
export const MAX_OTRO = 200;

export const formVersion = (ronda) => `${BANCO_VERSION}-${ronda.modulo}`;

const vacio = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

export function cumple(cond, respuestas, ronda) {
  if (!cond) return true;
  if (cond.y) return cond.y.every((c) => cumple(c, respuestas, ronda));
  if (cond.o) return cond.o.some((c) => cumple(c, respuestas, ronda));
  const v = cond.cfg ? ronda[cond.cfg] : respuestas[cond.p];
  if ('es' in cond) return v === cond.es;
  if ('max' in cond) return typeof v === 'number' && v <= cond.max;
  const valores = Array.isArray(v) ? v : vacio(v) ? [] : [v];
  if (cond.en) return valores.some((x) => cond.en.includes(x));
  if (cond.no) return !valores.some((x) => cond.no.includes(x));
  return true;
}

/** true si la condición solo mira la configuración de la ronda (no respuestas). */
const soloConfig = (c) => !c || (c.y ?? c.o)?.every(soloConfig) || (c.cfg !== undefined && !c.p);

/**
 * Bloques de la ronda (sin los de otros módulos), con cada pregunta como { id, si } de ese bloque. Las preguntas cuya
 * condición en el bloque solo depende de la configuración y no se cumple (M1.1 a M1.3 en el bloque de primera carrera
 * de la R2) se quitan.
 */
export function bloquesDe(ronda) {
  return BLOQUES.filter((b) => !b.modulo || b.modulo === ronda.modulo)
    .map((b) => ({ ...b, preguntas: b.preguntas.map((x) => (typeof x === 'string' ? { id: x } : x))
      .filter((x) => !x.si || !soloConfig(x.si) || cumple(x.si, {}, ronda)) }));
}

/** Ids que se pueden recibir: las preguntas del banco y los campos `<id>_otro`. */
export const idsValidos = () => new Set(Object.entries(PREGUNTAS).flatMap(([id, p]) => (p.otro ? [id, `${id}_otro`] : [id])));

/** Comprueba el valor de una pregunta. Devuelve el valor normalizado, undefined si va vacío, o lanza un mensaje. */
function normalizar(p, v) {
  if (typeof v === 'string') v = v.trim();
  if (vacio(v)) return undefined;
  switch (p.tipo) {
    case 'unica':
      if (!p.opciones.includes(v)) throw new Error('opcion');
      return v;
    case 'multiple': {
      if (!Array.isArray(v) || !v.every((x) => p.opciones.includes(x)) || new Set(v).size !== v.length) throw new Error('opcion');
      if (p.max && v.length > p.max) throw new Error('max');
      if (p.exclusiva && v.includes(p.exclusiva) && v.length > 1) throw new Error('exclusiva');
      return p.opciones.filter((o) => v.includes(o));   // en el orden del banco, no en el que se mostró
    }
    case 'escala':
      if (!Number.isInteger(v) || v < p.escala[0] || v > p.escala[1]) throw new Error('escala');
      return v;
    default:
      if (typeof v !== 'string' || v.length > MAX_TEXTO) throw new Error('texto');
      return v;
  }
}

/**
 * Recorre los bloques en orden con las respuestas dadas. Devuelve:
 *   bloques   [{ id, preguntas: [ids visibles] }] solo los bloques que se ven y tienen alguna pregunta visible
 *   visibles  Set de ids visibles (incluye los `<id>_otro` que se ven)
 *   limpias   lo que se guardaría: solo preguntas visibles con respuesta válida, más las automáticas
 *   faltan    ids visibles obligatorios sin responder
 *   errores   { id: motivo } de valores no válidos
 */
export function evaluar(ronda, respuestas = {}) {
  const limpias = {};
  const visibles = new Set();
  const faltan = [];
  const errores = {};
  const bloques = [];
  const vistos = new Set();
  for (const b of bloquesDe(ronda)) {
    if (!cumple(b.si, limpias, ronda)) continue;
    const ids = [];
    for (const { id, si } of b.preguntas) {
      if (vistos.has(id)) continue;
      const p = PREGUNTAS[id];
      if (!cumple(si, limpias, ronda) || !cumple(p.si, limpias, ronda)) continue;
      vistos.add(id);
      if (p.auto && cumple(p.auto.si, limpias, ronda)) { limpias[id] = p.auto.valor; continue; }
      visibles.add(id);
      ids.push(id);
      let v;
      try { v = normalizar(p, respuestas[id]); } catch (e) { errores[id] = e.message; }
      if (v === undefined) { if (p.tipo !== 'texto' && !errores[id]) faltan.push(id); continue; }
      limpias[id] = v;
      if (p.otro && (Array.isArray(v) ? v.includes('otro') : v === 'otro')) {
        const idOtro = `${id}_otro`;
        visibles.add(idOtro);
        const t = typeof respuestas[idOtro] === 'string' ? respuestas[idOtro].trim() : respuestas[idOtro];
        if (!vacio(t)) {
          if (typeof t !== 'string' || t.length > MAX_OTRO) errores[idOtro] = 'texto';
          else limpias[idOtro] = t;
        }
      }
    }
    if (ids.length) bloques.push({ id: b.id, preguntas: ids });
  }
  return { bloques, visibles, limpias, faltan, errores };
}

/**
 * Validación del servidor: claves desconocidas o valores no válidos → error 400; preguntas ocultas → se descartan;
 * obligatorias visibles sin responder → error 400 con la primera que falta. Devuelve el objeto `answers` que se guarda.
 */
export function validar(ronda, respuestas) {
  const fallo = (campo) => Object.assign(new Error('Revisa las respuestas.'), { status: 400, campo });
  if (!respuestas || typeof respuestas !== 'object' || Array.isArray(respuestas)) throw fallo(null);
  const validos = idsValidos();
  if (Object.keys(respuestas).some((k) => !validos.has(k))) throw fallo(null);
  const r = evaluar(ronda, respuestas);
  const conError = Object.keys(r.errores)[0];
  if (conError) throw fallo(conError);
  if (r.faltan.length) throw Object.assign(new Error('Falta responder alguna pregunta.'), { status: 400, campo: r.faltan[0] });
  return r.limpias;
}
