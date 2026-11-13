// Genera en local las imágenes de inscritos (sin enviar nada).
//   npm run inscritos:generar                      próxima ronda, datos de la BD de .env (desarrollo)
//   npm run inscritos:generar:produccion           próxima ronda, datos de producción (.env.produccion, solo lectura)
//   npm run inscritos:generar -- --prueba todos    datos inventados: 0, 1, 25, 50 y nombres largos
// Las deja en exportaciones/inscritos/ (carpeta ignorada por git) e imprime el texto para el grupo.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generarPng } from '../../lib/inscritos/imagen.js';
import { CATEGORIAS, parrilla, proximaRonda, sinCategoria } from '../../lib/inscritos/datos.js';
import { CASOS_PRUEBA, RONDA_PRUEBA, parrillaPrueba } from '../../lib/inscritos/prueba.js';
import { textoGrupo } from '../../lib/inscritos/textos.js';

const args = process.argv.slice(2);
const valor = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const salida = valor('--salida') ?? join('exportaciones', 'inscritos');
const prueba = valor('--prueba');
mkdirSync(salida, { recursive: true });

async function guardar(ronda, cat, sufijo = '') {
  const png = await generarPng({ ronda, categoria: cat.categoria, nombreCategoria: cat.nombre, plazas: cat.plazas, pilotos: cat.pilotos });
  const archivo = join(salida, `${ronda.temporada}-R${ronda.numero}-${cat.categoria}${sufijo}.png`);
  writeFileSync(archivo, png);
  const t = textoGrupo({ categoria: cat.categoria, categoriaNombre: cat.nombre, ronda: ronda.numero, circuito: ronda.circuito, fecha: ronda.fecha, n: cat.pilotos.length, plazas: cat.plazas });
  console.log(`${archivo}  (${Math.round(png.length / 1024)} KB, ${cat.pilotos.length}/${cat.plazas}, ${t.situacion})\n  ${t.texto}`);
}

if (prueba) {
  for (const caso of prueba === 'todos' ? CASOS_PRUEBA : [prueba]) {
    for (const c of CATEGORIAS) await guardar(RONDA_PRUEBA, parrillaPrueba(caso, c), `-prueba-${caso}`);
  }
} else {
  const ronda = await proximaRonda();
  if (!ronda) { console.log('No hay ninguna ronda próxima.'); process.exit(0); }
  for (const c of CATEGORIAS) {
    const cat = await parrilla(ronda, c);
    if (cat) await guardar(ronda, cat);
  }
  const sin = await sinCategoria(ronda);
  if (sin) console.log(`Aviso: ${sin} inscrito(s) con pago sin categoría asignada; no salen en ninguna imagen.`);
}
