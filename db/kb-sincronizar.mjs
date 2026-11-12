// Sincroniza la base de conocimiento del bot (kb_documents) con la bóveda de Obsidian de docs/kb y con la web.
// Se puede repetir: actualiza por slug y, si el contenido cambia, kb_documents guarda la versión anterior en
// kb_document_versions (trigger kb_versionar).
// Fuentes:
//   1. docs/kb/**/*.md: cada nota con cabecera (slug, titulo, categoria) es un documento con fuente "john".
//      - `bot: false` en la cabecera: la nota no se carga (por ejemplo, la de instrucciones).
//      - Las líneas con "[JOHN: ...]" no se cargan (el bot escalará esas preguntas). Una nota sin datos no se carga.
//      - Los enlaces de Obsidian [[Nota]] o [[Nota|texto]] se quedan en su texto.
//      - Los documentos de John que ya no están en la bóveda se desactivan (no se borran).
//   2. Copia de raceupkc.com (portada, temporada, reglamento y condiciones), como hasta ahora (db/kb-sembrar.mjs).
// Uso:  npm run bot:kb             (DATABASE_URL de .env)
//       npm run bot:kb -- --seco   (solo enseña qué cargaría)
//       npm run bot:kb -- --sin-web (solo la bóveda)
//       npm run bot:kb -- --forzar  (pisa también las notas cambiadas desde el canal admin de WhatsApp)
//       node --env-file=.env.produccion db/kb-sincronizar.mjs   (producción, con el OK de John)
import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copiarWeb } from './kb-sembrar.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BOVEDA = path.join(RAIZ, 'docs', 'kb');
const CATEGORIAS = ['liga', 'categorias', 'calendario', 'precios', 'politicas', 'reglamento', 'dia_de_carrera', 'menores', 'enlaces', 'faq'];

