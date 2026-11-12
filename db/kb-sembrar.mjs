// Carga inicial de la base de conocimiento del bot (kb_documents). Se puede repetir: actualiza por slug y, si el
// contenido cambia, kb_documents guarda la versión anterior en kb_document_versions.
// Fuentes:
//   1. docs/kb-semilla.md: cada sección "## Título (slug: x)" es un documento. No se cargan las líneas que sigan
//      teniendo "[JOHN: ...]" (el bot escalará esas preguntas). El calendario no se carga: sale de la tabla de
//      rondas; el script solo comprueba que el de la semilla coincide con la base de datos.
//   2. Copia de raceupkc.com: /, /season-2, /reglamento y /condiciones-reserva (texto, sin menús ni scripts).
//      El reglamento completo se guarda con fuente "reglamento": no va en el prompt, se consulta con
//      buscar_conocimiento.
// Uso:  npm run bot:kb             (DATABASE_URL de .env)
//       npm run bot:kb -- --seco   (solo enseña qué cargaría)
//       node --env-file=.env.produccion db/kb-sembrar.mjs   (producción, con el OK de John)
import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEMILLA = path.join(RAIZ, 'docs', 'kb-semilla.md');
const WEB = process.env.RUKC_WEB_ORIGEN || 'https://raceupkc.com';
const seco = process.argv.includes('--seco');

const CATEGORIA = {
  liga: 'liga', categorias: 'categorias', dia_de_carrera: 'dia_de_carrera', puntos: 'reglamento', calendario: 'calendario',
  precios: 'precios', politicas: 'politicas', menores: 'menores', enlaces: 'enlaces', faq: 'faq',
};
const PAGINAS = [
  { slug: 'web_portada', titulo: 'Web: portada de raceupkc.com', ruta: '/', categoria: 'liga', fuente: 'web' },
  { slug: 'web_season_2', titulo: 'Web: Temporada 2, calendario y clasificación', ruta: '/season-2', categoria: 'liga', fuente: 'web' },
  { slug: 'web_reglamento', titulo: 'Reglamento completo (web)', ruta: '/reglamento', categoria: 'reglamento', fuente: 'reglamento' },
  { slug: 'web_condiciones_reserva', titulo: 'Web: condiciones de la reserva', ruta: '/condiciones-reserva', categoria: 'politicas', fuente: 'web' },
];

