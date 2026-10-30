// Genera el carrusel post-carrera de RUKC a partir de una carpeta de carrera.
// Uso: node generar.mjs <carpeta-carrera>
//
// Lee:  <carpeta>/datos/ronda.json   (datos de la web: node datos-web.mjs <carpeta> <ronda>)
//       <carpeta>/carrusel.json      (qué foto va en cada slide; si no existe se crea una plantilla)
//       <carpeta>/datos/instagram.json  (opcional: { "38": "@usuario" } para etiquetar en la descripción)
// Escribe, según carrusel.json → "modo":
//   "por-categoria" (por defecto): un post por categoría y, si hay bloque "destacados", un tercer post de fotos y clips.
//     Las carpetas van numeradas en orden de publicación: salida/1-pesados, salida/2-destacados, salida/3-ligeros
//     (la última categoría primero, destacados en medio), para que la fila del perfil se lea Ligeros | Destacados | Pesados.
//   "unico": un solo post con todas las categorías en <carpeta>/salida/NN_tipo.png + descripcion.txt
// Cada post: NN_tipo.png (slides con texto), NN_foto.jpg (fotos a sangre), NN_clip.mp4 (clips 4:5) + descripcion.txt
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SISTEMA } from '../slides/comun.mjs';
import portada from '../slides/portada.mjs';
import portadaCategoria from '../slides/portada-categoria.mjs';
import apertura from '../slides/apertura.mjs';
import podio from '../slides/podio.mjs';
import resultados from '../slides/resultados.mjs';
import clasificacion from '../slides/clasificacion.mjs';
import fotos from '../slides/fotos.mjs';
import portadaDestacados from '../slides/portada-destacados.mjs';
import fotoCompleta from '../slides/foto-completa.mjs';
import { buscarFfmpeg, cortarClip } from './clips.mjs';
import proxima from '../slides/proxima.mjs';
import { descripcion, descripcionDestacados } from './descripcion.mjs';

const MAX_FILAS = 10;
const MAX_SLIDES = 20; // límite de Instagram por carrusel
const carpeta = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !fs.existsSync(carpeta)) {
  console.error('Uso: node generar.mjs <carpeta-carrera>');
  process.exit(1);
}

const leerJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const fDatos = path.join(carpeta, 'datos', 'ronda.json');
if (!fs.existsSync(fDatos)) {
  console.error(`No existe ${fDatos}. Descárgalo con: node datos-web.mjs "${carpeta}" <numero-ronda>`);
  process.exit(1);
}
const datos = leerJson(fDatos);
const cal = leerJson(path.join(SISTEMA, 'calendario.json'));
const enCal = cal.rondas.find((r) => r.ronda === datos.ronda);
if (!enCal) {
  console.error(`La ronda ${datos.ronda} no está en calendario.json.`);
  process.exit(1);
}
const avisos = [];
if (datos.circuito && datos.circuito !== enCal.circuito) avisos.push(`El circuito de la web ("${datos.circuito}") no coincide con el calendario ("${enCal.circuito}"). Se usa el del calendario.`);
if (datos.aviso) avisos.push(`La web avisa: ${datos.aviso}`);
const siguiente = cal.rondas.find((r) => r.ronda === datos.ronda + 1) ?? null;

// Selección de fotos. Si no existe, se crea una plantilla para rellenar y se sigue con huecos visibles.
const fCarrusel = path.join(carpeta, 'carrusel.json');
if (!fs.existsSync(fCarrusel)) {
  const plantilla = {
    modo: 'por-categoria',
    categorias: Object.fromEntries(datos.categorias.map((c) => [c.nombre, { portada: null, apertura: null, podio: null, galeria: [] }])),
    proxima: null,
  };
  fs.writeFileSync(fCarrusel, JSON.stringify(plantilla, null, 2) + '\n', 'utf8');
  avisos.push(`No había carrusel.json: se ha creado ${fCarrusel}. Rellénalo con las fotos.`);
}
const carrusel = leerJson(fCarrusel);
const modo = carrusel.modo ?? 'por-categoria';
const comprobarFoto = (f, donde) => {
  if (!f) return null;
  const archivo = typeof f === 'string' ? f : f.archivo;
  if (!fs.existsSync(path.resolve(carpeta, archivo))) {
    avisos.push(`No existe la foto ${archivo} (${donde}).`);
    return null;
  }
  return f;
};

