// /api/feedback/* · formulario de feedback post-carrera del piloto (F6). vercel.json reescribe /api/feedback/<ruta> a
// /api/feedback?ruta=<ruta>. Mismas protecciones que el onboarding: el token del enlace llega en
// Authorization: Bearer <token>, nunca en la URL de la API, y con un token falso, caducado o de una persona
// anonimizada la respuesta es siempre 404 "No encontrado". Rutas:
//   GET  estado     preguntas de la plantilla; la primera vez que se abre tras el envío pasa a "abierto"
//   POST responder  { respuestas: { <pregunta_id>: valor } } → una fila por pregunta y el envío a "respondido"
import { conTransaccion } from '../lib/db.js';
import { dentroDelLimite, ipCliente, json, leerJson, origenValido } from '../lib/http.js';
import { hashToken, tokenDeCabecera } from '../lib/tokens.js';
import { validarRespuestas } from '../lib/validacion/feedback.js';

const NO_ENCONTRADO = () => json({ error: 'No encontrado.' }, 404);

async function manejar(request) {
  const ruta = (new URL(request.url).searchParams.get('ruta') ?? '').replace(/^\/+|\/+$/g, '');
  if (request.method === 'POST' && !origenValido(request)) return json({ error: 'Origen no permitido.' }, 403);
  const token = tokenDeCabecera(request);
  const ip = ipCliente(request);

  return conTransaccion(async (c) => {
    if (!(await dentroDelLimite(c, request, 'feedback', 100, 10))) return json({ error: 'Demasiadas peticiones. Espera unos minutos.' }, 429);
    const { rows: [e] } = token ? await c.query(`SELECT e.id, e.estado, e.expira_en, pf.preguntas, r.numero AS ronda, r.fecha::text AS fecha,
        ci.nombre AS circuito, t.codigo AS temporada, p.nombre
      FROM envio_feedback e JOIN plantilla_feedback pf ON pf.id = e.plantilla_id
      JOIN inscripcion i ON i.id = e.inscripcion_id JOIN ronda r ON r.id = i.ronda_id JOIN circuito ci ON ci.id = r.circuito_id
      JOIN temporada t ON t.id = r.temporada_id JOIN persona p ON p.id = i.piloto_persona_id AND p.estado = 'activa'
      WHERE e.token_hash = $1 AND e.expira_en > now() AND e.estado <> 'caducado' FOR UPDATE OF e`, [hashToken(token)]) : { rows: [] };
    if (!e) {
      if (!(await dentroDelLimite(c, request, 'feedback-404', 20, 10))) return json({ error: 'Demasiadas peticiones. Espera unos minutos.' }, 429);
      return NO_ENCONTRADO();
    }

    if (request.method === 'GET' && ruta === 'estado') {
      if (e.estado === 'enviado') await c.query(`UPDATE envio_feedback SET estado = 'abierto' WHERE id = $1`, [e.id]);
      return json({
        respondido: e.estado === 'respondido',
        nombre: String(e.nombre || '').trim().split(/\s+/)[0],
        ronda: { numero: e.ronda, fecha: e.fecha, circuito: e.circuito, temporada: e.temporada },
        expira_en: e.expira_en,
        preguntas: e.estado === 'respondido' ? [] : e.preguntas,
      });
    }

    if (request.method === 'POST' && ruta === 'responder') {
      if (e.estado === 'respondido') return json({ error: 'Ya nos has enviado tus respuestas. Gracias.' }, 409);
      const body = (await leerJson(request)) ?? {};
      const filas = validarRespuestas(e.preguntas, body.respuestas);
      for (const f of filas) {
        await c.query(`INSERT INTO respuesta_feedback (envio_id, pregunta_id, valor_num, valor_texto, valor_opciones, creado_por)
          VALUES ($1, $2, $3, $4, $5, 'publico')`, [e.id, f.pregunta_id, f.valor_num, f.valor_texto, f.valor_opciones]);
      }
      // enviado o abierto → respondido (el enlace solo existe desde que se envía: al generar, el token no se conoce).
      await c.query(`UPDATE envio_feedback SET estado = 'respondido' WHERE id = $1`, [e.id]);
      return json({ ok: true });
    }
    return NO_ENCONTRADO();
  }, { actor: 'publico', ip });
}

async function responder(request) {
  try {
    return await manejar(request);
  } catch (e) {
    if (e.status) return json({ error: e.message, campo: e.campo ?? null }, e.status);
    console.error('feedback', e);
    return json({ error: 'No se han podido guardar tus respuestas. Inténtalo de nuevo.' }, 500);
  }
}

export const GET = responder;
export const POST = responder;
