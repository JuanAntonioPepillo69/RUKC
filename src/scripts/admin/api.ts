// Cliente del panel: llamadas a /api/admin/* con la cookie de sesión, avisos y formato de importes y fechas.
// Sin sesión → /admin/entrar; sin segundo factor → /admin/seguridad.

export class ErrorApi extends Error {
  constructor(public status: number, mensaje: string, public datos: Record<string, unknown> = {}) { super(mensaje); }
}

export async function api<T = any>(ruta: string, cuerpo?: unknown): Promise<T> {
  const res = await fetch(`/api/admin/${ruta}`, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: cuerpo === undefined ? {} : { 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    credentials: 'same-origin',
  });
  const datos = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = `/admin/entrar?volver=${encodeURIComponent(location.pathname + location.search)}`; throw new ErrorApi(401, 'Inicia sesión.'); }
  if (res.status === 403 && datos.necesita_2fa) { location.href = '/admin/seguridad'; throw new ErrorApi(403, datos.error); }
  if (!res.ok) throw new ErrorApi(res.status, datos.error || 'Error inesperado.', datos);
  return datos as T;
}

export async function salir() {
  await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' }).catch(() => {});
  location.href = '/admin/entrar';
}

let temporizador: number | undefined;
export function aviso(texto: string, malo = false) {
  const el = document.getElementById('adm-aviso');
  if (!el) return alert(texto);
  el.textContent = texto;
  el.classList.toggle('mal', malo);
  el.hidden = false;
  window.clearTimeout(temporizador);
  temporizador = window.setTimeout(() => { el.hidden = true; }, malo ? 7000 : 3500);
}

/** Ejecuta una acción con aviso de éxito o de error. Devuelve el resultado o null. */
export async function accion<T>(fn: () => Promise<T>, ok = 'Hecho.'): Promise<T | null> {
  try { const r = await fn(); if (ok) aviso(ok); return r; } catch (e) { aviso((e as Error).message, true); return null; }
}

export const euros = (cent: number | string | null | undefined) =>
  cent == null || cent === '' ? '' : (Number(cent) / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
export const fecha = (v: string | null | undefined) => (v ? new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' }) : '');
export const fechaHora = (v: string | null | undefined) => (v ? new Date(v).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

const ESTADOS_OK = ['pagada', 'confirmado', 'ganada', 'completado', 'dentro', 'aprobado', 'abierta', 'asistio', 'respondido', 'celebrada'];
const ESTADOS_MAL = ['cancelada', 'fallido', 'perdida', 'rechazado', 'pago_abandonado', 'descartada', 'no_presentado', 'cerrada', 'caducado'];
export function etiquetaEstado(e: string) {
  const s = document.createElement('span');
  s.className = `estado ${ESTADOS_OK.includes(e) ? 'ok' : ESTADOS_MAL.includes(e) ? 'mal' : 'medio'}`;
  s.textContent = String(e ?? '').replace(/_/g, ' ');
  return s;
}

/** Crea un elemento: h('button', { class: 'b', onclick }, 'Texto'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...hijos: (Node | string | null | undefined | false)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list') (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of hijos) if (c != null && c !== false) el.append(c);
  return el;
}

/** Abre WhatsApp con un mensaje preparado por el servidor (queda registrado en la ficha o en el historial). */
export async function whatsapp(datos: Record<string, string>) {
  const r = await accion(() => api<{ url: string }>('whatsapp', datos), 'Mensaje preparado y registrado.');
  if (r) window.open(r.url, '_blank', 'noopener');
}
