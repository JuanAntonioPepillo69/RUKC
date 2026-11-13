// /api/wa/pendientes · cada 10 minutos (Vercel Cron; ver vercel.json). Cuando termina el tiempo en que la
// conversación estaba en manos de John (3 h desde su último mensaje, o un escalado), el bot contesta lo que el
// contacto escribió y nadie contestó, sin esperar a que vuelva a escribir. También manda el recordatorio de Bizum
// a las 24 h (B4, lib/bot/bizum.js) y el seguimiento de las reservas con tarjeta abandonadas (C1,
// lib/whatsapp/comercial.js). Protegido con CRON_SECRET.
import crypto from 'node:crypto';
import { json } from '../../lib/http.js';
import { responderPendientesVencidos } from '../../lib/whatsapp/entrante.js';
import { recordatoriosBizum } from '../../lib/bot/bizum.js';
import { seguimientosReserva } from '../../lib/whatsapp/comercial.js';

function autorizado(request) {
  const secreto = process.env.CRON_SECRET;
  const dado = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return Boolean(secreto) && dado.length === secreto.length && crypto.timingSafeEqual(Buffer.from(dado), Buffer.from(secreto));
}

export async function manejar(request, deps) {
  if (!autorizado(request)) return json({ error: 'No autorizado.' }, 401);
  const pendientes = await responderPendientesVencidos(deps);
  const bizum = await recordatoriosBizum(deps);
  const seguimientos = await seguimientosReserva(deps);
  return json({ ...pendientes, bizum, seguimientos });
}

export const GET = (request) => manejar(request);
