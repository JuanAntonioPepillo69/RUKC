// /api/wa/pendientes · cada 10 minutos (Vercel Cron; ver vercel.json). Cuando termina el tiempo en que la
// conversación estaba en manos de John (3 h desde su último mensaje, o un escalado), el bot contesta lo que el
// contacto escribió y nadie contestó, sin esperar a que vuelva a escribir. Protegido con CRON_SECRET.
import crypto from 'node:crypto';
import { json } from '../../lib/http.js';
import { responderPendientesVencidos } from '../../lib/whatsapp/entrante.js';

function autorizado(request) {
  const secreto = process.env.CRON_SECRET;
  const dado = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return Boolean(secreto) && dado.length === secreto.length && crypto.timingSafeEqual(Buffer.from(dado), Buffer.from(secreto));
}

export async function manejar(request, deps) {
  if (!autorizado(request)) return json({ error: 'No autorizado.' }, 401);
  return json(await responderPendientesVencidos(deps));
}

export const GET = (request) => manejar(request);