// --- Semilla ---------------------------------------------------------------------------------------------------------
/** Documentos de la semilla. Devuelve también las líneas descartadas por tener [JOHN: ...]. */
export function leerSemilla(texto) {
  const docs = [];
  const descartadas = [];
  let actual = null;
  for (const linea of texto.split(/\r?\n/)) {
    const h = linea.match(/^##\s+(.+?)\s*\(slug:\s*([a-z0-9_]+)\)\s*$/);
    if (h) {
      actual = { slug: h[2], titulo: h[1].trim(), lineas: [] };
      docs.push(actual);
      continue;
    }
    if (!actual || /^---\s*$/.test(linea)) continue;
    if (/\[JOHN:/i.test(linea)) { descartadas.push(`${actual.slug}: ${linea.trim()}`); continue; }
    if (/^Nota para Claude Code/i.test(linea.trim())) continue;
    actual.lineas.push(linea);
  }
  return {
    docs: docs.map((d) => ({
      slug: d.slug, titulo: d.titulo, categoria: CATEGORIA[d.slug] ?? 'liga', fuente: 'john', url_fuente: null,
      contenido_md: d.lineas.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    })),
    descartadas,
  };
}

/** Un documento solo se carga si le queda algún dato (una línea de lista) después de quitar lo pendiente. */
const tieneDatos = (d) => /^\s*-\s+\S/m.test(d.contenido_md);

// --- Web -------------------------------------------------------------------------------------------------------------
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', middot: '·', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»' };

/** HTML → texto con títulos en markdown. Quita scripts, estilos, svg, menús, cabecera y pie. */
export function htmlATexto(html) {
  let t = String(html);
  const main = t.match(/<main[\s\S]*?<\/main>/i);
  if (main) t = main[0];
  t = t.replace(/<(script|style|noscript|svg|template|nav|header|footer|form|button|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, x) => `\n\n${'#'.repeat(Number(n) + 1 > 6 ? 6 : Number(n) + 1)} ${x}\n\n`)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|ul|ol|table|tr|li|dd|dt|blockquote)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' · ')
    .replace(/<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, x) => `${x} (${href})`)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTIDADES[e.toLowerCase()] ?? m;
    });
  return t.split('\n').map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l, i, a) => l && !(l === '-' || l === '·') && !(l.startsWith('#') && a[i + 1]?.startsWith('#') && l === a[i + 1]))
    .join('\n')
    .replace(/(^|\n)(#+ [^\n]+)/g, '$1\n$2')
    .replace(/ · (\n|$)/g, '$1')
    .trim();
}

export async function copiarWeb() {
  const salida = [];
  for (const p of PAGINAS) {
    const url = `${WEB}${p.ruta}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'rukc-kb-sembrar' } });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    // Sin los enlaces de WhatsApp de la web (apuntan al número personal de John hasta el lanzamiento).
    const texto = htmlATexto(await r.text()).replace(/\s*\(https:\/\/(wa\.me|api\.whatsapp\.com)\/[^)]*\)/g, '');
    if (texto.length < 200) throw new Error(`${url}: el texto extraído es demasiado corto (${texto.length} caracteres)`);
    salida.push({ slug: p.slug, titulo: p.titulo, categoria: p.categoria, fuente: p.fuente, url_fuente: `https://raceupkc.com${p.ruta}`, contenido_md: texto });
  }
  return salida;
}

// --- Calendario --------------------------------------------------------------------------------------------------------
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Rondas de la sección de calendario de la semilla: [{ numero, fecha, circuito }]. */
export function calendarioSemilla(texto) {
  return [...texto.matchAll(/^-\s*R(\d+)\s*·\s*\S+\s+(\d{1,2}) de (\w+) de (\d{4})\s*·\s*([^·\n]+)/gm)].map((m) => ({
    numero: Number(m[1]),
    fecha: `${m[4]}-${String(MESES[sinAcentos(m[3])]).padStart(2, '0')}-${m[2].padStart(2, '0')}`,
    circuito: m[5].replace(/\(.*\)/, '').trim(),
  }));
}

async function comprobarCalendario(q, texto) {
  const semilla = calendarioSemilla(texto);
  const bd = await q.query(
    `SELECT r.numero, r.fecha::text AS fecha, c.nombre AS circuito,
            r.hora_acreditacion IS NOT NULL AS acreditacion, r.hora_briefing IS NOT NULL AS briefing, r.maps_url IS NOT NULL AS maps
     FROM ronda r JOIN circuito c ON c.id = r.circuito_id JOIN temporada t ON t.id = r.temporada_id
     WHERE t.estado IN ('abierta', 'en_curso') ORDER BY r.numero`);
  const avisos = [];
  for (const s of semilla) {
    const r = bd.find((x) => x.numero === s.numero);
    if (!r) avisos.push(`R${s.numero}: no está en la base de datos`);
    else {
      if (r.fecha !== s.fecha) avisos.push(`R${s.numero}: fecha ${r.fecha} en la BD y ${s.fecha} en la semilla`);
      if (sinAcentos(r.circuito) !== sinAcentos(s.circuito)) avisos.push(`R${s.numero}: circuito "${r.circuito}" en la BD y "${s.circuito}" en la semilla`);
    }
  }
  for (const r of bd) if (!semilla.some((s) => s.numero === r.numero)) avisos.push(`R${r.numero}: está en la BD y no en la semilla`);
  const sinHoras = bd.filter((r) => !(r.acreditacion && r.briefing && r.maps)).map((r) => `R${r.numero}`);
  return { avisos, sinHoras, rondas: semilla.length };
}

// --- Principal -------------------------------------------------------------------------------------------------------
const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  if (!process.env.DATABASE_URL) { console.error('Falta DATABASE_URL.'); process.exit(1); }
  const q = neon(process.env.DATABASE_URL);
  const texto = fs.readFileSync(SEMILLA, 'utf8');
  const { docs, descartadas } = leerSemilla(texto);
  const deSemilla = docs.filter((d) => d.slug !== 'calendario' && tieneDatos(d));
  const vacios = docs.filter((d) => d.slug !== 'calendario' && !tieneDatos(d)).map((d) => d.slug);
  const web = await copiarWeb();
  const todos = [...deSemilla, ...web];

  console.log(`Semilla: ${deSemilla.length} documentos (${deSemilla.map((d) => d.slug).join(', ')}).`);
  if (vacios.length) console.log(`Sin datos todavía (no se cargan): ${vacios.join(', ')}.`);
  console.log(`Líneas pendientes de John (no se cargan): ${descartadas.length}.`);
  for (const l of descartadas) console.log(`  · ${l.slice(0, 140)}`);
  console.log(`Web: ${web.map((d) => `${d.slug} (${d.contenido_md.length} caracteres)`).join(', ')}.`);

  const cal = await comprobarCalendario(q, texto);
  console.log(cal.avisos.length ? `Calendario: NO coincide con la BD:\n  · ${cal.avisos.join('\n  · ')}` : `Calendario: las ${cal.rondas} rondas coinciden con la BD.`);
  if (cal.sinHoras.length) console.log(`Rondas sin hora de acreditación, briefing o Maps en la BD: ${cal.sinHoras.join(', ')}.`);

  if (seco) {
    console.log('\n(--seco: no se ha escrito nada)');
    process.exit(0);
  }
  let nuevos = 0;
  let cambiados = 0;
  for (const d of todos) {
    const [r] = await q.query(
      `INSERT INTO kb_documents (slug, titulo, categoria, contenido_md, fuente, url_fuente, actualizado_por)
       VALUES ($1, $2, $3, $4, $5, $6, 'kb-sembrar')
       ON CONFLICT (slug) DO UPDATE SET titulo = EXCLUDED.titulo, categoria = EXCLUDED.categoria,
         contenido_md = EXCLUDED.contenido_md, fuente = EXCLUDED.fuente, url_fuente = EXCLUDED.url_fuente,
         actualizado_por = EXCLUDED.actualizado_por, activo = true
       WHERE (kb_documents.titulo, kb_documents.categoria, kb_documents.contenido_md, kb_documents.fuente, kb_documents.url_fuente, kb_documents.activo)
             IS DISTINCT FROM (EXCLUDED.titulo, EXCLUDED.categoria, EXCLUDED.contenido_md, EXCLUDED.fuente, EXCLUDED.url_fuente, true)
       RETURNING (xmax = 0) AS nuevo, version`,
      [d.slug, d.titulo, d.categoria, d.contenido_md, d.fuente, d.url_fuente]);
    if (r?.nuevo) nuevos += 1;
    else if (r) cambiados += 1;
  }
  console.log(`\nkb_documents: ${nuevos} nuevos, ${cambiados} actualizados, ${todos.length - nuevos - cambiados} sin cambios.`);
}
