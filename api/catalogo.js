// GET /api/catalogo · Rondas futuras con el estado de cupo por categoría, precio de carrera, importe de reserva,
// aviso de borradores y versiones de los documentos que se aceptan. Lo pide /inscripcion al cargar (los cupos se
// abren y cierran a mano), con caché corta de 60 s.
import { leerCatalogo } from '../lib/catalogo.js';
import { consulta } from '../lib/db.js';
import { json } from '../lib/http.js';

export async function GET() {
  try {
    const catalogo = await leerCatalogo(consulta);
    if (!catalogo) return json({ error: 'No hay ninguna temporada abierta.' }, 404);
    return json(catalogo, 200, { 'Cache-Control': 'public, max-age=60, s-maxage=60' });
  } catch (e) {
    console.error('catalogo', e.message);
    return json({ error: 'No se ha podido cargar el calendario. Inténtalo en un momento.' }, 503);
  }
}