/** Cabecera YAML sencilla (clave: valor) y cuerpo de una nota. */
export function leerNota(texto) {
  const m = String(texto).replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { cabecera: {}, cuerpo: texto };
  const cabecera = {};
  for (const linea of m[1].split(/\r?\n/)) {
    const kv = linea.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) cabecera[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { cabecera, cuerpo: m[2] };
}

/** Texto que ve el bot: sin líneas pendientes, sin la sintaxis de enlaces de Obsidian. */
export function limpiarCuerpo(cuerpo) {
  const pendientes = [];
  const lineas = [];
  for (const linea of cuerpo.split(/\r?\n/)) {
    if (/\[JOHN:/i.test(linea)) { pendientes.push(linea.trim()); continue; }
    lineas.push(linea.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1'));
  }
  return { texto: lineas.join('\n').replace(/\n{3,}/g, '\n\n').trim(), pendientes };
}

const tieneDatos = (t) => /^\s*-\s+\S/m.test(t);

function notas(dir) {
  const salida = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue; // .obsidian y similares
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) salida.push(...notas(ruta));
    else if (e.name.endsWith('.md')) salida.push(ruta);
  }
  return salida;
}

/** Documentos de la bóveda, más las notas que no se cargan y por qué, y los errores de cabecera. */
export function leerBoveda(dir = BOVEDA) {
  const docs = [];
  const omitidas = [];
  const errores = [];
  const pendientes = [];
  for (const ruta of notas(dir).sort()) {
    const nombre = path.relative(dir, ruta);
    const { cabecera, cuerpo } = leerNota(fs.readFileSync(ruta, 'utf8'));
    if (cabecera.bot === 'false') { omitidas.push(`${nombre} (bot: false)`); continue; }
    if (!/^[a-z0-9_]+$/.test(cabecera.slug ?? '')) { errores.push(`${nombre}: falta slug (minúsculas, números y _)`); continue; }
    if (!CATEGORIAS.includes(cabecera.categoria)) { errores.push(`${nombre}: categoría "${cabecera.categoria}" no válida (${CATEGORIAS.join(', ')})`); continue; }
    const { texto, pendientes: p } = limpiarCuerpo(cuerpo);
    for (const l of p) pendientes.push(`${nombre}: ${l}`);
    if (!tieneDatos(texto)) { omitidas.push(`${nombre} (sin datos todavía)`); continue; }
    docs.push({
      slug: cabecera.slug, titulo: cabecera.titulo || path.basename(ruta, '.md'), categoria: cabecera.categoria,
      fuente: 'john', url_fuente: null, contenido_md: texto, nota: nombre,
    });
  }
  const repetidos = docs.map((d) => d.slug).filter((s, i, a) => a.indexOf(s) !== i);
  for (const s of new Set(repetidos)) errores.push(`slug repetido: ${s}`);
  return { docs, omitidas, errores, pendientes };
}

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  if (!process.env.DATABASE_URL) { console.error('Falta DATABASE_URL.'); process.exit(1); }
  const seco = process.argv.includes('--seco');
  const sinWeb = process.argv.includes('--sin-web');
  const q = neon(process.env.DATABASE_URL);
  const { docs, omitidas, errores, pendientes } = leerBoveda();
  if (errores.length) {
    console.error(`La bóveda tiene errores; no se carga nada:\n  · ${errores.join('\n  · ')}`);
    process.exit(1);
  }
  console.log(`Bóveda: ${docs.length} notas (${docs.map((d) => d.slug).join(', ')}).`);
  if (omitidas.length) console.log(`No se cargan: ${omitidas.join(', ')}.`);
  console.log(`Líneas pendientes de John (no se cargan): ${pendientes.length}.`);
  for (const l of pendientes) console.log(`  · ${l.slice(0, 150)}`);
  const web = sinWeb ? [] : await copiarWeb();
  if (web.length) console.log(`Web: ${web.map((d) => `${d.slug} (${d.contenido_md.length} caracteres)`).join(', ')}.`);
  // Notas cambiadas o creadas desde el canal admin de WhatsApp y distintas de la bóveda: no se pisan ni se desactivan
  // salvo con --forzar. Se enseña su texto para copiarlo a la bóveda.
  const forzar = process.argv.includes('--forzar');
  const deWhatsapp = await q.query(`SELECT slug, contenido_md FROM kb_documents WHERE actualizado_por = 'admin-whatsapp' AND activo`);
  const conflictos = deWhatsapp.filter((w) => !docs.some((d) => d.slug === w.slug && d.contenido_md === w.contenido_md));
  if (conflictos.length && !forzar) {
    console.log('\nEstas notas se cambiaron desde WhatsApp y no coinciden con la bóveda. No se tocan (copia el texto a la bóveda o usa --forzar):');
    for (const c of conflictos) console.log(`\n--- ${c.slug} (en el bot ahora)\n${c.contenido_md}`);
    const omitir = new Set(conflictos.map((c) => c.slug));
    for (let i = docs.length - 1; i >= 0; i -= 1) if (omitir.has(docs[i].slug)) docs.splice(i, 1);
  }
  const todos = [...docs, ...web];
  const slugsJohn = [...docs.map((d) => d.slug), ...(forzar ? [] : conflictos.map((c) => c.slug))];
  const sobran = await q.query(`SELECT slug FROM kb_documents WHERE fuente = 'john' AND activo AND NOT (slug = ANY($1))`, [slugsJohn]);
  if (sobran.length) console.log(`Ya no están en la bóveda (se desactivan): ${sobran.map((s) => s.slug).join(', ')}.`);
  if (seco) {
    console.log('\n(--seco: no se ha escrito nada)');
    process.exit(0);
  }

  let nuevos = 0;
  let cambiados = 0;
  for (const d of todos) {
    const [r] = await q.query(
      `INSERT INTO kb_documents (slug, titulo, categoria, contenido_md, fuente, url_fuente, actualizado_por)
       VALUES ($1, $2, $3, $4, $5, $6, 'kb-sincronizar')
       ON CONFLICT (slug) DO UPDATE SET titulo = EXCLUDED.titulo, categoria = EXCLUDED.categoria,
         contenido_md = EXCLUDED.contenido_md, fuente = EXCLUDED.fuente, url_fuente = EXCLUDED.url_fuente,
         actualizado_por = EXCLUDED.actualizado_por, activo = true
       WHERE (kb_documents.titulo, kb_documents.categoria, kb_documents.contenido_md, kb_documents.fuente, kb_documents.url_fuente, kb_documents.activo)
             IS DISTINCT FROM (EXCLUDED.titulo, EXCLUDED.categoria, EXCLUDED.contenido_md, EXCLUDED.fuente, EXCLUDED.url_fuente, true)
       RETURNING (xmax = 0) AS nuevo`,
      [d.slug, d.titulo, d.categoria, d.contenido_md, d.fuente, d.url_fuente]);
    if (r?.nuevo) nuevos += 1;
    else if (r) cambiados += 1;
  }
  if (sobran.length) {
    await q.query(`UPDATE kb_documents SET activo = false, actualizado_por = 'kb-sincronizar' WHERE fuente = 'john' AND NOT (slug = ANY($1))`, [slugsJohn]);
  }
  console.log(`\nkb_documents: ${nuevos} nuevos, ${cambiados} actualizados, ${todos.length - nuevos - cambiados} sin cambios, ${sobran.length} desactivados.`);
}
