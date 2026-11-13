// Navegador del feedback anónimo (/feedback/<ronda>) y del sorteo (/feedback/<ronda>/sorteo).
// Un bloque por pantalla con barra de progreso. Qué se ve, qué falta y qué se envía lo decide lib/feedback-anonimo/
// motor.js, el mismo que valida en el servidor. Solo se envía lo visible (más las respuestas automáticas).
// Contra respuestas dobles solo hay una marca en localStorage por ronda (control suave a propósito).
import { evaluar, bloquesDe, MAX_OTRO, MAX_TEXTO } from '../../lib/feedback-anonimo/motor.js';
import { PREGUNTAS } from '../config/feedback/preguntas.js';
import { TEXTOS, rellenar } from '../config/feedback/textos.es.js';
import { rondaPorSlug, fechaLegible } from '../config/feedback/rondas.js';

type Valor = string | number | string[];
type Ronda = ReturnType<typeof rondaPorSlug> & {};
const T = TEXTOS.ui;
const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;

function contexto() {
  const ronda = rondaPorSlug($('fa').dataset.ronda) as Ronda;
  // ?ahora=<ISO> solo lo atiende el servidor fuera de producción (pruebas de apertura y cierre).
  const ahora = new URLSearchParams(location.search).get('ahora');
  const qs = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams(extra);
    if (ahora) p.set('ahora', ahora);
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  async function api(ruta: string, cuerpo?: unknown) {
    const res = await fetch(`/api/feedback-anonimo/${ruta}${qs(cuerpo === undefined ? { ronda: ronda.slug } : {})}`, {
      method: cuerpo === undefined ? 'GET' : 'POST',
      headers: cuerpo === undefined ? {} : { 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(datos.error || T.error_red), { status: res.status, campo: datos.campo });
    return datos;
  }
  const textoCerrado = (estado: string) => rellenar(estado === 'antes' ? T.cerrado_antes : T.cerrado_despues,
    { ronda: ronda.nombre, abre: fechaLegible(ronda.abre), cierra: fechaLegible(ronda.cierra) });
  return { ronda, api, textoCerrado };
}

function mostrar(id: string) {
  for (const s of $('fa').querySelectorAll<HTMLElement>(':scope > section, :scope > form, :scope > #carga')) s.hidden = s.id !== id;
  window.scrollTo({ top: 0 });
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...hijos: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...hijos);
  return e;
};

function barajar<X>(a: X[]): X[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

const almacen = {
  clave: (r: Ronda) => `rukc-feedback-${r.round_id}`,
  leer(r: Ronda) { try { return localStorage.getItem(this.clave(r)) === 'enviado'; } catch { return false; } },
  marcar(r: Ronda) { try { localStorage.setItem(this.clave(r), 'enviado'); } catch { /* sin almacenamiento: no pasa nada */ } },
};

// ---------------------------------------------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------------------------------------------
export async function iniciarFormulario() {
  const { ronda, api, textoCerrado } = contexto();
  const respuestas: Record<string, Valor> = {};
  const orden = new Map<string, string[]>();   // orden de opciones de cada pregunta, fijo durante la visita
  const bloques = bloquesDe(ronda);
  let actual = '';

  const textoDe = (id: string) => (TEXTOS.preguntas as any)[id.replace(/_otro$/, '')];
  const opcionesEnOrden = (id: string) => {
    if (!orden.has(id)) {
      const p = (PREGUNTAS as any)[id];
      const fijas: string[] = p.alFinal ?? [];
      const resto = p.opciones.filter((o: string) => !fijas.includes(o));
      orden.set(id, [...(p.aleatorio ? barajar(resto) : resto), ...p.opciones.filter((o: string) => fijas.includes(o))]);
    }
    return orden.get(id)!;
  };

  function pregunta(id: string) {
    const p = (PREGUNTAS as any)[id];
    const t = textoDe(id);
    const caja = el('fieldset', { className: `fa-p${id.endsWith('_seg') ? ' fa-p--seg' : ''}` });
    caja.dataset.id = id;
    const texto = rellenar(t.texto, { proxima_ronda: ronda.proxima_ronda });
    caja.append(el('legend', {}, texto, ...(p.tipo === 'texto' ? [el('small', {}, ` ${T.opcional}`)] : [])));

    if (p.tipo === 'escala') {
      const [min, max] = p.escala;
      const fila = el('div', { className: `fa-escala fa-escala--${max - min + 1}` });
      for (let n = min; n <= max; n++) {
        const input = el('input', { type: 'radio', name: id, value: String(n), checked: respuestas[id] === n });
        input.setAttribute('aria-label', String(n));
        input.addEventListener('change', () => { respuestas[id] = n; actualizar(); });
        fila.append(el('label', {}, input, el('span', {}, String(n))));
      }
      caja.append(fila, el('p', { className: 'fa-extremos' }, el('span', {}, `${min} = ${t.extremos[0]}`), el('span', {}, `${max} = ${t.extremos[1]}`)));
    } else if (p.tipo === 'unica' || p.tipo === 'multiple') {
      const multiple = p.tipo === 'multiple';
      const ayuda = multiple ? el('p', { className: 'fa-p__ayuda' }, p.max ? rellenar(T.maximo, { n: p.max }) : T.varias) : null;
      if (ayuda) caja.append(ayuda);
      const inputs: HTMLInputElement[] = [];
      for (const o of opcionesEnOrden(id)) {
        const marcado = multiple ? ((respuestas[id] as string[]) ?? []).includes(o) : respuestas[id] === o;
        const input = el('input', { type: multiple ? 'checkbox' : 'radio', name: id, value: o, checked: marcado });
        inputs.push(input);
        input.addEventListener('change', () => {
          if (!multiple) { respuestas[id] = o; return actualizar(); }
          if (input.checked && p.exclusiva) {
            for (const x of inputs) if (x !== input && (o === p.exclusiva || x.value === p.exclusiva)) x.checked = false;
          }
          let marcadas = inputs.filter((x) => x.checked).map((x) => x.value);
          if (p.max && marcadas.length > p.max) {
            input.checked = false;
            marcadas = marcadas.filter((x) => x !== o);
            ayuda?.classList.add('fa-p__err');
          } else ayuda?.classList.remove('fa-p__err');
          respuestas[id] = marcadas;
          actualizar();
        });
        caja.append(el('label', { className: 'fa-op' }, input, el('span', {}, t.opciones[o])));
      }
      if (p.otro) {
        const otro = el('input', { type: 'text', className: 'fa-otro', maxLength: MAX_OTRO, placeholder: T.otro_placeholder,
          value: (respuestas[`${id}_otro`] as string) ?? '' });
        otro.dataset.otro = `${id}_otro`;
        otro.setAttribute('aria-label', `${t.opciones.otro}: ${T.otro_placeholder}`);
        otro.addEventListener('input', () => { respuestas[`${id}_otro`] = otro.value; });
        caja.append(otro);
      }
    } else {
      const area = el('textarea', { className: 'fa-texto', rows: 4, maxLength: MAX_TEXTO, placeholder: T.texto_placeholder,
        value: (respuestas[id] as string) ?? '' });
      area.setAttribute('aria-label', texto);
      area.addEventListener('input', () => { respuestas[id] = area.value; });
      caja.append(area);
    }
    caja.append(el('p', { className: 'fa-p__err', hidden: true }, T.falta));
    return caja;
  }

  function actualizar() {
    const ev = evaluar(ronda, respuestas);
    // Visibles en este bloque (una pregunta puede estar en dos bloques y verse solo en uno, como M1.1).
    const enBloque = new Set(ev.bloques.find((b) => b.id === actual)?.preguntas ?? []);
    for (const caja of $('preguntas').querySelectorAll<HTMLElement>('.fa-p')) {
      const id = caja.dataset.id!;
      caja.hidden = !enBloque.has(id);
      if (respuestas[id] != null && !ev.faltan.includes(id)) {
        caja.classList.remove('fa-p--falta');
        (caja.querySelector('.fa-p__err:not(.fa-p__ayuda)') as HTMLElement).hidden = true;
      }
    }
    for (const o of $('preguntas').querySelectorAll<HTMLInputElement>('[data-otro]')) o.hidden = !ev.visibles.has(o.dataset.otro!);
    const i = ev.bloques.findIndex((b) => b.id === actual);
    const total = ev.bloques.length;
    $('paso').textContent = rellenar(T.paso, { n: i + 1, total });
    $('barra').style.width = `${Math.round(((i + 1) / total) * 100)}%`;
    $('siguiente').textContent = i === total - 1 ? T.enviar : T.siguiente;
    return ev;
  }

  function pintar(id: string) {
    actual = id;
    const b = bloques.find((x) => x.id === id)!;
    $('bloque-t').textContent = (TEXTOS.bloques as any)[id];
    $('preguntas').replaceChildren(...b.preguntas.map((x) => pregunta(x.id)));
    $('error').textContent = '';
    actualizar();
    mostrar('form');
  }

  async function enviar(limpias: Record<string, Valor>) {
    const boton = $<HTMLButtonElement>('siguiente');
    boton.disabled = true;
    boton.textContent = T.enviando;
    try {
      await api('responder', { ronda: ronda.slug, respuestas: limpias, web: $<HTMLInputElement>('web').value });
      almacen.marcar(ronda);
      mostrar('gracias');
    } catch (e: any) {
      if (e.status === 410) { $('cerrado-texto').textContent = textoCerrado('cerrado'); return mostrar('cerrado'); }
      $('error').textContent = e.status === 400 ? T.falta_pantalla : e.message;
      boton.textContent = T.enviar;
    } finally { boton.disabled = false; }
  }

  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const ev = actualizar();
    const bloque = ev.bloques.find((b) => b.id === actual)!;
    const malas = bloque.preguntas.filter((id) => ev.faltan.includes(id) || ev.errores[id]);
    $('error').textContent = '';
    if (malas.length) {
      for (const id of malas) {
        const caja = $('preguntas').querySelector<HTMLElement>(`.fa-p[data-id="${CSS.escape(id)}"]`)!;
        caja.classList.add('fa-p--falta');
        (caja.querySelector('.fa-p__err:not(.fa-p__ayuda)') as HTMLElement).hidden = false;
      }
      $('error').textContent = T.falta_pantalla;
      $('preguntas').querySelector(`.fa-p[data-id="${CSS.escape(malas[0])}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const i = ev.bloques.indexOf(bloque);
    if (i < ev.bloques.length - 1) return pintar(ev.bloques[i + 1].id);
    enviar(ev.limpias);
  });

  $('atras').addEventListener('click', () => {
    const ev = evaluar(ronda, respuestas);
    const i = ev.bloques.findIndex((b) => b.id === actual);
    if (i <= 0) return mostrar('intro');
    pintar(ev.bloques[i - 1].id);
  });

  $('empezar').addEventListener('click', () => pintar(evaluar(ronda, respuestas).bloques[0].id));

  try {
    const { estado } = await api('estado');
    if (estado !== 'abierto') { $('cerrado-texto').textContent = textoCerrado(estado); return mostrar('cerrado'); }
    mostrar(almacen.leer(ronda) ? 'ya' : 'intro');
  } catch (e: any) {
    $('carga').textContent = e.message;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Sorteo
// ---------------------------------------------------------------------------------------------------------------
export async function iniciarSorteo() {
  const { ronda, api, textoCerrado } = contexto();
  const S = TEXTOS.sorteo;
  const nombre = $<HTMLInputElement>('nombre');
  const whatsapp = $<HTMLInputElement>('whatsapp');
  const privacidad = $<HTMLInputElement>('privacidad');
  const campos: Record<string, HTMLElement> = { nombre, whatsapp, privacidad };

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('error');
    err.textContent = '';
    const fallo = (campo: string, texto: string) => { err.textContent = texto; campos[campo]?.focus(); };
    if (nombre.value.trim().length < 2) return fallo('nombre', S.falta_nombre);
    if (!/^\+?[\d\s().-]{9,20}$/.test(whatsapp.value.trim())) return fallo('whatsapp', S.falta_whatsapp);
    if (!privacidad.checked) return fallo('privacidad', S.falta_privacidad);
    const boton = $<HTMLButtonElement>('enviar');
    boton.disabled = true;
    try {
      await api('sorteo', { ronda: ronda.slug, nombre: nombre.value, whatsapp: whatsapp.value, privacidad: true, web: $<HTMLInputElement>('web').value });
      mostrar('hecho');
    } catch (x: any) {
      if (x.status === 410) { $('cerrado-texto').textContent = textoCerrado('cerrado'); return mostrar('cerrado'); }
      fallo(x.campo, x.message);
    } finally { boton.disabled = false; }
  });

  try {
    const { estado } = await api('estado');
    if (estado !== 'abierto') { $('cerrado-texto').textContent = textoCerrado(estado); return mostrar('cerrado'); }
    mostrar('form');
  } catch (e: any) {
    $('carga').textContent = e.message;
  }
}
