// Archivos privados (fotos de piloto, justificantes): Vercel Blob en un almacén PRIVADO. Nunca hay URL pública:
// se sirven siempre a través de una función que comprueba el permiso.
// Variable: BLOB_READ_WRITE_TOKEN (la pone Vercel al conectar el almacén). En local y en los tests, si existe
// RUKC_BLOB_LOCAL_DIR y no hay token, se guardan en esa carpeta.
import { del, get, list, put } from '@vercel/blob';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const MAX_FOTO = 4 * 1024 * 1024;

const local = () => (!process.env.BLOB_READ_WRITE_TOKEN && process.env.RUKC_BLOB_LOCAL_DIR) || null;

/** Guarda una foto y devuelve su ruta en el almacén (lo que se guarda en la base de datos). */
export async function guardarFoto(personaId, cuerpo, tipo) {
  if (!TIPOS[tipo]) throw Object.assign(new Error('La foto tiene que ser JPG, PNG o WebP.'), { status: 415 });
  if (cuerpo.byteLength > MAX_FOTO) throw Object.assign(new Error('La foto ocupa demasiado (máximo 4 MB).'), { status: 413 });
  const ruta = `fotos/${personaId}/${crypto.randomBytes(12).toString('hex')}.${TIPOS[tipo]}`;
  const dir = local();
  if (dir) {
    await fs.mkdir(path.join(dir, path.dirname(ruta)), { recursive: true });
    await fs.writeFile(path.join(dir, ruta), Buffer.from(cuerpo));
    return ruta;
  }
  const r = await put(ruta, Buffer.from(cuerpo), { access: 'private', contentType: tipo, addRandomSuffix: false });
  return r.pathname;
}

/** Devuelve la foto como Response (sin caché pública) o null si no existe. */
export async function servirFoto(ruta) {
  if (!ruta) return null;
  const cab = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };
  const dir = local();
  if (dir) {
    try {
      const buf = await fs.readFile(path.join(dir, ruta));
      const tipo = Object.entries(TIPOS).find(([, ext]) => ruta.endsWith(`.${ext}`))?.[0] ?? 'application/octet-stream';
      return new Response(buf, { headers: { ...cab, 'Content-Type': tipo } });
    } catch { return null; }
  }
  const r = await get(ruta, { access: 'private', useCache: false });
  if (!r) return null;
  return new Response(r.stream, { headers: { ...cab, 'Content-Type': r.blob?.contentType ?? r.headers?.get?.('content-type') ?? 'application/octet-stream' } });
}

export async function borrarFoto(ruta) {
  if (!ruta) return;
  const dir = local();
  if (dir) { await fs.rm(path.join(dir, ruta), { force: true }); return; }
  await del(ruta);
}

// ---------- Archivos genéricos (copias de seguridad) ----------

/** Guarda un archivo privado tal cual en `ruta` (sin sufijo aleatorio; sobrescribe). */
export async function guardarArchivo(ruta, cuerpo, tipo = 'application/octet-stream') {
  const dir = local();
  if (dir) {
    await fs.mkdir(path.join(dir, path.dirname(ruta)), { recursive: true });
    await fs.writeFile(path.join(dir, ruta), Buffer.from(cuerpo));
    return ruta;
  }
  const r = await put(ruta, Buffer.from(cuerpo), { access: 'private', contentType: tipo, addRandomSuffix: false, allowOverwrite: true });
  return r.pathname;
}

/** Lee un archivo privado entero (Buffer) o null si no existe. */
export async function leerArchivo(ruta) {
  const dir = local();
  if (dir) { try { return await fs.readFile(path.join(dir, ruta)); } catch { return null; } }
  const r = await get(ruta, { access: 'private', useCache: false });
  return r ? Buffer.from(await new Response(r.stream).arrayBuffer()) : null;
}

/** Archivos bajo un prefijo, del más nuevo al más antiguo: [{ ruta, tamano, subido_en }]. */
export async function listarArchivos(prefijo) {
  const dir = local();
  if (dir) {
    const base = path.join(dir, prefijo);
    let nombres = [];
    try { nombres = await fs.readdir(base); } catch { return []; }
    const lista = await Promise.all(nombres.map(async (n) => {
      const s = await fs.stat(path.join(base, n));
      return { ruta: `${prefijo.replace(/\/$/, '')}/${n}`, tamano: s.size, subido_en: s.mtime.toISOString() };
    }));
    return lista.sort((a, b) => b.ruta.localeCompare(a.ruta));
  }
  const todos = [];
  let cursor;
  do {
    const r = await list({ prefix: prefijo, cursor, limit: 1000 });
    todos.push(...r.blobs.map((b) => ({ ruta: b.pathname, tamano: b.size, subido_en: new Date(b.uploadedAt).toISOString() })));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return todos.sort((a, b) => b.ruta.localeCompare(a.ruta));
}

export async function borrarArchivo(ruta) {
  const dir = local();
  if (dir) { await fs.rm(path.join(dir, ruta), { force: true }); return; }
  await del(ruta);
}
