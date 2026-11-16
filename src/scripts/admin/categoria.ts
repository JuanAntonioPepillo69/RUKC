// Selector de categoría de una inscripción (Inscripciones y ficha de la persona): se cambia en la propia celda,
// con confirmación, y se recarga la lista al terminar.
import { accion, api, h } from './api';

const NOMBRES: Record<string, string> = { '': 'Sin categoría', LIG: 'Ligeros', PES: 'Pesados' };
const ACTIVAS = ['pendiente_pago', 'reservada', 'pagada'];

export function selectorCategoria(i: { id: string; codigo: string; categoria?: string | null; estado?: string; piloto?: string }, recargar: () => void): Node {
  const actual = i.categoria ?? '';
  if (i.estado && !ACTIVAS.includes(i.estado)) return document.createTextNode(NOMBRES[actual] ?? actual);
  const sel = h('select', { class: 'ctrl ctrl--cat', 'aria-label': `Categoría de ${i.codigo}`, onclick: (e: Event) => e.stopPropagation(),
    onchange: async (e: Event) => {
      const nueva = (e.target as HTMLSelectElement).value;
      const quien = i.piloto ? `${i.piloto} (${i.codigo})` : i.codigo;
      if (!confirm(`¿Pasar ${quien} a ${NOMBRES[nueva]}?`)) { (e.target as HTMLSelectElement).value = actual; return; }
      if (await accion(() => api(`inscripciones/${i.id}/categoria`, { categoria: nueva || null }), `${quien}: ahora en ${NOMBRES[nueva]}.`)) recargar();
      else (e.target as HTMLSelectElement).value = actual;
    } }, ...Object.entries(NOMBRES).map(([v, t]) => h('option', { value: v, selected: actual === v }, t)));
  return sel;
}
