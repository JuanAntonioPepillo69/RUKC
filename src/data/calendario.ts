// Calendario oficial de la Temporada 2 (reglamento v1.1, Art. 70, con la R5 y la R7 corregidas).
// Lo usa el hero. La página de la temporada leerá los resultados desde Google Sheets.
export const CIRCUITOS = {
  mijas: { nombre: 'Karting Mijas', corto: 'Mijas' },
  campillos: { nombre: 'Karting Campillos', corto: 'Campillos' },
  kfmalaga: { nombre: 'Kart&Fun Málaga', corto: 'K&F Málaga' },
  delsol: { nombre: 'Karting del Sol', corto: 'Karting del Sol' },
  kfestepona: { nombre: 'Kart&Fun Estepona', corto: 'K&F Estepona' },
} as const;

export type CircuitoId = keyof typeof CIRCUITOS;

export const RONDAS: { ronda: number; fecha: string; circuito: CircuitoId; nota?: string }[] = [
  { ronda: 1, fecha: '2026-10-17', circuito: 'mijas' },
  { ronda: 2, fecha: '2026-11-21', circuito: 'campillos' },
  { ronda: 3, fecha: '2026-12-12', circuito: 'kfmalaga' },
  { ronda: 4, fecha: '2027-02-06', circuito: 'delsol' },
  { ronda: 5, fecha: '2027-03-13', circuito: 'kfmalaga' },
  { ronda: 6, fecha: '2027-04-24', circuito: 'kfestepona' },
  { ronda: 7, fecha: '2027-06-05', circuito: 'mijas' },
  { ronda: 8, fecha: '2027-07-03', circuito: 'campillos', nota: 'Final y gala' },
];

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const fechaCorta = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MESES[m - 1]}`;
};