// Reparto equilibrado en páginas de como mucho MAX_FILAS filas.
const paginar = (filas) => {
  const n = Math.max(1, Math.ceil(filas.length / MAX_FILAS));
  const tam = Math.ceil(filas.length / n);
  return Array.from({ length: n }, (_, i) => filas.slice(i * tam, (i + 1) * tam));
};

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');

// Bloque de slides de una categoría: la carrera, podio, resultados, campeonato y fotos.
// `pref` antepone la categoría al nombre del archivo cuando todas van en el mismo post.
const bloqueCategoria = (c, pref) => {
  const sel = carrusel.categorias?.[c.nombre] ?? {};
  const k = pref ? `${slug(c.nombre)}-` : '';
  const out = [];
  if (sel.apertura) out.push({ tipo: `${k}carrera`, fn: apertura, args: { categoria: c.nombre, foto: comprobarFoto(sel.apertura, `carrera ${c.nombre}`) } });
  if (!sel.podio) avisos.push(`Falta la foto del podio de ${c.nombre} en carrusel.json.`);
  out.push({ tipo: `${k}podio`, fn: podio, args: { categoria: c.nombre, foto: comprobarFoto(sel.podio, `podio ${c.nombre}`) } });
  if (!c.resultados?.length) avisos.push(`No hay resultados de ${c.nombre}.`);
  const pr = paginar(c.resultados ?? []);
  pr.forEach((filas, i) => out.push({ tipo: `${k}resultados${pr.length > 1 ? `-${i + 1}` : ''}`, fn: resultados, args: { categoria: c.nombre, filas, pagina: i + 1, paginas: pr.length } }));
  if (!c.clasificacion?.length) avisos.push(`No hay clasificación del campeonato de ${c.nombre}: la slide sale con hueco.`);
  const pc = paginar(c.clasificacion ?? []);
  pc.forEach((filas, i) => out.push({ tipo: `${k}campeonato${pc.length > 1 ? `-${i + 1}` : ''}`, fn: clasificacion, args: { categoria: c.nombre, filas, pagina: i + 1, paginas: pc.length } }));
  if (carrusel.destacados && sel.galeria?.length) avisos.push(`Hay galería en ${c.nombre} y también post de destacados: la galería no se genera (las fotos van en destacados).`);
  if (!carrusel.destacados) (sel.galeria ?? []).forEach((g, i) => {
    const lista = (g.fotos ?? []).map((f) => comprobarFoto(f, `galería ${c.nombre}`));
    out.push({ tipo: `${k}fotos${sel.galeria.length > 1 ? `-${i + 1}` : ''}`, fn: fotos, args: { categoria: c.nombre, fotos: lista, disposicion: g.disposicion } });
  });
  return out;
};
const cierre = () => (siguiente ? [{ tipo: 'proxima', fn: proxima, args: { foto: comprobarFoto(carrusel.proxima, 'próxima ronda'), siguiente } }] : []);

