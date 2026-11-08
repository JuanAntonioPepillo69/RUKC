// Dorsales con los que se corrió la R1 de la T2, tal como salen publicados en /season-2. Están reservados toda la
// temporada: en la ficha solo puede elegirlos su piloto. JavaScript (no TypeScript) para que lo pueda importar lib/.
// Sebastián está corregido: en la hoja pone "Sebsatian" y no coincidiría con su nombre real.

export const TEMPORADA_DORSALES_R1 = 'T2';

export const DORSALES_R1 = {
  1: 'Carlos Salva', 3: 'Andres Savcenko', 7: 'Alvaro Cobos', 8: 'Fabian Gonzales', 9: 'Sergio Lopez', 13: 'Samuel Ortega',
  14: 'Franz Matheis', 17: 'Sebastian', 18: 'Moises', 19: 'Alejandro Merino', 22: 'Manuel Merino', 23: 'Gustav Anders',
  24: 'Patricio Castro', 25: 'Juan Carlos', 26: 'Joaquín', 27: 'Jose Manuel', 29: 'Rafa Lozano', 30: 'Joakim', 31: 'Abraham',
  32: 'Alvaro Moreno', 34: 'Cristobal Jimenez', 35: 'David Vivar', 37: 'Cesar Carrasco', 38: 'Juan Amador', 39: 'Rafa Amador',
  40: 'Dzmitry', 45: 'Manuel Mañero', 47: 'Artem', 48: 'Miguel Angel', 69: 'Felix Doña', 73: 'Favian Castro', 91: 'Alvaro Gomez',
  95: 'Pablo Matheis', 98: 'Rodrigo Gomez', 99: 'Jose Antonio',
};

const palabras = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

/** ¿Es esta persona el piloto de la R1? Todas las palabras del nombre publicado tienen que estar en su nombre completo. */
export function esSuPiloto(nombrePublicado, nombreCompleto) {
  const suyas = new Set(palabras(nombreCompleto));
  const publicadas = palabras(nombrePublicado);
  return publicadas.length > 0 && publicadas.every((p) => suyas.has(p));
}

/** Dorsales de la R1 que esta persona no puede elegir (todos menos el suyo, si corrió la R1). */
export const dorsalesR1Bloqueados = (nombreCompleto) =>
  Object.entries(DORSALES_R1).filter(([, nombre]) => !esSuPiloto(nombre, nombreCompleto)).map(([dorsal]) => Number(dorsal));
