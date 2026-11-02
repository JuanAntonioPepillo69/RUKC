// Acceso al panel: sesión de Better Auth + segundo factor activado + fila activa en la tabla admin.
// Y el despachador de /api/admin/* (una sola función de Vercel para todo el panel).
// Reglas (diseño, "Seguridad"): toda ruta comprueba sesión y rol; las que cambian datos son POST y exigen
// cabecera Origin de la web.
import { auth } from './auth.js';
import { conTransaccion, consulta } from './db.js';
import { ipCliente, json, leerJson } from './http.js';

const ORIGENES = /^https:\/\/((www\.)?raceupkc\.com|rukc-pruebas\.vercel\.app|raceupkc-[\w-]+\.vercel\.app)$|^http:\/\/localhost(:\d+)?$/;

/** Error con estado HTTP y mensaje para el panel. */
export class ErrorPanel extends Error {
  constructor(status, mensaje, extra = {}) { super(mensaje); this.status = status; this.extra = extra; }
}

/** Quién está usando el panel. Devuelve { admin, user } o lanza ErrorPanel 401/403. */
export async function sesionAdmin(request) {
  const s = await auth().api.getSession({ headers: request.headers });
  if (!s) throw new ErrorPanel(401, 'Inicia sesión.');
  if (!s.user.twoFactorEnabled) throw new ErrorPanel(403, 'Activa el segundo factor (TOTP) para entrar al panel.', { necesita_2fa: true });
  const [a] = await consulta('SELECT id, email, nombre, rol FROM admin WHERE email = $1 AND activo', [s.user.email]);
  if (!a) throw new ErrorPanel(403, 'Tu usuario no tiene acceso al panel.');
  return { admin: a, user: s.user };
}

/** Mensaje legible de un error de la base de datos (los triggers ya dan mensajes en español). */
function errorBd(e) {
  if (e.code === '23514' || e.code === '23502' || e.code === 'P0001') return new ErrorPanel(400, e.message.replace(/^.*?: /, '') || e.message);
  if (e.code === '23505') return new ErrorPanel(409, 'Ya existe un registro con esos datos.', { restriccion: e.constraint });
  if (e.code === '23503') return new ErrorPanel(409, 'No se puede: hay datos que dependen de este registro.');
  return null;
}

/**
 * Despacha /api/admin/<ruta> a la tabla de rutas: [['GET', 'personas/:id', fn], ...].
 * fn(ctx) recibe { admin, actor, ip, url, params, body, request, tx } y devuelve datos (JSON) o un Response.
 * ctx.tx(fn) abre una transacción con el actor del historial ya fijado.
 */
export async function despachar(request, rutas) {
  const url = new URL(request.url);
  const ruta = (url.searchParams.get('ruta') ?? url.pathname.replace(/^\/api\/admin\/?/, '')).replace(/^\/+|\/+$/g, '');
  try {
    if (request.method === 'POST') {
      const origen = request.headers.get('origin');
      if (!origen || !ORIGENES.test(origen)) throw new ErrorPanel(403, 'Origen no permitido.');
    }
    const { admin } = await sesionAdmin(request);
    for (const [metodo, patron, fn, roles] of rutas) {
      if (metodo !== request.method) continue;
      const nombres = [];
      const re = new RegExp(`^${patron.replace(/:(\w+)/g, (_, n) => { nombres.push(n); return '([\\w-]+)'; })}$`);
      const m = ruta.match(re);
      if (!m) continue;
      if (roles && !roles.includes(admin.rol)) throw new ErrorPanel(403, 'Tu rol no permite esta acción.');
      const actor = `admin:${admin.id}`;
      const ip = ipCliente(request);
      const ctx = {
        admin, actor, ip, url, request,
        params: Object.fromEntries(nombres.map((n, i) => [n, m[i + 1]])),
        body: request.method === 'POST' ? ((await leerJson(request)) ?? {}) : {},
        tx: (fn2) => conTransaccion(fn2, { actor, ip }),
      };
      const r = await fn(ctx);
      return r instanceof Response ? r : json(r ?? { ok: true });
    }
    throw new ErrorPanel(404, 'No existe esa ruta del panel.');
  } catch (e) {
    const err = e instanceof ErrorPanel ? e : errorBd(e);
    if (err) return json({ error: err.message, ...err.extra }, err.status);
    console.error('panel', ruta, e);
    return json({ error: 'Error inesperado. Inténtalo de nuevo.' }, 500);
  }
}
