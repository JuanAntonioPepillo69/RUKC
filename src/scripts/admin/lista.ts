// Lista genérica del panel: búsqueda, filtros combinables (Y), orden, paginación, vistas guardadas y exportación
// a CSV o XLSX de lo que se ve. Lee de /api/admin/lista/:vista.
import { api, accion, aviso, etiquetaEstado, euros, fecha, fechaHora, h } from './api';

type Col = { c: string; t: string; tipo: string };
type Filtro = { c: string; op: string; v?: unknown };
type Respuesta = { columnas: Col[]; id: string; filas: Record<string, any>[]; total: number; pagina: number; por_pagina: number };

const OPS: Record<string, [string, string][]> = {
  texto: [['contiene', 'contiene'], ['eq', 'es'], ['ne', 'no es'], ['vacio', 'está vacío'], ['no_vacio', 'tiene valor']],
  num: [['eq', '='], ['gte', '≥'], ['lte', '≤'], ['vacio', 'está vacío']],
  cent: [['gte', '≥ (€)'], ['lte', '≤ (€)'], ['eq', '= (€)']],
  fecha: [['gte', 'desde'], ['lte', 'hasta']],
  fechahora: [['gte', 'desde'], ['lte', 'hasta']],
  bool: [['si', 'sí'], ['no', 'no']],
  json: [['contiene', 'contiene']],
};
const SIN_VALOR = ['vacio', 'no_vacio', 'si', 'no'];
const ES_ESTADO = (c: string) => c === 'estado' || c === 'etapa' || c.endsWith('_estado') || ['onboarding', 'grupo', 'feedback', 'estado_cupo'].includes(c);

export function celda(col: Col, v: any): Node | string {
  if (v == null || v === '') return '';
  if (ES_ESTADO(col.c) && typeof v === 'string') return etiquetaEstado(v);
  switch (col.tipo) {
    case 'cent': return euros(v);
    case 'fecha': return fecha(v);
    case 'fechahora': return fechaHora(v);
    case 'bool': return v ? 'sí' : 'no';
    case 'json': return String(v).slice(0, 80);
    default: return String(v);
  }
}

export interface OpcionesLista {
  vista: string;
  contenedor: HTMLElement;
  alPulsar?: (fila: Record<string, any>) => void;
  acciones?: (fila: Record<string, any>, recargar: () => void) => Node | null;
  filtros?: Filtro[];
  sensibles?: boolean;   // permite exportar datos sensibles (con confirmación)
}

