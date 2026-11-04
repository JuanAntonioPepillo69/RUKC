// Carga y activa los documentos legales que se firman en el onboarding, sacados palabra por palabra del reglamento
// publicado (src/content/reglamento.html, versión 1.1), que revisó el abogado. Visto bueno: 4 de noviembre de 2026.
//   reglamento           el reglamento entero
//   asuncion_riesgos     Anexo D (D.1 piloto mayor de edad y D.2 autorización del tutor)
//   cesion_imagen        Art. 60 (imagen y vídeo)
//   consentimiento_peso  Art. 23 bis (peso de competición y pesaje, letra f) y Art. 59 (responsable y finalidades)
// Solo cambia el formato (HTML a texto con **negrita**, listas y tablas); las palabras son las del reglamento.
// Al activar una versión nueva se cierra la que estuviera vigente de ese tipo (también las de prueba) y los
// onboardings completados que no la tengan firmada pasan a requiere_actualizacion.
// Se puede repetir: no duplica nada. Si el texto de una versión ya activada cambia, se niega: hace falta otra versión.
// Uso: npm run db:documentos   (en producción, en la fase 7, con DATABASE_URL de producción)
import { Pool } from '@neondatabase/serverless';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activar } from '../lib/documentos.js';

export const VERSION = 'reglamento-v1.1';
export const REVISADO_ABOGADO = '2026-11-04';
const RUTA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', 'reglamento.html');

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const entidades = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e] ?? m);
const enLinea = (s) => s
  .replace(/<(strong|b)>(\s*)([\s\S]*?)(\s*)<\/\1>/g, (_, __, a, t, b) => (t ? `${a}**${t}**${b}` : `${a}${b}`))
  .replace(/<br\s*\/?>/g, '\n')
  .replace(/<\/?p[^>]*>/g, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/[ \t]+/g, ' ')
  .trim();

/** HTML del reglamento a texto para documento_legal.contenido_md, sin tocar las palabras. */
export function aTexto(html) {
  const t = html
    .replace(/<table[\s\S]*?<\/table>/g, (tabla) => `\n\n${[...tabla.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((f) => [...f[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => enLinea(c[1])).join(' | ')).join('\n')}\n\n`)
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/g, (_, l) => `\n\n${[...l.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((x, i) => `${i + 1}. ${enLinea(x[1])}`).join('\n')}\n\n`)
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/g, (_, l) => `\n\n${[...l.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((x) => `- ${enLinea(x[1])}`).join('\n')}\n\n`)
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g, (_, x) => `\n\n## ${enLinea(x)}\n\n`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/g, (_, x) => `\n\n${enLinea(x)}\n\n`)
    .replace(/<\/?div[^>]*>/g, '\n\n');
  return entidades(t.replace(/<[^>]+>/g, ''))
    .split('\n').map((l) => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Trozo del HTML desde el elemento con ese id hasta el siguiente que cumpla `fin` (o el final). */
function trozo(html, id, fin) {
  const marca = html.indexOf(`id="${id}"`);
  if (marca < 0) throw new Error(`No encuentro "${id}" en el reglamento.`);
  const inicio = html.lastIndexOf('<', marca);
  fin.lastIndex = marca;
  const m = fin.exec(html);
  return html.slice(inicio, m ? m.index : html.length);
}

/** Los cuatro documentos, con su texto. */
export function documentos(html = fs.readFileSync(RUTA, 'utf8')) {
  if (!html.includes('Registro de cambios (v1.0 → v1.1)')) throw new Error('El reglamento publicado no es la versión 1.1: revisa VERSION antes de cargar.');
  const articulo = /<p id="art-|<h2/g;
  const seccion = /<h2/g;
  return [
    { tipo: 'reglamento', titulo: 'Reglamento RUKC (versión 1.1)', revocable: false, obligatorio: true, texto: aTexto(html) },
    { tipo: 'asuncion_riesgos', titulo: 'Documento de información y asunción de riesgos (Anexo D del reglamento)', revocable: false, obligatorio: true,
      texto: aTexto(trozo(html, 'anexo-d-documento-de-informacion-y-asuncion-de-riesgos', seccion)) },
    { tipo: 'cesion_imagen', titulo: 'Imagen y vídeo (Art. 60 del reglamento)', revocable: true, obligatorio: true,
      texto: aTexto(trozo(html, 'art-60', articulo)) },
    { tipo: 'consentimiento_peso', titulo: 'Pesaje y datos de peso (Arts. 23 bis y 59 del reglamento)', revocable: true, obligatorio: false,
      texto: `${aTexto(trozo(html, 'art-23-bis', articulo))}\n\n${aTexto(trozo(html, 'art-59', articulo))}` },
  ];
}

/** Carga y activa los documentos con el cliente `c` dentro de una transacción. Devuelve un resumen por tipo. */
export async function cargarDocumentos(c) {
  const resumen = [];
  let requieren = 0;
  for (const d of documentos()) {
    const hash = crypto.createHash('sha256').update(d.texto).digest('hex');
    const { rows: [ya] } = await c.query('SELECT id, hash_sha256, vigente_desde FROM documento_legal WHERE tipo = $1 AND version = $2', [d.tipo, VERSION]);
    let id = ya?.id;
    if (ya && ya.hash_sha256 !== hash) {
      if (ya.vigente_desde) throw new Error(`${d.tipo} ${VERSION} ya está activado con otro texto: crea una versión nueva.`);
      await c.query('UPDATE documento_legal SET titulo = $2, contenido_md = $3 WHERE id = $1', [id, d.titulo, d.texto]);
    }
    if (!ya) {
      ({ rows: [{ id }] } = await c.query(`INSERT INTO documento_legal (tipo, version, titulo, contenido_md, obligatorio_onboarding, revocable, revisado_abogado_en, creado_por)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'sistema') RETURNING id`, [d.tipo, VERSION, d.titulo, d.texto, d.obligatorio, d.revocable, REVISADO_ABOGADO]));
    }
    if (ya?.vigente_desde) { resumen.push(`${d.tipo}: ya vigente`); continue; }
    const a = await activar(c, id);
    requieren += a.requieren_firma;
    resumen.push(`${d.tipo}: activado ${VERSION} (${d.texto.length} caracteres)${a.cerradas.length ? `, cierra ${a.cerradas.join(', ')}` : ''}`);
  }
  if (resumen.some((l) => l.includes('activado'))) resumen.push(`onboardings completados que tienen que firmar la versión nueva: ${requieren}`);
  return resumen;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('rukc.actor', 'sistema', true)");
    const resumen = await cargarDocumentos(c);
    await c.query('COMMIT');
    for (const l of resumen) console.log(l);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
}
