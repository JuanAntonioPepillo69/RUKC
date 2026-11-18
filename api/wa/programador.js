// /api/wa/programador · cada 5 minutos (Vercel Cron; ver vercel.json). Fase 3: el planificador propone a John los
// recordatorios D1 y D2 y el feedback E1 y le manda el borrador D3 (lib/whatsapp/programador.js), y la cola manda los confirmados que
// ya tocan, de 9:30 a 21:30. Protegido con CRON_SECRET.
import crypto from 'node:crypto';
import { json } from '../../lib/http.js';
import { planificar, procesarCola } from '../../lib/whatsapp/programador.js';
import { planificarGrupo } from '../../lib/whatsapp/grupo.js';

function autorizado(request) {
  const secreto = process.env.CRON_SECRET;
  const dado = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return Boolean(secreto) && dado.length === secreto.length && crypto.timingSafeEqual(Buffer.from(dado), Buffer.from(secreto));
}

export async function manejar(request, deps = {}) {
  if (!autorizado(request)) return json({ error: 'No autorizado.' }, 401);
  let plan;
  try {
    plan = await planificar(deps);
  } catch (e) {
    console.error('planificador', e.message);
    plan = { error: e.message };
  }
  const cola = await procesarCola(deps);
  // Mensajes para el grupo de pilotos (a John, para que los pegue en el grupo): lib/whatsapp/grupo.js.
  const grupo = await planificarGrupo(deps);
  return json({ plan, cola, grupo });
}

export const GET = (request) => manejar(request);
