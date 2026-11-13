// Texto para el grupo de pilotos que acompaña a cada imagen semanal. Cambia según cómo esté la categoría (vacía, con
// sitio, últimas plazas, completa, semana de carrera) y, dentro de cada situación, rota entre varias versiones según la
// semana del año, para que no salga el mismo texto dos semanas seguidas. Sin emojis y en una sola línea (las variables
// de las plantillas de WhatsApp no admiten saltos de línea).

const ENLACE = 'raceupkc.com/inscripcion';

/** Número de semana ISO de una fecha. */
export function semanaIso(fecha = new Date()) {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  const dia = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dia);
  const inicio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - inicio) / 864e5 + 1) / 7);
}

const diasHasta = (fechaIso, ahora) => {
  const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
  return Math.round((Date.parse(`${fechaIso}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 864e5);
};

const fechaTexto = (iso) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' })
  .format(new Date(`${iso}T12:00:00Z`)).replace(',', '');

/** Situación de la categoría. */
export function situacion({ n, plazas, fecha }, ahora = new Date()) {
  const libres = plazas - n;
  if (libres <= 0) return 'completa';
  if (n === 0) return 'vacia';
  if (libres <= 5) return 'ultimas';
  if (diasHasta(fecha, ahora) <= 7) return 'semana_carrera';
  return 'abierta';
}

const plural = (n, uno, varios) => (n === 1 ? uno : varios);

const VERSIONES = {
  vacia: [
    (v) => `Abrimos la parrilla de ${v.cat} para la Ronda ${v.ronda} en ${v.circuito}, el ${v.fecha}. Las ${v.plazas} plazas están libres: la primera puede ser la tuya. ${ENLACE}`,
    (v) => `Ronda ${v.ronda}, ${v.circuito}, ${v.fecha}. La parrilla de ${v.cat} está en blanco y tiene ${v.plazas} plazas. Quien se apunte primero abre la lista. ${ENLACE}`,
    (v) => `Parrilla de ${v.cat} de la Ronda ${v.ronda} sin estrenar: ${v.plazas} plazas para ${v.circuito} el ${v.fecha}. ${ENLACE}`,
  ],
  abierta: [
    (v) => `Parrilla de ${v.cat} para la Ronda ${v.ronda} en ${v.circuito}: ${v.n} ${plural(v.n, 'piloto confirmado', 'pilotos confirmados')} y quedan ${v.libres} plazas. Busca tu nombre y, si no está, ${ENLACE}`,
    (v) => `Así va la Ronda ${v.ronda} en ${v.circuito} (${v.fecha}): ${v.n} de ${v.plazas} plazas ocupadas en ${v.cat}. Quedan ${v.libres}. ${ENLACE}`,
    (v) => `${v.circuito}, ${v.fecha}. ${v.n} ${plural(v.n, 'piloto ya tiene', 'pilotos ya tienen')} su sitio en la parrilla de ${v.cat}; quedan ${v.libres} plazas. ${ENLACE}`,
    (v) => `Ronda ${v.ronda}, ${v.cat}: ${v.libres} plazas libres de ${v.plazas}. Karts iguales, pesaje y lastre: gana quien mejor pilota. ${ENLACE}`,
  ],
  semana_carrera: [
    (v) => `Semana de carrera. Ronda ${v.ronda} en ${v.circuito} el ${v.fecha}: ${v.n} ${plural(v.n, 'piloto', 'pilotos')} en la parrilla de ${v.cat} y ${v.libres} plazas libres. ${ENLACE}`,
    (v) => `Este ${v.fecha} se corre en ${v.circuito}. Parrilla de ${v.cat}: ${v.n} de ${v.plazas}. Quedan ${v.libres} plazas para quien se decida esta semana. ${ENLACE}`,
    (v) => `Cuenta atrás para la Ronda ${v.ronda}. ${v.cat}: ${v.n} ${plural(v.n, 'confirmado', 'confirmados')}, ${v.libres} plazas libres. ${ENLACE}`,
  ],
  ultimas: [
    (v) => `${v.libres === 1 ? 'Queda una plaza' : `Quedan ${v.libres} plazas`} en ${v.cat} para la Ronda ${v.ronda} en ${v.circuito}. Cuando se llene, se cierra. ${ENLACE}`,
    (v) => `Parrilla de ${v.cat} casi llena: ${v.n} de ${v.plazas}. ${v.libres === 1 ? 'Última plaza' : `Últimas ${v.libres} plazas`} para ${v.circuito} el ${v.fecha}. ${ENLACE}`,
    (v) => `Ronda ${v.ronda}, ${v.cat}: ${v.libres === 1 ? 'solo queda una plaza' : `solo quedan ${v.libres} plazas`}. ${ENLACE}`,
  ],
  completa: [
    (v) => `Parrilla de ${v.cat} completa para la Ronda ${v.ronda} en ${v.circuito}: ${v.n} pilotos. Nos vemos el ${v.fecha}.`,
    (v) => `Lleno en ${v.cat}. Ronda ${v.ronda}, ${v.circuito}, ${v.fecha}: ${v.n} pilotos con plaza. Si te has quedado fuera, escríbenos para la lista de espera.`,
    (v) => `${v.cat} sin plazas para la Ronda ${v.ronda}. Estos son los ${v.n} pilotos que saldrán en ${v.circuito} el ${v.fecha}.`,
  ],
};

/**
 * Texto para el grupo. d: { categoriaNombre, ronda, circuito, fecha (YYYY-MM-DD), n, plazas }.
 * La versión depende de la semana del año (y de la categoría, para que Ligeros y Pesados no digan lo mismo).
 */
export function textoGrupo(d, ahora = new Date()) {
  const s = situacion(d, ahora);
  const lista = VERSIONES[s];
  const indice = (semanaIso(ahora) + (d.categoria === 'PES' ? 1 : 0)) % lista.length;
  const v = { cat: d.categoriaNombre, ronda: d.ronda, circuito: d.circuito, fecha: fechaTexto(d.fecha), n: d.n, plazas: d.plazas, libres: d.plazas - d.n };
  return { situacion: s, texto: lista[indice](v) };
}

/** Todas las versiones de una situación (para los tests). */
export const versiones = (s) => VERSIONES[s];
