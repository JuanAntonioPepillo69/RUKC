// Modelo de datos de la temporada. Cada tipo corresponde a una pestaña de la hoja de Google Sheets.

export type Categoria = 'Ligeros' | 'Pesados';
export const CATEGORIAS: Categoria[] = ['Ligeros', 'Pesados'];

export type EstadoRonda = 'programada' | 'disputada' | 'aplazada' | 'cancelada';
/** Parte de la final disputada (Art. 31 quater): completa, mitad de puntos o nula. */
export type Carrera = 'completa' | 'mitad' | 'nula';

export interface Ronda {
  ronda: number;
  fecha: string; // AAAA-MM-DD
  circuito: string;
  estado: EstadoRonda;
  carrera: Carrera;
  nota: string;
}

export interface Piloto {
  dorsal: number;
  nombre: string;
  /** 'Ambas' = compite en Ligeros y en Pesados; puntúa por separado en cada una. */
  categoria: Categoria | 'Ambas';
}

export interface Resultado {
  ronda: number;
  categoria: Categoria;
  dorsal: number;
  /** Posición en la clasificación del evento de su categoría. null = no clasificado. */
  posicion: number | null;
  /** Recibe la bandera a cuadros con al menos el 80 % de las vueltas del ganador (Art. 46 bis). */
  finaliza: boolean;
  pole: boolean;
  vueltaRapida: boolean;
  constancia: boolean;
  /** Pierde las bonificaciones de la ronda (Art. 23 quinquies c). */
  pierdeBonus: boolean;
  /** Excluido o descalificado por sanción: 0 puntos y esa ronda no se puede descartar (Art. 48 c). */
  dsq: boolean;
  salida: number | null;
  mejorVuelta: string;
}

export interface Sancion {
  fecha: string;
  ronda: number | null;
  dorsal: number;
  pp: number;
  motivo: string;
}

export interface Mencion {
  ronda: number;
  titulo: string;
  dorsal: number | null;
  texto: string;
}

export interface Config {
  /** auto = se aplica cuando todas las rondas no canceladas están disputadas. */
  descarte: 'auto' | 'si' | 'no';
  aviso: string;
}

export interface Temporada {
  config: Config;
  rondas: Ronda[];
  pilotos: Piloto[];
  resultados: Resultado[];
  sanciones: Sancion[];
  menciones: Mencion[];
  /** true cuando no hay hoja conectada y se usan los datos de ejemplo. */
  demo: boolean;
}
