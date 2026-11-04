// /api/cron · tarea programada diaria (Vercel Cron, 03:00 UTC; ver vercel.json y lib/tareas.js).
// Vercel la llama con la cabecera Authorization: Bearer <CRON_SECRET>. A mano, con la misma cabecera:
//   /api/cron                      lo de cada día (y el día 1, la lista de anonimización)
//   /api/cron?tareas=copia,neon    solo esas tareas
// Responde siempre 200 con el resultado de cada paso (aunque alguno falle): Vercel no reintenta, y los errores
// quedan en `evento` y en el panel.
import crypto from 'node:crypto';
import { json } from '../lib/http.js';
import { ejecutar, TAREAS } from '../lib/tareas.js';

function autorizado(request) {
  const secreto = process.env.CRON_SECRET;
  const dado = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return Boolean(secreto) && dado.length === secreto.length && crypto.timingSafeEqual(Buffer.from(dado), Buffer.from(secreto));
}

export async function GET(request) {
  if (!autorizado(request)) return json({ error: 'No autorizado.' }, 401);
  const pedidas = new URL(request.url).searchParams.get('tareas');
  const tareas = pedidas ? pedidas.split(',').map((t) => t.trim()).filter(Boolean) : null;
  if (tareas?.some((t) => !TAREAS.includes(t))) return json({ error: `Tareas válidas: ${TAREAS.join(', ')}.` }, 400);
  return json(await ejecutar({ tareas, origen: tareas ? 'manual' : 'cron' }));
}