export function crearLista(op: OpcionesLista) {
  let estado = { f: [...(op.filtros ?? [])] as Filtro[], q: '', o: '', d: 'asc', pagina: 0 };
  let columnas: Col[] = [];
  const buscar = h('input', { class: 'ctrl', type: 'search', placeholder: 'Buscar…', 'aria-label': 'Buscar' }) as HTMLInputElement;
  const chips = h('div', { class: 'filtros' });
  const selCol = h('select', { class: 'ctrl', 'aria-label': 'Columna' }) as HTMLSelectElement;
  const selOp = h('select', { class: 'ctrl', 'aria-label': 'Condición' }) as HTMLSelectElement;
  const valor = h('input', { class: 'ctrl', placeholder: 'Valor', 'aria-label': 'Valor' }) as HTMLInputElement;
  const nuevo = h('div', { class: 'nuevo-filtro', hidden: true }, selCol, selOp, valor, h('button', { class: 'b b--peq', type: 'button', onclick: anadir }, 'Añadir'));
  const selVista = h('select', { class: 'ctrl', 'aria-label': 'Vistas guardadas' }) as HTMLSelectElement;
  const sensibles = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const tabla = h('table', { class: 'tabla' });
  const pie = h('div', { class: 'paginas' });

  op.contenedor.append(h('div', { class: 'lista' },
    h('div', { class: 'lista-barra' },
      buscar,
      h('button', { class: 'b b--peq', type: 'button', onclick: () => { nuevo.hidden = !nuevo.hidden; } }, 'Filtro'),
      selVista,
      h('button', { class: 'b b--peq', type: 'button', onclick: guardarVista }, 'Guardar vista'),
      h('button', { class: 'b b--peq', type: 'button', onclick: () => exportar('csv') }, 'CSV'),
      h('button', { class: 'b b--peq', type: 'button', onclick: () => exportar('xlsx') }, 'XLSX'),
      op.sensibles ? h('label', { class: 'sub' }, sensibles, ' incluir datos sensibles') : null),
    nuevo, chips, h('div', { class: 'tabla-env' }, tabla), pie));

  let espera: number | undefined;
  buscar.addEventListener('input', () => { window.clearTimeout(espera); espera = window.setTimeout(() => { estado.q = buscar.value; estado.pagina = 0; cargar(); }, 300); });
  selCol.addEventListener('change', pintarOps);
  selVista.addEventListener('change', () => {
    const v = vistas.find((x) => x.id === selVista.value);
    if (!v) return;
    estado = { ...estado, f: JSON.parse(v.filtros.f || '[]'), q: v.filtros.q || '', pagina: 0 };
    buscar.value = estado.q;
    cargar();
  });

  function pintarOps() {
    const col = columnas.find((x) => x.c === selCol.value);
    selOp.replaceChildren(...(OPS[col?.tipo ?? 'texto'] ?? OPS.texto).map(([v, t]) => h('option', { value: v }, t)));
    valor.type = col?.tipo === 'fecha' || col?.tipo === 'fechahora' ? 'date' : col?.tipo === 'num' || col?.tipo === 'cent' ? 'number' : 'text';
  }
  function anadir() {
    const col = columnas.find((x) => x.c === selCol.value)!;
    const f: Filtro = { c: col.c, op: selOp.value };
    if (!SIN_VALOR.includes(f.op)) {
      if (!valor.value) return aviso('Escribe un valor para el filtro.', true);
      f.v = col.tipo === 'cent' ? Math.round(Number(valor.value) * 100) : valor.value;
    }
    estado.f.push(f);
    estado.pagina = 0;
    valor.value = '';
    nuevo.hidden = true;
    cargar();
  }
  function pintarChips() {
    chips.replaceChildren(...estado.f.map((f, i) => {
      const col = columnas.find((x) => x.c === f.c);
      const opTxt = (OPS[col?.tipo ?? 'texto'] ?? []).find(([v]) => v === f.op)?.[1] ?? f.op;
      const v = f.v === undefined ? '' : col?.tipo === 'cent' ? euros(f.v as number) : String(f.v);
      return h('span', { class: 'chip' }, `${col?.t ?? f.c} ${opTxt} ${v}`, h('button', { type: 'button', 'aria-label': 'Quitar filtro', onclick: () => { estado.f.splice(i, 1); cargar(); } }, '×'));
    }));
  }

  const consulta = () => new URLSearchParams({ f: JSON.stringify(estado.f), q: estado.q, o: estado.o, d: estado.d, pagina: String(estado.pagina) });

  async function cargar() {
    let r: Respuesta;
    try { r = await api<Respuesta>(`lista/${op.vista}?${consulta()}`); } catch (e) { aviso((e as Error).message, true); return; }
    if (!columnas.length) {
      columnas = r.columnas;
      selCol.replaceChildren(...columnas.map((x) => h('option', { value: x.c }, x.t)));
      pintarOps();
    }
    pintarChips();
    const cab = h('tr', {}, ...columnas.map((x) => h('th', { scope: 'col', onclick: () => {
      estado.d = estado.o === x.c && estado.d === 'asc' ? 'desc' : 'asc';
      estado.o = x.c;
      cargar();
    } }, x.t + (estado.o === x.c ? (estado.d === 'asc' ? ' ↑' : ' ↓') : ''))), op.acciones ? h('th', {}, '') : null);
    const cuerpo = r.filas.length ? r.filas.map((fila) => h('tr', { class: op.alPulsar ? 'clic' : '', onclick: op.alPulsar ? (e: Event) => {
      if (!(e.target as HTMLElement).closest('button, a')) op.alPulsar!(fila);
    } : null }, ...columnas.map((x) => h('td', { class: ['cent', 'num'].includes(x.tipo) ? 'num' : '' }, celda(x, fila[x.c]))),
      op.acciones ? h('td', {}, op.acciones(fila, cargar) ?? '') : null))
      : [h('tr', {}, h('td', { colSpan: columnas.length + 1, class: 'vacio' }, 'No hay resultados.'))];
    tabla.replaceChildren(h('thead', {}, cab), h('tbody', {}, ...cuerpo));
    const paginas = Math.max(1, Math.ceil(r.total / r.por_pagina));
    pie.replaceChildren(h('span', {}, `${r.total} resultado${r.total === 1 ? '' : 's'}`),
      h('span', { class: 'acciones' },
        h('button', { class: 'b b--peq', type: 'button', disabled: estado.pagina === 0, onclick: () => { estado.pagina--; cargar(); } }, 'Anterior'),
        `${estado.pagina + 1} / ${paginas}`,
        h('button', { class: 'b b--peq', type: 'button', disabled: estado.pagina + 1 >= paginas, onclick: () => { estado.pagina++; cargar(); } }, 'Siguiente')));
  }

  function exportar(formato: string) {
    const p = consulta();
    p.delete('pagina');
    p.set('formato', formato);
    if (op.sensibles && sensibles.checked) {
      if (!confirm('Vas a exportar datos sensibles: fecha de nacimiento, peso y documento de identidad (completo solo para el propietario). Quedará registrado en el historial. ¿Seguir?')) return;
      p.set('sensibles', '1');
      p.set('confirmo', '1');
    }
    location.href = `/api/admin/exportar/${op.vista}?${p}`;
  }

  let vistas: { id: string; nombre: string; filtros: any }[] = [];
  async function cargarVistas() {
    try { vistas = (await api<{ vistas: typeof vistas }>(`vistas/${op.vista}`)).vistas; } catch { vistas = []; }
    selVista.replaceChildren(h('option', { value: '' }, 'Vistas guardadas'), ...vistas.map((v) => h('option', { value: v.id }, v.nombre)));
  }
  async function guardarVista() {
    const nombre = prompt('Nombre de la vista (filtros y búsqueda actuales):');
    if (!nombre) return;
    if (await accion(() => api('vistas', { pantalla: op.vista, nombre, filtros: { f: JSON.stringify(estado.f), q: estado.q } }), 'Vista guardada.')) cargarVistas();
  }

  cargarVistas();
  cargar();
  return { recargar: cargar };
}
