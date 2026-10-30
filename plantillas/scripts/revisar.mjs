// Monta las slides generadas para revisarlas: 3 por imagen, a 640 px de ancho cada una,
// y cada portada tal como se ve en la cuadrícula del perfil (recorte 3:4, miniatura de 300 px).
// Los clips (.mp4) se muestran con un fotograma de su mitad y la marca "CLIP".
// Con varios posts numerados (salida/1-pesados, 2-destacados, 3-ligeros) monta además
// fila-cuadricula.png: las portadas como quedan en la fila del perfil una vez publicadas
// (la última publicada, a la izquierda: Ligeros | Destacados | Pesados).
// Uso: node revisar.mjs <carpeta-carrera> [carpeta-destino]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buscarFfmpeg, fotograma, info } from './clips.mjs';

const carpeta = path.resolve(process.argv[2] ?? '');
const salida = path.join(carpeta, 'salida');
if (!process.argv[2] || !fs.existsSync(salida)) {
  console.error('Uso: node revisar.mjs <carpeta-carrera> [carpeta-destino]  (antes, genera con generar.mjs)');
  process.exit(1);
}
const destino = path.resolve(process.argv[3] ?? path.join(os.tmpdir(), `rukc-revision-${path.basename(carpeta)}`));
fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(destino, { recursive: true });

const esSlide = (f) => /^\d\d_.*\.(png|jpg|mp4)$/.test(f);
const posts = [salida, ...fs.readdirSync(salida).map((d) => path.join(salida, d)).filter((d) => fs.statSync(d).isDirectory())]
  .map((dir) => ({ dir, nombre: path.relative(salida, dir) || 'post', archivos: fs.readdirSync(dir).filter(esSlide).sort() }))
  .filter((p) => p.archivos.length);

// Fotograma de cada clip, para verlo en la revisión.
const ffmpeg = posts.some((p) => p.archivos.some((f) => f.endsWith('.mp4'))) ? buscarFfmpeg() : null;
const imagen = (p, f) => {
  if (!f.endsWith('.mp4')) return { src: pathToFileURL(path.join(p.dir, f)).href, clip: false };
  if (!ffmpeg) return { src: '', clip: true };
  const mp4 = path.join(p.dir, f);
  const jpg = path.join(destino, `${p.nombre}-${f.replace(/\.mp4$/, '')}-fotograma.jpg`);
  fotograma(ffmpeg, mp4, (info(ffmpeg, mp4).duracion / 2).toFixed(2), jpg);
  return { src: pathToFileURL(jpg).href, clip: true };
};
const marco = (im, ancho, alto) => `<div style="position:relative;width:${ancho}px;height:${alto}px;background:#000">${im.src ? `<img src="${im.src}" width="${ancho}" height="${alto}">` : ''}${im.clip ? '<b style="position:absolute;left:12px;top:12px;background:#fff;color:#000;font:700 22px system-ui;padding:4px 10px">CLIP</b>' : ''}</div>`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const hechos = [];
const montar = async (nombre, html, ancho, alto) => {
  const tmp = path.join(destino, `${nombre}.html`);
  fs.writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#555;display:flex;gap:12px;padding:6px}img{display:block}</style>${html}`, 'utf8');
  await page.setViewportSize({ width: ancho, height: alto });
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
  const png = path.join(destino, `${nombre}.png`);
  await page.screenshot({ path: png });
  fs.unlinkSync(tmp);
  hechos.push(png);
};
// Recorte central 1012x1350 (3:4) reducido a 300x400, como la miniatura del perfil.
const miniatura = (src) => `<div style="width:300px;height:400px;overflow:hidden;flex:none"><img src="${src}" style="width:320px;height:400px;margin-left:-10px"></div>`;
for (const p of posts) {
  for (let i = 0; i < p.archivos.length; i += 3) {
    const trio = p.archivos.slice(i, i + 3);
    await montar(`${p.nombre}-revision-${String(i / 3 + 1).padStart(2, '0')}`, trio.map((f) => marco(imagen(p, f), 640, 800)).join(''), 1956, 812);
  }
  await montar(`${p.nombre}-portada-cuadricula`, miniatura(pathToFileURL(path.join(p.dir, p.archivos[0])).href), 312, 412);
}
const numerados = posts.filter((p) => /^\d+-/.test(p.nombre)).sort((a, b) => parseInt(b.nombre) - parseInt(a.nombre));
if (numerados.length > 1) {
  await montar('fila-cuadricula', `<div style="display:flex;gap:3px">${numerados.map((p) => miniatura(pathToFileURL(path.join(p.dir, p.archivos[0])).href)).join('')}</div>`, 300 * numerados.length + 3 * (numerados.length - 1) + 12, 412);
}
await browser.close();
hechos.forEach((h) => console.log(h));
