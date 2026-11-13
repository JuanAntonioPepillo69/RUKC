// /api/inscritos/semanal · imágenes semanales de inscritos a John por WhatsApp (lib/inscritos/envio.js).
// Vercel Cron (vercel.json) la lanza los miércoles a las 17:00 y a las 18:00 UTC; solo actúa en la que cae a la hora de
// Madrid de DIA_HORA (19:00), así no le afecta el cambio de hora. Los crons de Vercel solo corren en producción.
// A mano, con Authorization: Bearer <CRON_SECRET>:
//   ?forzar=1     envía ahora aunque no sea miércoles a las 19:00 ni sea la primera vez hoy
//   ?simular=1    no envía nada: devuelve los enlaces firmados de las dos imágenes y los textos para el grupo
import { json, origenWeb } from '../../lib/http.js';
import { bearerValido } from '../../lib/inscritos/enlace.js';
import { enviarSemana } from '../../lib/inscritos/envio.js';

// Día (0 = domingo … 3 = miércoles) y hora de Madrid del envío. Si cambias el día o la hora, cambia también el
// "schedule" de /api/inscritos/semanal en vercel.json (minuto 0, horas UTC de invierno y de verano, mismo día).
export const DIA_HORA = { dia: 3, hora: 19 };

export function esMomento(ahora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', weekday: 'short', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(ahora).map((x) => [x.type, x.value]));
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return dia === DIA_HORA.dia && Number(p.hour) === DIA_HORA.hora;
}

// En producción los enlaces siempre van a raceupkc.com: los despliegues de vista previa tienen protección y YCloud no
// podría descargar la imagen.
const origen = (request) => (process.env.VERCEL_ENV === 'production' ? 'https://raceupkc.com' : origenWeb(request));

export async function manejar(request, deps = {}) {
  if (!bearerValido(request)) return json({ error: 'No autorizado.' }, 401);
  const p = new URL(request.url).searchParams;
  const simular = p.get('simular') === '1';
  const forzar = p.get('forzar') === '1';
  const ahora = deps.ahora ?? new Date();
  if (!simular && !forzar && !esMomento(ahora)) return json({ enviado: false, motivo: 'No es la hora del envío en Madrid.' });
  try {
    return json(await enviarSemana({ origen: origen(request), ahora, forzar, simular, d: deps }));
  } catch (e) {
    console.error('inscritos semanal', e.message);
    return json({ enviado: false, error: e.message }, 500);
  }
}

export const GET = (request) => manejar(request);
