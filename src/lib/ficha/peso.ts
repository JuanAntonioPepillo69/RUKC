// Peso de competición y categoría (reglamento, Arts. 18, 18 bis, 23 bis y 23 ter). Lo usan el formulario de reserva y
// la ficha de piloto para que cada piloto vea por su cuenta en qué categoría está y a qué se compromete.
//
// Peso de competición = peso con la ropa, el calzado, los guantes y las protecciones con los que se corre, más 1,5 kg
// fijos del casco (Art. 23 bis b). Lo que hay que sumar a lo que marca una báscula en casa son estimaciones:
// - Ropa de interior de un adulto: 1,2 kg de media en hombres y 0,8 kg en mujeres (Whigham y otros, International
//   Journal of Obesity, 2013). Para correr hace falta ropa larga y calzado cerrado: ropa de 1 a 1,5 kg y zapatillas
//   de 0,6 a 1 kg el par.
// - Casco: 1,5 kg fijos, aunque no se pesa.
// - Protecciones propias, si se llevan: un protector de costillas pesa de 0,7 a 1,2 kg.

export const CASCO_KG = 1.5;
export const LIGEROS_MIN_KG = 70;
export const LIGEROS_MAX_KG = 80;
export const PESADOS_MIN_KG = 85;
/** Lastre que la organización garantiza a cada piloto (Art. 23 ter b). */
export const LASTRE_GARANTIZADO_KG = 2;

export type ComoTePesas = 'sin_ropa' | 'ropa_ligera' | 'equipacion';

export const FORMAS_DE_PESARSE: Record<ComoTePesas, { texto: string; suma: [number, number]; detalle: string }> = {
  sin_ropa: {
    texto: 'Sin ropa o en ropa interior',
    suma: [3, 4],
    detalle: 'Ropa larga y zapatillas (de 1,5 a 2,5 kg) más 1,5 kg del casco.',
  },
  ropa_ligera: {
    texto: 'Con ropa de casa y descalzo',
    suma: [2, 3],
    detalle: 'Zapatillas y algo más de ropa (de 0,5 a 1,5 kg) más 1,5 kg del casco.',
  },
  equipacion: {
    texto: 'Con la ropa y las zapatillas con las que vas a correr',
    suma: [1.5, 1.5],
    detalle: 'Solo falta el casco, que cuenta 1,5 kg fijos.',
  },
};

export type Tramo = 'LIG' | 'eleccion' | 'PES';

/** Tramo de un peso de competición: Ligeros hasta 80,0 kg, franja de 80,1 a 84,9 kg y Pesados desde 85,0 kg. */
export function tramoPorPeso(kg: number): Tramo {
  if (kg <= LIGEROS_MAX_KG) return 'LIG';
  if (kg < PESADOS_MIN_KG) return 'eleccion';
  return 'PES';
}

const kg1 = (n: number) => Math.round(n * 10) / 10;
export const kgTexto = (n: number) => `${kg1(n).toLocaleString('es-ES', { minimumFractionDigits: kg1(n) % 1 ? 1 : 0, maximumFractionDigits: 1 })} kg`;

export type Estimacion = { min: number; max: number; tramos: Tramo[]; sugerido: number };

/** De lo que marca la báscula a un rango de peso de competición y los tramos que toca ese rango. */
export function estimarPeso(bascula: number, como: ComoTePesas): Estimacion | null {
  if (!Number.isFinite(bascula) || bascula < 25 || bascula > 250) return null;
  const [a, b] = FORMAS_DE_PESARSE[como].suma;
  const min = kg1(bascula + a);
  const max = kg1(bascula + b);
  const tramos = [...new Set([tramoPorPeso(min), tramoPorPeso(max)])];
  if (tramos.includes('LIG') && tramos.includes('PES')) tramos.splice(1, 0, 'eleccion');
  return { min, max, tramos, sugerido: kg1((min + max) / 2) };
}

/** Qué categoría le toca a un peso de competición, en una frase. */
export function textoTramo(t: Tramo, kg?: number): string {
  if (t === 'LIG') {
    const bajo = kg != null && kg < LIGEROS_MIN_KG
      ? ` Por debajo de ${LIGEROS_MIN_KG} kg te lastras hasta ese peso: la organización te pone hasta ${LASTRE_GARANTIZADO_KG} kg y el resto lo traes tú.`
      : '';
    return `Ligeros (de ${LIGEROS_MIN_KG} a ${LIGEROS_MAX_KG} kg).${bajo}`;
  }
  if (t === 'eleccion') {
    return `Franja de 80,1 a 84,9 kg: eliges. Ligeros, si en el pesaje bajas a ${LIGEROS_MAX_KG} kg quitándote prendas que no sean obligatorias, o Pesados, lastrado hasta ${PESADOS_MIN_KG} kg.`;
  }
  return `Pesados (${PESADOS_MIN_KG} kg o más).`;
}

/** Resultado de la calculadora, en una frase. */
export function textoEstimacion(e: Estimacion): string {
  const rango = e.min === e.max ? kgTexto(e.min) : `entre ${kgTexto(e.min).replace(' kg', '')} y ${kgTexto(e.max)}`;
  if (e.tramos.length === 1) return `Tu peso de competición sería ${rango}. ${textoTramo(e.tramos[0], e.min)}`;
  return `Tu peso de competición sería ${rango}: estás cerca de un corte. Pésate con la ropa y las zapatillas con las que vas a correr para salir de dudas.`;
}

/** A qué te comprometes al elegir una categoría (reserva y ficha). */
export const COMPROMISO: Record<'LIG' | 'PES', string[]> = {
  LIG: [
    `En el pesaje de cada ronda tienes que dar ${LIGEROS_MAX_KG} kg o menos de peso de competición.`,
    `Si das más y no puedes bajar quitándote prendas que no sean obligatorias, esa ronda corres en Pesados, lastrado hasta ${PESADOS_MIN_KG} kg, y lo que puntúes no cuenta para Ligeros (Art. 18 bis).`,
    `Si das menos de ${LIGEROS_MIN_KG} kg, te lastras hasta ${LIGEROS_MIN_KG} kg.`,
  ],
  PES: [
    `Corres con ${PESADOS_MIN_KG} kg o más de peso de competición. Si das menos, te lastras hasta ${PESADOS_MIN_KG} kg.`,
    `La organización te pone hasta ${LASTRE_GARANTIZADO_KG} kg de lastre. Si te falta más, tienes que traer el tuyo (Art. 23 ter).`,
    `Si pesas ${LIGEROS_MAX_KG} kg o menos, solo puedes correr en Pesados con lastre propio. Sin él, no puedes correr en Pesados (Art. 18 d).`,
  ],
};
export const COMPROMISO_COMUN = 'La categoría se fija en tu primer pesaje de la temporada y solo puedes cambiarla una vez, entre rondas y avisando antes (Art. 18 bis).';
