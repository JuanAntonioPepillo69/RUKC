// /api/feedback-anonimo/* · feedback anónimo post-carrera y sorteo (/feedback/<ronda> y /feedback/<ronda>/sorteo).
// vercel.json reescribe /api/feedback-anonimo/<ruta> a /api/feedback-anonimo?ruta=<ruta>. Rutas:
//   GET  estado?ronda=r2     { estado: antes | abierto | cerrado, abre, cierra } según la hora del servidor
//   POST responder           { ronda, respuestas, web }            → feedback_responses
//   POST sorteo              { ronda, nombre, whatsapp, privacidad, web } → raffle_entries
//
// Anonimato (ver db/migrations/0015_feedback_anonimo.sql):
// - No se lee ni se guarda la IP, el user agent ni ninguna cookie, y no se abre transacción con rukc.ip.
// - El límite contra abusos cuenta peticiones por ronda y ruta, nunca por IP.
// - Nada del cuerpo de la petición se escribe en los logs: los errores solo registran su código.
// - `web` es un campo trampa que una persona no ve: si llega relleno, se responde ok sin guardar.
import { consulta } from '../lib/db.js';
import { json, origenValido } from '../lib/http.js';
import { normalizarTelefono } from '../lib/telefono.js';
import { formVersion, validar } from '../lib/feedback-anonimo/motor.js';
import { rondaPorSlug, ventana } from '../src/config/feedback/rondas.js';

const MAX_CUERPO = 32 * 1024;
const LIMITE = { responder: 300, sorteo: 300, ventanaMin: 10 };

/** Hora de referencia. Fuera de producción admite ?ahora=<ISO> para probar las fechas de apertura y cierre. */
function ahora(url) {
  const pedida = url.searchParams.get('ahora');
  const produccion = process.env.VERCEL_ENV === 'production' || process.env.RUKC_ENTORNO === 'produccion';
  if (!pedida || produccion) return new Date();
  const d = new Date(pedida);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function leerCuerpo(request) {
  const texto = await request.text();
  if (texto.length > MAX_CUERPO) throw Object.assign(new Error('Demasiado largo.'), { status: 413 });
  try { return JSON.parse(texto); } catch { throw Object.assign(new Error('Revisa las respuestas.'), { status: 400 }); }
}

/** Límite global por ronda y ruta, sin IP: `max` peticiones cada `ventanaMin` minutos. */
async function dentroDelLimite(ruta, roundId) {
  const [f] = await consulta(
    `INSERT INTO limite_peticion (clave, ventana_inicio, contador)
     VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / ($2 * 60)) * ($2 * 60)), 1)
     ON CONFLICT (clave, ventana_inicio) DO UPDATE SET contador = limite_peticion.contador + 1
     RETURNING contador`, [`anonimo:${ruta}:${roundId}`, LIMITE.ventanaMin]);
  return f.contador <= LIMITE[ruta];
}

async function manejar(request) {
  const url = new URL(request.url);
  const ruta = (url.searchParams.get('ruta') ?? '').replace(/^\/+|\/+$/g, '');

  if (request.method === 'GET' && ruta === 'estado') {
    const r = rondaPorSlug(url.searchParams.get('ronda'));
    if (!r) return json({ error: 'No encontrado.' }, 404);
    return json({ estado: ventana(r, ahora(url)), abre: r.abre, cierra: r.cierra });
  }

  if (request.method !== 'POST' || !['responder', 'sorteo'].includes(ruta)) return json({ error: 'No encontrado.' }, 404);
  if (!origenValido(request)) return json({ error: 'Origen no permitido.' }, 403);
  const body = await leerCuerpo(request);
  const r = rondaPorSlug(body?.ronda);
  if (!r) return json({ error: 'No encontrado.' }, 404);
  if (ventana(r, ahora(url)) !== 'abierto') return json({ error: 'El formulario está cerrado.', cerrado: true }, 410);
  if (body.web) return json({ ok: true });
  if (!(await dentroDelLimite(ruta, r.round_id))) return json({ error: 'Hay muchos envíos ahora mismo. Inténtalo en unos minutos.' }, 429);

  if (ruta === 'responder') {
    const answers = validar(r, body.respuestas);
    await consulta('SELECT guardar_feedback_anonimo($1, $2, $3::jsonb)', [r.round_id, formVersion(r), JSON.stringify(answers)]);
    return json({ ok: true });
  }

  const nombre = typeof body.nombre === 'string' ? body.nombre.trim().replace(/\s+/g, ' ') : '';
  if (nombre.length < 2 || nombre.length > 120) return json({ error: 'Escribe tu nombre y apellidos.', campo: 'nombre' }, 400);
  const whatsapp = normalizarTelefono(typeof body.whatsapp === 'string' ? body.whatsapp : '');
  if (!whatsapp) return json({ error: 'Revisa el número de WhatsApp.', campo: 'whatsapp' }, 400);
  if (body.privacidad !== true) return json({ error: 'Tienes que marcar que has leído la política de privacidad.', campo: 'privacidad' }, 400);
  // Si ese WhatsApp ya estaba dentro, la respuesta es la misma: no se confirma a nadie si un número participa.
  await consulta('SELECT guardar_sorteo($1, $2, $3)', [r.round_id, nombre, whatsapp]);
  return json({ ok: true });
}

async function responder(request) {
  try {
    return await manejar(request);
  } catch (e) {
    if (e.status) return json({ error: e.message, campo: e.campo ?? null }, e.status);
    // Solo el código: el mensaje de un error de la base de datos puede repetir valores enviados.
    console.error('feedback-anonimo: error', e?.code ?? e?.name ?? 'desconocido');
    return json({ error: 'No se ha podido guardar. Inténtalo de nuevo.' }, 500);
  }
}

export const GET = responder;
export const POST = responder;
