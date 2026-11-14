// Utilidades HTTP comunes para las funciones de api/ (formato Web: Request → Response).
import crypto from 'node:crypto';

/** Respuesta JSON. Por defecto sin caché. */
export const json = (body, status = 200, cabeceras = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...cabeceras } });

/** Lee el cuerpo JSON; devuelve null si no es JSON válido. */
export async function leerJson(request) {
  try { return await request.json(); } catch { return null; }
}

/** IP del cliente según Vercel (primera de x-forwarded-for). */
export const ipCliente = (request) => (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;

/** Hash de la IP para guardarla sin conservar la IP en claro (con RUKC_DATA_KEY como sal si existe). */
export function hashIp(ip) {
  if (!ip) return null;
  const clave = process.env.RUKC_DATA_KEY || 'rukc';
  return crypto.createHmac('sha256', clave).update(ip).digest('hex');
}

// Orígenes de la web: el dominio, los despliegues de Vercel de este proyecto (raceupkc y raceupkc-<rama/hash>,
// rukc-pruebas) y localhost. Antes valía cualquier *.vercel.app, que cualquiera puede crear.
export const ORIGENES_WEB = /^https:\/\/((www\.)?raceupkc\.com|rukc-pruebas\.vercel\.app|raceupkc(-[\w-]+)?\.vercel\.app)$|^http:\/\/localhost(:\d+)?$/;
const ORIGENES = ORIGENES_WEB;

/** Origen público de la web para construir enlaces (el de la petición si es nuestro; si no, raceupkc.com). */
export function origenWeb(request) {
  const o = new URL(request.url).origin;
  return ORIGENES.test(o) ? o : 'https://raceupkc.com';
}

/** Las peticiones del navegador que cambian datos deben venir de nuestra web (cabecera Origin). */
export function origenValido(request) {
  const o = request.headers.get('origin');
  return !o || ORIGENES.test(o);
}

/**
 * Límite de peticiones por IP y ruta (tabla limite_peticion): `max` peticiones por ventana de `minutos`.
 * Devuelve true si la petición puede seguir. Usa la conexión `db` (pool o cliente) que se le pase.
 */
export async function dentroDelLimite(db, request, ruta, max = 20, minutos = 10) {
  return contar(db, `${hashIp(ipCliente(request)) ?? 'sin-ip'}:${ruta}`, max, minutos);
}

/**
 * Límite global de una ruta (todas las IPs juntas): tope de gasto o de carga aunque el abuso llegue desde muchas IPs.
 * Misma tabla y misma limpieza que el límite por IP (lib/tareas.js → limites).
 */
export async function dentroDelLimiteGlobal(db, ruta, max, minutos) {
  return contar(db, `global:${ruta}`, max, minutos);
}

async function contar(db, clave, max, minutos) {
  const { rows } = await db.query(
    `INSERT INTO limite_peticion (clave, ventana_inicio, contador)
     VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / ($2 * 60)) * ($2 * 60)), 1)
     ON CONFLICT (clave, ventana_inicio) DO UPDATE SET contador = limite_peticion.contador + 1
     RETURNING contador`,
    [clave, minutos]);
  return rows[0].contador <= max;
}
