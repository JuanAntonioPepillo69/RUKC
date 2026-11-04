// /api/onboarding/* · API de la ficha del piloto (F5). vercel.json reescribe /api/onboarding/<ruta> a
// /api/onboarding?ruta=<ruta>. El token del enlace personal llega en Authorization: Bearer <token>, nunca en la URL de
// la API. Con un token falso, caducado o de una persona anonimizada la respuesta es siempre 404 "No encontrado", sin
// más pistas. Rutas:
//   GET  estado              todo lo que necesita la página
//   POST borrador            autoguardado del paso que se está escribiendo
//   POST paso/<nombre>       guarda un paso validado (documentos completa el onboarding)
//   POST formacion/<id>      marca un módulo de formación como visto
//   POST foto                sube la foto (cuerpo: la imagen; Content-Type image/jpeg, png o webp)
//   GET  foto                devuelve la foto del propio piloto
import { borrarFoto, guardarFoto, MAX_FOTO, servirFoto } from '../lib/archivos.js';
import { conTransaccion } from '../lib/db.js';
import { dentroDelLimite, ipCliente, json, leerJson, origenValido } from '../lib/http.js';
import * as O from '../lib/onboarding.js';
import { hashToken, tokenDeCabecera } from '../lib/tokens.js';
import { ESQUEMAS, borrador, validar } from '../lib/validacion/onboarding.js';

const NO_ENCONTRADO = () => json({ error: 'No encontrado.' }, 404);
const MAGIA = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };

async function manejar(request) {
  const url = new URL(request.url);
  const ruta = (url.searchParams.get('ruta') ?? '').replace(/^\/+|\/+$/g, '');
  const metodo = request.method;
  if (metodo === 'POST' && !origenValido(request)) return json({ error: 'Origen no permitido.' }, 403);
  const token = tokenDeCabecera(request);
  const ctx = { ip: ipCliente(request), userAgent: (request.headers.get('user-agent') || '').slice(0, 400) || null };
  let fotoVieja = null;

  const r = await conTransaccion(async (c) => {
    if (!(await dentroDelLimite(c, request, 'onboarding', 400, 10))) return json({ error: 'Demasiadas peticiones. Espera unos minutos.' }, 429);
    const o = token ? await O.cargar(c, hashToken(token)) : null;
    if (!o) {
      // Los intentos con tokens que no existen tienen un límite más bajo.
      if (!(await dentroDelLimite(c, request, 'onboarding-404', 20, 10))) return json({ error: 'Demasiadas peticiones. Espera unos minutos.' }, 429);
      return NO_ENCONTRADO();
    }

    if (metodo === 'GET' && ruta === 'estado') return json(await O.estado(c, o));

    if (metodo === 'GET' && ruta === 'foto') {
      const p = await c.query('SELECT foto_blob_path FROM perfil_piloto WHERE persona_id = $1', [o.persona_id]);
      return (await servirFoto(p.rows[0]?.foto_blob_path)) ?? NO_ENCONTRADO();
    }

    if (metodo === 'POST' && ruta === 'foto') {
      const tipo = (request.headers.get('content-type') || '').split(';')[0].trim();
      if (Number(request.headers.get('content-length') || 0) > MAX_FOTO) return json({ error: 'La foto ocupa demasiado (máximo 4 MB).' }, 413);
      const cuerpo = new Uint8Array(await request.arrayBuffer());
      if (!MAGIA[tipo] || !MAGIA[tipo].every((b, i) => cuerpo[i] === b)) return json({ error: 'La foto tiene que ser JPG, PNG o WebP.' }, 415);
      const ruta2 = await guardarFoto(o.persona_id, cuerpo, tipo);
      const antes = await c.query('SELECT foto_blob_path FROM perfil_piloto WHERE persona_id = $1', [o.persona_id]);
      fotoVieja = antes.rows[0]?.foto_blob_path ?? null;
      await c.query(`INSERT INTO perfil_piloto (persona_id, nombre_competicion, foto_blob_path, creado_por) VALUES ($1, '', $2, 'publico')
        ON CONFLICT (persona_id) DO UPDATE SET foto_blob_path = EXCLUDED.foto_blob_path`, [o.persona_id, ruta2]);
      return json({ ok: true });
    }

    if (metodo !== 'POST') return NO_ENCONTRADO();
    const body = (await leerJson(request)) ?? {};

    if (ruta === 'borrador') {
      if (['completado', 'requiere_actualizacion'].includes(o.estado)) return json({ ok: true });
      await O.autoguardar(c, o, validar(borrador, body));
      return json({ ok: true });
    }

    const mf = ruta.match(/^formacion\/([0-9a-f-]{36})$/);
    if (mf) { await O.marcarFormacion(c, o, mf[1]); return json({ ok: true }); }

    const mp = ruta.match(/^paso\/(\w+)$/);
    if (mp && (ESQUEMAS[mp[1]] || ['foto', 'formacion'].includes(mp[1]))) {
      const datos = ESQUEMAS[mp[1]] ? validar(ESQUEMAS[mp[1]], body) : null;
      const res = await O.guardarPaso(c, o, mp[1], datos, ctx);
      return json({ ok: true, ...res, ficha: await O.estado(c, o) });
    }
    return NO_ENCONTRADO();
  }, { actor: 'publico', ip: ctx.ip });

  if (fotoVieja) await borrarFoto(fotoVieja).catch((e) => console.error('onboarding foto vieja', e.message));
  return r;
}

async function responder(request) {
  try {
    return await manejar(request);
  } catch (e) {
    if (e.status) return json({ error: e.message, campo: e.campo ?? null }, e.status);
    if (e.code === '23505') return json({ error: 'Ese dato ya lo tiene otra persona. Revísalo.' }, 409);
    if (e.code === '23514') return json({ error: e.message.replace(/^.*?: /, '') || 'Revisa los datos.' }, 400);
    console.error('onboarding', e);
    return json({ error: 'No se ha podido guardar. Inténtalo de nuevo.' }, 500);
  }
}

export const GET = responder;
export const POST = responder;
