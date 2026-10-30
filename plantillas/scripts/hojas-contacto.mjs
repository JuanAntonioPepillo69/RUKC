// Prepara la elección de fotos de una carrera.
// Uso: node hojas-contacto.mjs <carpeta-carrera> [carpeta-destino]
// - Lee las fotos de la raíz de la carpeta y de podios/ (las subcarpetas de copias, como Comprimidas/, se ignoran).
// - Las ordena por hora (EXIF) y las agrupa en sesiones: un hueco de más de 45 min abre sesión nueva.
//   En RUKC cada categoría corre en su propia sesión, así que cada grupo suele ser una categoría.
// - Genera hojas de contacto (JPG, 6x5 miniaturas con nombre y hora) en el destino (por defecto, una carpeta temporal).
// No modifica ninguna foto.
import { chromium } from 'playwright';
import exifr from 'exifr';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const carpeta = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !fs.existsSync(carpeta)) {
  console.error('Uso: node hojas-contacto.mjs <carpeta-carrera> [carpeta-destino]');
  process.exit(1);
}
const destino = path.resolve(process.argv[3] ?? path.join(os.tmpdir(), `rukc-hojas-${path.basename(carpeta)}`));
fs.mkdirSync(destino, { recursive: true });

const esFoto = (f) => /\.(jpe?g|png|heic)$/i.test(f);
const archivos = [
  ...fs.readdirSync(carpeta).filter(esFoto),
  ...(fs.existsSync(path.join(carpeta, 'podios')) ? fs.readdirSync(path.join(carpeta, 'podios')).filter(esFoto).map((f) => `podios/${f}`) : []),
];

const fotos = [];
for (const rel of archivos) {
  let hora = null, orientacion = 1, ancho = null, alto = null;
  try {
    const e = await exifr.parse(path.join(carpeta, rel), ['DateTimeOriginal', 'CreateDate', 'Orientation', 'ExifImageWidth', 'ExifImageHeight']);
    hora = e?.DateTimeOriginal ?? e?.CreateDate ?? null;
    orientacion = typeof e?.Orientation === 'number' ? e.Orientation : /90|270/.test(String(e?.Orientation ?? '')) ? 6 : 1;
    ancho = e?.ExifImageWidth ?? null; alto = e?.ExifImageHeight ?? null;
  } catch {}
  const girada = [5, 6, 7, 8].includes(orientacion);
  const vertical = ancho && alto ? (girada ? ancho > alto : alto > ancho) : null;
  fotos.push({ rel, hora, vertical });
}
fotos.sort((a, b) => (a.hora && b.hora ? a.hora - b.hora : a.rel.localeCompare(b.rel)));

// Sesiones por hueco de tiempo. Las fotos sin hora (p. ej. enviadas por WhatsApp) van juntas al final.
const sesiones = [];
for (const f of fotos.filter((x) => x.hora)) {
  const ult = sesiones.at(-1);
  if (!ult || f.hora - ult.fin > 45 * 60 * 1000) sesiones.push({ fotos: [f], inicio: f.hora, fin: f.hora });
  else { ult.fotos.push(f); ult.fin = f.hora; }
}
const sinHora = fotos.filter((x) => !x.hora);
if (sinHora.length) sesiones.push({ fotos: sinHora, inicio: null, fin: null });
const hhmm = (d) => (d ? d.toTimeString().slice(0, 5) : '--:--');
console.log(`${fotos.length} fotos en ${sesiones.length} sesiones:`);
sesiones.forEach((s, i) => console.log(`  Sesión ${i + 1}: ${hhmm(s.inicio)}-${hhmm(s.fin)} · ${s.fotos.length} fotos · ${s.fotos[0].rel} a ${s.fotos.at(-1).rel} · ${s.fotos.filter((f) => f.vertical).length} verticales`));
fs.writeFileSync(path.join(destino, 'fotos.tsv'), ['archivo\thora\tsesion\tvertical', ...sesiones.flatMap((s, i) => s.fotos.map((f) => `${f.rel}\t${hhmm(f.hora)}\t${i + 1}\t${f.vertical ? 'sí' : ''}`))].join('\n') + '\n', 'utf8');

// Hojas de contacto: 30 por hoja, en orden de hora, con la sesión en el título.
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1800, height: 1300 } });
const lista = sesiones.flatMap((s, i) => s.fotos.map((f) => ({ ...f, sesion: i + 1 })));
const POR_HOJA = 30;
for (let h = 0; h * POR_HOJA < lista.length; h++) {
  const trozo = lista.slice(h * POR_HOJA, (h + 1) * POR_HOJA);
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#1d1d1f;font:16px system-ui;color:#eee}
    .g{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding:8px}
    figure{margin:0}img{width:100%;height:190px;object-fit:contain;background:#000;display:block}
    figcaption{padding:4px 2px}b{color:#e9cd6a}</style>
    <div class="g">${trozo.map((f) => `<figure><img src="${pathToFileURL(path.join(carpeta, f.rel)).href}"><figcaption><b>${f.rel}</b> · ${hhmm(f.hora)} · S${f.sesion}${f.vertical ? ' · vertical' : ''}</figcaption></figure>`).join('')}</div>`;
  const tmp = path.join(destino, `hoja-${String(h + 1).padStart(2, '0')}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.screenshot({ path: tmp.replace(/\.html$/, '.jpg'), type: 'jpeg', quality: 80, fullPage: true });
  fs.unlinkSync(tmp);
}
await browser.close();
console.log(`Hojas de contacto y fotos.tsv en ${destino}`);
