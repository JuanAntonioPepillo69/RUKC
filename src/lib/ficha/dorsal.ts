// Elección de dorsal en la ficha: comprobación al momento y sugerencias, sin enseñar la lista de dorsales cogidos
// (con 100 o 200 pilotos no se puede leer). El servidor vuelve a comprobarlo al guardar (lib/onboarding.js).

export const DORSAL_MIN = 1;
export const DORSAL_MAX = 999;
/** Primero se sugieren números de una o dos cifras, que son los que más se leen en el kart. */
const PREFERIDOS_HASTA = 99;

export type EstadoDorsal = 'vacio' | 'invalido' | 'libre' | 'ocupado';

export function estadoDorsal(valor: string, ocupados: ReadonlySet<number>): EstadoDorsal {
  const t = valor.trim();
  if (!t) return 'vacio';
  if (!/^\d{1,3}$/.test(t)) return 'invalido';
  const n = Number(t);
  if (n < DORSAL_MIN || n > DORSAL_MAX) return 'invalido';
  return ocupados.has(n) ? 'ocupado' : 'libre';
}

/** Los `cuantos` dorsales libres más cercanos a `cerca` (alternando arriba y abajo); sin número, los más bajos libres. */
export function sugerencias(ocupados: ReadonlySet<number>, cerca: number | null, cuantos = 5): number[] {
  const libre = (n: number) => n >= DORSAL_MIN && n <= DORSAL_MAX && !ocupados.has(n);
  const salida: number[] = [];
  if (cerca == null || !Number.isFinite(cerca)) {
    for (let n = DORSAL_MIN; n <= DORSAL_MAX && salida.length < cuantos; n++) if (libre(n)) salida.push(n);
    return salida;
  }
  for (let d = 1; d <= DORSAL_MAX && salida.length < cuantos; d++) {
    for (const n of [cerca + d, cerca - d]) if (libre(n) && salida.length < cuantos) salida.push(n);
  }
  return salida.sort((a, b) => a - b);
}

/** Un dorsal libre al azar: de 1 a 99 si queda alguno; si no, de 100 a 999. null si no queda ninguno. */
export function dorsalAlAzar(ocupados: ReadonlySet<number>, azar: () => number = Math.random): number | null {
  const libres = (desde: number, hasta: number) => {
    const l: number[] = [];
    for (let n = desde; n <= hasta; n++) if (!ocupados.has(n)) l.push(n);
    return l;
  };
  const tramo = libres(DORSAL_MIN, PREFERIDOS_HASTA);
  const lista = tramo.length ? tramo : libres(PREFERIDOS_HASTA + 1, DORSAL_MAX);
  return lista.length ? lista[Math.floor(azar() * lista.length)] : null;
}