// Posts a generar: cada uno con su carpeta de salida, sus slides y las categorías de su descripción.
const salida = path.join(carpeta, 'salida');
const posts = [];
if (modo === 'unico') {
  if (!carrusel.portada) avisos.push('Falta la foto de portada en carrusel.json.');
  posts.push({
    dir: salida,
    categorias: datos.categorias,
    plan: [
      { tipo: 'portada', fn: portada, args: { foto: comprobarFoto(carrusel.portada, 'portada') } },
      ...datos.categorias.flatMap((c) => bloqueCategoria(c, true)),
      ...cierre(),
    ],
  });
} else {
  for (const c of datos.categorias) {
    const sel = carrusel.categorias?.[c.nombre] ?? {};
    if (!sel.portada) avisos.push(`Falta la foto de portada de ${c.nombre} en carrusel.json.`);
    posts.push({
      nombre: slug(c.nombre),
      categorias: [c],
      plan: [
        { tipo: 'portada', fn: portadaCategoria, args: { categoria: c.nombre, foto: comprobarFoto(sel.portada, `portada ${c.nombre}`) } },
        ...bloqueCategoria(c, false),
        ...cierre(),
      ],
    });
  }
  // Post de destacados: portada + fotos a sangre y clips, en el orden de "items".
  const d = carrusel.destacados;
  if (d) {
    if (!d.portada) avisos.push('Falta la foto de portada de destacados en carrusel.json.');
    const items = d.items ?? [];
    const nFotos = items.filter((x) => !x?.clip).length, nClips = items.length - nFotos;
    if (nFotos < 8 || nFotos > 12) avisos.push(`Destacados lleva ${nFotos} fotos (lo previsto es 8-12).`);
    if (nClips > 3) avisos.push(`Destacados lleva ${nClips} clips (lo previsto es 2-3).`);
    const plan = [{ tipo: 'portada', fn: portadaDestacados, args: { foto: comprobarFoto(d.portada, 'portada destacados') } }];
    for (const it of items) {
      if (it?.clip) {
        const origen = path.resolve(carpeta, it.clip);
        if (!fs.existsSync(origen)) avisos.push(`No existe el clip ${it.clip}.`);
        else plan.push({ tipo: 'clip', clip: { ...it, origen } });
      } else {
        const f = comprobarFoto(it, 'destacados');
        if (f) plan.push({ tipo: 'foto', fn: fotoCompleta, args: { foto: f }, jpg: true });
      }
    }
    // Orden de publicación: la última categoría primero y destacados en medio.
    posts.reverse();
    posts.splice(Math.floor(posts.length / 2), 0, { nombre: 'destacados', categorias: datos.categorias, destacados: true, plan });
  } else posts.reverse();
  posts.forEach((p, i) => { p.dir = path.join(salida, `${i + 1}-${p.nombre}`); });
  for (const p of posts) if (p.plan.length > MAX_SLIDES) avisos.push(`${p.nombre}: ${p.plan.length} slides; Instagram admite ${MAX_SLIDES} como mucho.`);
}

// Limpieza de salidas anteriores (solo lo que genera este script).
// Se vacían salida/ y sus carpetas de post (numeradas o con el nombre antiguo, sin número);
// las carpetas de post que quedan vacías se borran.
const generado = (f) => /^\d\d_.*\.(png|jpg|mp4)$/.test(f) || f === 'descripcion.txt';
const limpiar = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) if (generado(f)) fs.unlinkSync(path.join(dir, f));
};
limpiar(salida);
const nombresPost = new Set([...datos.categorias.map((c) => slug(c.nombre)), 'destacados']);
if (fs.existsSync(salida)) for (const d of fs.readdirSync(salida)) {
  const dir = path.join(salida, d);
  if (!fs.statSync(dir).isDirectory() || !nombresPost.has(d.replace(/^\d+-/, ''))) continue;
  limpiar(dir);
  if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
}
const hayClips = posts.some((p) => p.plan.some((s) => s.tipo === 'clip'));
const ffmpeg = hayClips ? buscarFfmpeg() : null;
if (hayClips && !ffmpeg) avisos.push('No se encuentra ffmpeg: los clips no se generan. Instálalo (winget install Gyan.FFmpeg) o indica su ruta en la variable FFMPEG.');

