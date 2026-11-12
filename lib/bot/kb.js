// Base de conocimiento del bot (especificación, sección 3c).
// - Los documentos activos de kb_documents van enteros en el prompt, salvo la copia completa del reglamento
//   (fuente "reglamento") y la copia de la página de la temporada (calendario y clasificación: las fechas salen de
//   consultar_rondas), que se consultan con la herramienta buscar_conocimiento. Así cada mensaje gasta menos.
// - El calendario no está aquí: sale de la tabla de rondas con la herramienta consultar_rondas.
// - buscar_conocimiento busca por palabras en todos los documentos activos (reglamento incluido) y devuelve
//   fragmentos con su slug. Con este tamaño no hace falta un buscador.
// Sin dependencias de WhatsApp: lo reutiliza el chat web.

export const ORDEN_CATEGORIAS = ['liga', 'categorias', 'precios', 'politicas', 'dia_de_carrera', 'menores', 'enlaces',
  'faq', 'calendario', 'reglamento'];
const fueraDelPrompt = (d) => d.fuente === 'reglamento' || d.slug === 'web_season_2';

/** Documentos vigentes (activos y sin caducar). `q(texto, params)` devuelve filas. */
export async function leerDocumentos(q) {
  return q(
    `SELECT slug, titulo, categoria, contenido_md, fuente, url_fuente, version
     FROM kb_documents
     WHERE activo AND (vigente_hasta IS NULL OR vigente_hasta > now())
     ORDER BY slug`);
}

const ordenar = (docs) => [...docs].sort((a, b) =>
  (ORDEN_CATEGORIAS.indexOf(a.categoria) - ORDEN_CATEGORIAS.indexOf(b.categoria)) || a.slug.localeCompare(b.slug));

/** Texto de <conocimiento> para el prompt. Estable mientras no cambien los documentos (bueno para la caché). */
export function textoParaPrompt(docs) {
  return ordenar(docs.filter((d) => !fueraDelPrompt(d)))
    .map((d) => `<documento slug="${d.slug}" categoria="${d.categoria}" titulo="${d.titulo}">\n${d.contenido_md.trim()}\n</documento>`)
    .join('\n\n');
}

// --- Búsqueda -------------------------------------------------------------------------------------------------
const VACIAS = new Set(('a al algo como con cual cuando de del el en es esta este esto hay la las lo los me mi mis ' +
  'muy no o para pero por que qué se si sin sobre su sus te tu tus un una uno unos y ya yo').split(' '));

/** minúsculas, sin acentos ni signos; palabras de 3+ letras que no sean vacías. */
export function palabras(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9ñ]+/).filter((p) => p.length >= 3 && !VACIAS.has(p));
}

// Raíz muy simple para que "puntos" encuentre "punto", "clasificación" a "clasificacion", etc.
const raiz = (p) => p.replace(/(es|s)$/, '').slice(0, 7);

/** Parte un documento en fragmentos por títulos y párrafos, de hasta ~900 caracteres. */
export function fragmentar(doc, max = 900) {
  const bloques = doc.contenido_md.split(/\n(?=#)|\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const salida = [];
  let actual = '';
  let titulo = '';
  for (const b of bloques) {
    if (/^#/.test(b)) titulo = b.split('\n')[0].replace(/^#+\s*/, '');
    if (actual && actual.length + b.length + 2 > max) {
      salida.push(actual);
      actual = titulo && !b.startsWith('#') ? `(${titulo}) ` : '';
    }
    actual = actual ? `${actual}\n\n${b}` : b;
    while (actual.length > max * 1.5) {
      salida.push(actual.slice(0, max));
      actual = actual.slice(max);
    }
  }
  if (actual) salida.push(actual);
  return salida.map((texto) => ({ slug: doc.slug, titulo: doc.titulo, categoria: doc.categoria, url_fuente: doc.url_fuente, texto }));
}

/** Los `n` fragmentos con más coincidencias con la consulta. Si se da categoría, solo de esa categoría. */
export function buscar(docs, consulta, { categoria = null, n = 4 } = {}) {
  const buscadas = [...new Set(palabras(consulta).map(raiz))];
  if (!buscadas.length) return [];
  const candidatos = docs.filter((d) => !categoria || d.categoria === categoria).flatMap((d) => fragmentar(d));
  return candidatos
    .map((f) => {
      const enTexto = palabras(`${f.titulo} ${f.texto}`).map(raiz);
      const cuenta = new Map();
      for (const p of enTexto) cuenta.set(p, (cuenta.get(p) || 0) + 1);
      const distintas = buscadas.filter((p) => cuenta.has(p)).length;
      const total = buscadas.reduce((s, p) => s + Math.min(cuenta.get(p) || 0, 3), 0);
      return { ...f, puntos: distintas * 10 + total };
    })
    .filter((f) => f.puntos >= 10)
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, n)
    .map(({ puntos, ...f }) => f);
}
