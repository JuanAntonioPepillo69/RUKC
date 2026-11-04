// Copia de seguridad de la base de datos: todas las tablas a JSON, comprimido (gzip) y cifrado (AES-256-GCM con
// RUKC_BACKUP_KEY, 32 bytes en base64, distinta de RUKC_DATA_KEY), en el almacén privado de Vercel Blob.
// Se conservan 30 diarias (copias/diaria/AAAA-MM-DD.rukc) y 12 mensuales (copias/mensual/AAAA-MM.rukc, el día 1).
// El JSON lo genera Postgres (json_agg), así que se restaura con json_populate_recordset sin perder tipos
// (bytea en hexadecimal, fechas ISO, jsonb y arrays tal cual). Restaurar: db/restaurar-copia.mjs.
// Si se pierde RUKC_BACKUP_KEY, las copias no se pueden abrir: guárdala también fuera de Vercel.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { borrarArchivo, guardarArchivo, listarArchivos } from './archivos.js';

const MAGIA = Buffer.from('RUKCBK1');
export const CONSERVAR = { diaria: 30, mensual: 12 };

function clave() {
  const k = Buffer.from(process.env.RUKC_BACKUP_KEY || '', 'base64');
  if (k.length !== 32) throw new Error('RUKC_BACKUP_KEY no está configurada (32 bytes en base64).');
  return k;
}

export function cifrarCopia(json) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', clave(), iv);
  const datos = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(json, 'utf8'))), c.final()]);
  return Buffer.concat([MAGIA, iv, c.getAuthTag(), datos]);
}

export function descifrarCopia(buf) {
  const b = Buffer.from(buf);
  if (!b.subarray(0, MAGIA.length).equals(MAGIA)) throw new Error('No es una copia de RUKC.');
  const o = MAGIA.length;
  const d = crypto.createDecipheriv('aes-256-gcm', clave(), b.subarray(o, o + 12));
  d.setAuthTag(b.subarray(o + 12, o + 28));
  return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(b.subarray(o + 28)), d.final()])).toString('utf8'));
}

/** Todas las tablas del esquema public con sus filas, las secuencias y las migraciones aplicadas. */
export async function volcar(c) {
  const tablas = (await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)).rows.map((r) => r.table_name);
  const datos = {};
  for (const t of tablas) {
    datos[t] = (await c.query(`SELECT coalesce(json_agg(x), '[]'::json) AS filas FROM ${quoteIdent(t)} x`)).rows[0].filas;
  }
  const secuencias = Object.fromEntries((await c.query(`SELECT sequencename AS n, last_value AS v FROM pg_sequences WHERE schemaname = 'public'`)).rows.map((r) => [r.n, r.v == null ? null : Number(r.v)]));
  return { formato: 1, creada_en: new Date().toISOString(), tablas: datos, secuencias, conteos: Object.fromEntries(tablas.map((t) => [t, datos[t].length])) };
}

const quoteIdent = (s) => `"${String(s).replace(/"/g, '""')}"`;

/** Hace la copia del día (y la mensual el día 1) y borra las que sobran. Devuelve un resumen sin datos. */
export async function hacerCopia(c, ahora = new Date()) {
  const copia = await volcar(c);
  const cuerpo = cifrarCopia(JSON.stringify(copia));
  const dia = ahora.toISOString().slice(0, 10);
  const rutas = [await guardarArchivo(`copias/diaria/${dia}.rukc`, cuerpo)];
  if (ahora.getUTCDate() === 1) rutas.push(await guardarArchivo(`copias/mensual/${dia.slice(0, 7)}.rukc`, cuerpo));
  const borradas = [];
  for (const [tipo, n] of Object.entries(CONSERVAR)) {
    for (const viejo of (await listarArchivos(`copias/${tipo}/`)).slice(n)) { await borrarArchivo(viejo.ruta); borradas.push(viejo.ruta); }
  }
  return { rutas, bytes: cuerpo.length, tablas: Object.keys(copia.conteos).length, filas: Object.values(copia.conteos).reduce((a, b) => a + b, 0), borradas };
}