// Render.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rukc-post-'));
const ronda = { ...datos, titular: enCal.titular, fecha: enCal.fecha, circuito: enCal.circuito };
const fIg = path.join(carpeta, 'datos', 'instagram.json');
const instagram = fs.existsSync(fIg) ? leerJson(fIg) : {};
if (!Object.keys(instagram).length) avisos.push('Sin datos/instagram.json: la descripción no etiqueta a ningún piloto.');

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
const hechos = [];
for (const post of posts) {
  fs.mkdirSync(post.dir, { recursive: true });
  for (const [i, s] of post.plan.entries()) {
    const ctx = { carpeta, ronda, cal, avisos, slide: i + 1, totalSlides: post.plan.length };
    const nombre = `${String(i + 1).padStart(2, '0')}_${s.tipo}`;
    const etiqueta = path.relative(salida, path.join(post.dir, nombre)) || nombre;
    if (s.tipo === 'clip') {
      if (!ffmpeg) continue;
      const mp4 = path.join(post.dir, `${nombre}.mp4`);
      console.log(`  cortando ${path.basename(s.clip.origen)} (desde ${s.clip.inicio ?? 0} s, ${s.clip.duracion ?? 6} s)...`);
      cortarClip({ ffmpeg, origen: s.clip.origen, c: s.clip, destino: mp4, cache: path.join(carpeta, 'datos', 'clips') }).forEach((a) => avisos.push(`${etiqueta}: ${a}`));
      hechos.push(mp4);
      continue;
    }
    const html = path.join(tmp, `${etiqueta.replace(/[\\/]/g, '_')}.html`);
    fs.writeFileSync(html, s.fn(ctx, s.args), 'utf8');
    await page.goto(pathToFileURL(html).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every((im) => im.complete));
    // Titulares largos y nombres: se reducen hasta caber en el ancho.
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-ajustar]')) {
        let t = parseFloat(getComputedStyle(el).fontSize);
        while (el.scrollWidth > el.clientWidth + 1 && t > 64) { t -= 2; el.style.fontSize = `${t}px`; }
      }
      // Líneas opcionales (p. ej. los ganadores en la portada de destacados): si no caben, se quitan.
      for (const el of document.querySelectorAll('[data-opcional]')) if (el.scrollWidth > el.clientWidth + 1) el.remove();
      for (const el of document.querySelectorAll('.nombre')) {
        let t = parseFloat(getComputedStyle(el).fontSize);
        while (el.scrollWidth > el.clientWidth + 1 && t > 30) { t -= 1; el.style.fontSize = `${t}px`; }
      }
    });
    // Control de calidad: textos pequeños, recortados, fuera del margen seguro o del lienzo.
    const qa = await page.evaluate(() => {
      const problemas = [];
      const pieArriba = document.querySelector('.pie')?.getBoundingClientRect().top ?? 1350;
      for (const el of document.querySelectorAll('body *:not(style):not(script)')) {
        const propio = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        const cs = getComputedStyle(el);
        if (propio && parseFloat(cs.fontSize) < 28) problemas.push(`texto de ${cs.fontSize}: "${el.textContent.trim().slice(0, 40)}"`);
        if (el.matches('.nombre, [data-ajustar]') && el.scrollWidth > el.clientWidth + 1) problemas.push(`texto recortado: "${el.textContent.trim()}"`);
        const r = el.getBoundingClientRect();
        if (propio && (r.right > 1080 - 60 || r.left < 60) && r.width > 0) problemas.push(`texto fuera del margen seguro 3:4: "${el.textContent.trim().slice(0, 40)}"`);
        if (r.bottom > 1350 + 1 && r.height > 0) problemas.push(`elemento por debajo del lienzo: ${el.className || el.tagName}`);
        if (propio && !el.closest('.pie') && r.bottom > pieArriba - 8) problemas.push(`texto encima del pie: "${el.textContent.trim().slice(0, 40)}"`);
      }
      return problemas;
    });
    qa.forEach((p) => avisos.push(`${etiqueta}: ${p}`));
    const img = path.join(post.dir, `${nombre}.${s.jpg ? 'jpg' : 'png'}`);
    await page.screenshot({ path: img, clip: { x: 0, y: 0, width: 1080, height: 1350 }, ...(s.jpg ? { type: 'jpeg', quality: 92 } : {}) });
    hechos.push(img);
  }
  const texto = post.destacados
    ? descripcionDestacados({ ronda, siguiente, avisos })
    : descripcion({ ronda: { ...ronda, categorias: post.categorias }, todas: ronda.categorias, siguiente, instagram, avisos });
  fs.writeFileSync(path.join(post.dir, 'descripcion.txt'), texto, 'utf8');
  hechos.push(path.join(post.dir, 'descripcion.txt'));
}
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`${posts.length} post(s) en ${salida}`);
hechos.forEach((h) => console.log(`  ${path.relative(salida, h)}`));
if (avisos.length) {
  console.log('\nAVISOS:');
  [...new Set(avisos)].forEach((a) => console.log(`  - ${a}`));
}
