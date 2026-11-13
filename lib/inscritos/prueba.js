// Datos inventados para probar el diseño sin tocar la BD: 0, 1, 25 o 50 inscritos, o 30 con nombres de 24 caracteres
// (el máximo de la ficha). Ningún nombre es de un piloto real.
const NOMBRES = ['Adrián V.', 'Bruno M.', 'Carlos R.', 'Daniela P.', 'Eduardo R.', 'Fernando G.', 'Gonzalo M.', 'Héctor S.', 'Ignacio T.', 'Javier L.',
  'Kevin O.', 'Luis M.', 'Marcos T.', 'Nicolás B.', 'Óscar P.', 'Pedro J.', 'Quique R.', 'Raúl D.', 'Sergio A.', 'Tomás E.',
  'Ulises N.', 'Víctor B.', 'Xavier C.', 'Yago F.', 'Zacarías M.', 'Álvaro Q.', 'Borja I.', 'Cristian E.', 'David O.', 'Enrique Z.'];
const LARGOS = ['Alejandro Fernández Cast', 'Luis Miguel Santamaría R', 'Víctor Manuel Bermúdez O', 'María de los Ángeles Pé',
  'Juan Francisco Domínguez', 'Ignacio de la Torre Mart', 'José Antonio Villanueva ', 'Francisco Javier Echever'];

export const CASOS_PRUEBA = ['0', '1', '25', '50', 'largos'];

/** Parrilla inventada para un caso. plazas: 30, o 50 en el caso de 50. */
export function parrillaPrueba(caso, categoria = 'PES') {
  const n = caso === 'largos' ? 30 : Number(caso);
  const plazas = n > 30 ? 50 : 30;
  const pilotos = Array.from({ length: n }, (_, i) => {
    const base = caso === 'largos' ? LARGOS[i % LARGOS.length] : NOMBRES[i % NOMBRES.length];
    const nombre = (i < NOMBRES.length || caso === 'largos' ? base : `${base.split(' ')[0]} ${String.fromCharCode(65 + (i % 26))}.`).trim().slice(0, 24);
    return { dorsal: i === 3 ? null : 2 + ((i * 7) % 97), nombre };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  return { categoria, nombre: categoria === 'LIG' ? 'Ligeros' : 'Pesados', plazas, pilotos };
}

export const RONDA_PRUEBA = { id: '00000000-0000-4000-8000-000000000000', numero: 3, fecha: '2026-12-12', circuito: 'Kart&Fun Málaga', temporada: 'T2' };
