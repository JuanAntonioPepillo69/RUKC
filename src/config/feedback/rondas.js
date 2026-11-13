// Configuración de cada ronda para el feedback anónimo (/feedback/<slug> y /feedback/<slug>/sorteo).
// Para una ronda nueva, añade su entrada (o cambia la de la ronda anterior) y despliega:
//   slug                 la parte de la URL (r3 → /feedback/r3).
//   round_id             lo que se guarda en la base de datos: T<temporada>-R<ronda>.
//   abre / cierra        instantes con su desfase de Madrid (+01:00 en invierno, +02:00 en verano). Fuera de ese
//                        intervalo los dos formularios muestran el mensaje de cerrado.
//   modulo               módulo rotativo activo (bloque con ese `modulo` en preguntas.js).
//   formacion_entregada  false mientras la formación en vídeo no se haya entregado.
//   proxima_ronda        el texto entre paréntesis de C26.

export const RONDAS = [
  {
    slug: 'r2',
    round_id: 'T2-R2',
    nombre: 'R2',
    circuito: 'Karting Campillos',
    fecha_carrera: '2026-11-22',
    abre: '2026-11-22T18:00:00+01:00',
    cierra: '2026-11-28T23:59:00+01:00',
    modulo: 'M1',
    formacion_entregada: false,
    proxima_ronda: 'R3, sábado 12 de diciembre, Kart&Fun Málaga',
  },
];

/** Días después del cierre en los que se borran los datos del sorteo (la tarea diaria lo hace). */
export const DIAS_BORRAR_SORTEO = 30;

export const rondaPorSlug = (slug) => RONDAS.find((r) => r.slug === slug) ?? null;
export const rondaPorId = (id) => RONDAS.find((r) => r.round_id === id) ?? null;

/** 'antes', 'abierto' o 'cerrado' para el instante dado. */
export function ventana(ronda, ahora = new Date()) {
  const t = ahora.getTime();
  if (t < Date.parse(ronda.abre)) return 'antes';
  if (t >= Date.parse(ronda.cierra)) return 'cerrado';
  return 'abierto';
}

/** Fecha legible en hora de Madrid: «domingo 22 de noviembre a las 18:00». */
export function fechaLegible(iso) {
  const d = new Date(iso);
  const dia = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  const hora = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${dia.replace(',', '')} a las ${hora}`;
}
