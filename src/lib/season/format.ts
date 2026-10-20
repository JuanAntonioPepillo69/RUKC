// Utilidades de presentación para las páginas de la temporada.
import type { Ronda } from './types.ts';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const partes = (iso: string) => iso.split('-').map(Number);
export const fechaLarga = (iso: string) => { const [y, m, d] = partes(iso); return `${d} de ${MESES[m - 1]} de ${y}`; };
export const fechaCorta = (iso: string) => { const [, m, d] = partes(iso); return `${d} ${MESES_CORTOS[m - 1]}`; };

export const slug = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** URL de la página de una ronda: /season-2/r1-karting-mijas */
export const urlRonda = (r: Ronda) => `/season-2/r${r.ronda}-${slug(r.circuito)}`;

export const ESTADO: Record<Ronda['estado'], string> = {
  programada: 'Programada', disputada: 'Disputada', aplazada: 'Aplazada', cancelada: 'Cancelada',
};

/** 12.5 -> "12,5" */
export const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));
