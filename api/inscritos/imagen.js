// /api/inscritos/imagen · PNG 1080x1350 de la parrilla de inscritos con pago de una categoría (lib/inscritos).
// Dos formas de pedirla:
// - Enlace firmado (el que se manda por WhatsApp; caduca): ?ronda=<uuid>&categoria=LIG|PES&exp=<s>&firma=<hex>
// - A mano, con la cabecera Authorization: Bearer <CRON_SECRET>:
//     ?categoria=LIG|PES               próxima ronda
//     ?categoria=PES&ronda=<uuid>      una ronda concreta
//     ?categoria=PES&prueba=0|1|25|50|largos   datos inventados para probar el diseño
// Solo dorsal y nombre público; nunca email, teléfono, edad ni peso.
import { json } from '../../lib/http.js';
import { bearerValido, firmaValida } from '../../lib/inscritos/enlace.js';
import { CATEGORIAS, parrilla, proximaRonda, rondaPorId } from '../../lib/inscritos/datos.js';
import { generarPng } from '../../lib/inscritos/imagen.js';
import { CASOS_PRUEBA, RONDA_PRUEBA, parrillaPrueba } from '../../lib/inscritos/prueba.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function manejar(request, deps = {}) {
  const p = Object.fromEntries(new URL(request.url).searchParams);
  const firmado = Boolean(p.firma) && firmaValida(p);
  if (!firmado && !bearerValido(request)) return json({ error: 'No autorizado.' }, 401);
  if (!CATEGORIAS.includes(p.categoria)) return json({ error: 'categoria debe ser LIG o PES.' }, 400);

  let ronda, cat;
  if (!firmado && p.prueba !== undefined) {
    if (!CASOS_PRUEBA.includes(p.prueba)) return json({ error: `prueba debe ser ${CASOS_PRUEBA.join(', ')}.` }, 400);
    ronda = RONDA_PRUEBA;
    cat = parrillaPrueba(p.prueba, p.categoria);
  } else {
    if (p.ronda !== undefined && !UUID.test(p.ronda)) return json({ error: 'ronda no válida.' }, 400);
    ronda = p.ronda ? await (deps.rondaPorId ?? rondaPorId)(p.ronda) : await (deps.proximaRonda ?? proximaRonda)();
    if (!ronda) return json({ error: 'No hay ronda.' }, 404);
    cat = await (deps.parrilla ?? parrilla)(ronda, p.categoria);
    if (!cat) return json({ error: 'Esa categoría no tiene cupo en la ronda.' }, 404);
  }

  const png = await generarPng({ ronda, categoria: cat.categoria, nombreCategoria: cat.nombre, plazas: cat.plazas, pilotos: cat.pilotos });
  // Solo letras, números y guiones en la cabecera (temporada y categoría vienen de la BD).
  const nombre = `rukc-${ronda.temporada}-r${ronda.numero}-${cat.categoria}.png`.toLowerCase().replace(/[^a-z0-9.-]/g, '');
  return new Response(png, { headers: {
    'Content-Type': 'image/png',
    'Content-Disposition': `inline; filename="${nombre}"`,
    'Cache-Control': 'private, no-store',
  } });
}

export const GET = (request) => manejar(request);
