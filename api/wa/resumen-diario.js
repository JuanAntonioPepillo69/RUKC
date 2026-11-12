// /api/wa/resumen-diario · F2, resumen diario del bot para John a las 20:00 de Madrid (Vercel Cron; ver vercel.json).
// El cron se lanza a las 18:00 y a las 19:00 UTC y solo actúa en la que cae a las 20:00 de Madrid (cambia con el
// horario de verano). A mano, con la cabecera Authorization: Bearer <CRON_SECRET>: /api/wa/resumen-diario?forzar=1
// Los crons de Vercel solo corren en producción.
import crypto from 'node:crypto';
import { json } from '../../lib/http.js';
import { enviarResumenDiario } from '../../lib/whatsapp/resumen.js';

function autorizado(request) {
  const secreto = process.env.CRON_SECRET;
  const dado = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return Boolean(secreto) && dado.length === secreto.length && crypto.timingSafeEqual(Buffer.from(dado), Buffer.from(secreto));
}

const horaMadrid = () => Number(new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));

export async function manejar(request, deps = {}) {
  if (!autorizado(request)) return json({ error: 'No autorizado.' }, 401);
  const forzar = new URL(request.url).searchParams.get('forzar') === '1';
  if (!forzar && horaMadrid() !== 20) return json({ enviado: false, motivo: 'no son las 20:00 en Madrid' });
  return json(await enviarResumenDiario(deps));
}

export const GET = (request) => manejar(request);
