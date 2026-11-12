// /grupo/<token> (vercel.json lo reescribe a /api/grupo?token=<token>) · botón "Unirme al grupo" de la confirmación
// de plaza por WhatsApp (B1). El token firma la inscripción (lib/whatsapp/confirmacion.js).
// - Inscripción reservada o pagada y acceso al grupo aprobado: redirige al enlace del grupo de la temporada
//   (bot_settings.grupo_invite_code o temporada.enlace_grupo_whatsapp).
// - Si no: redirige a la ficha del piloto (/onboarding/<token nuevo>), que explica qué falta. El enlace anterior a la
//   ficha deja de valer, como cuando el panel lo reenvía.
// - Token no válido o inscripción anulada: página corta que remite al WhatsApp de RUKC.
import { conTransaccion } from '../lib/db.js';
import { hashToken, nuevoToken } from '../lib/tokens.js';
import { leerTokenGrupo } from '../lib/whatsapp/confirmacion.js';

const WEB = 'https://raceupkc.com';
const redirigir = (url) => new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
const pagina = (titulo, texto, estado = 200) => new Response(
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${titulo} | RUKC</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#0b0b0b;color:#f2f2f2;display:grid;place-items:center;min-height:100vh;padding:24px}
main{max-width:420px}h1{color:#d4a62a;font-size:22px}a{color:#d4a62a}</style></head>
<body><main><h1>${titulo}</h1><p>${texto}</p><p><a href="${WEB}">raceupkc.com</a></p></main></body></html>`,
  { status: estado, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

export async function GET(request) {
  const token = new URL(request.url).searchParams.get('token');
  let inscripcionId = null;
  try {
    inscripcionId = leerTokenGrupo(token);
  } catch (e) {
    console.error('grupo', e.message);
  }
  if (!inscripcionId) return pagina('Enlace no válido', 'Este enlace no es válido. Escríbenos por WhatsApp y te ayudamos.', 404);

  const destino = await conTransaccion(async (c) => {
    const { rows: [x] } = await c.query(
      `SELECT i.estado, i.piloto_persona_id, r.temporada_id,
              (SELECT valor FROM bot_settings WHERE clave = 'grupo_invite_code') AS codigo_bot,
              t.enlace_grupo_whatsapp, g.estado AS acceso, o.id AS onboarding_id
       FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id JOIN temporada t ON t.id = r.temporada_id
       LEFT JOIN acceso_grupo g ON g.persona_id = i.piloto_persona_id AND g.temporada_id = r.temporada_id
       LEFT JOIN onboarding o ON o.persona_id = i.piloto_persona_id AND o.temporada_id = r.temporada_id
       WHERE i.id = $1`, [inscripcionId]);
    if (!x || !['reservada', 'pagada', 'asistio'].includes(x.estado)) return { tipo: 'anulada' };
    const enlace = x.codigo_bot ? (/^https?:\/\//.test(x.codigo_bot) ? x.codigo_bot : `https://chat.whatsapp.com/${x.codigo_bot}`) : x.enlace_grupo_whatsapp;
    if (['aprobado', 'enlace_enviado', 'dentro'].includes(x.acceso) && enlace) return { tipo: 'grupo', url: enlace };
    if (!x.onboarding_id) return { tipo: 'sin_ficha' };
    const nuevo = nuevoToken();
    await c.query('UPDATE onboarding SET token_hash = $2 WHERE id = $1', [x.onboarding_id, hashToken(nuevo)]);
    return { tipo: 'ficha', url: `${WEB}/onboarding/${nuevo}` };
  }, { actor: 'publico' });

  if (destino.tipo === 'grupo' || destino.tipo === 'ficha') return redirigir(destino.url);
  if (destino.tipo === 'anulada') return pagina('Plaza no activa', 'Esta plaza ya no está activa. Si crees que es un error, escríbenos por WhatsApp.', 410);
  return pagina('Casi listo', 'Tu plaza está reservada. En breve te mandamos el enlace a tu ficha de piloto; si no te llega, escríbenos por WhatsApp.');
}
