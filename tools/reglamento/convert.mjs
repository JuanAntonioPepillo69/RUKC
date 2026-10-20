// Convierte el reglamento (.docx) en el HTML de la página /reglamento.
// Uso: npm run reglamento   (después de sustituir el .docx de esta carpeta por la versión nueva)
import mammoth from 'mammoth';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const docx = (await fs.readdir(here)).filter((f) => f.endsWith('.docx')).sort().pop();
if (!docx) throw new Error('No hay ningún .docx en tools/reglamento');

let html = (await mammoth.convertToHtml({ path: path.join(here, docx) })).value;

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Portada fuera (la página ya tiene su cabecera) y el índice con números de página del Word también
html = html.slice(html.indexOf('<h1>'));
html = html.replace(/<h1>Índice<\/h1>[\s\S]*?(?=<h1>)/, '');

// Corrección del calendario (Art. 70): R5 en Kart&Fun Málaga y R7 en Mijas, confirmado por la organización.
// Quitar cuando el .docx ya venga corregido.
html = html
  .replace(/(<td><p>R5<\/p><\/td><td><p>13 de marzo de 2027<\/p><\/td><td><p>)Mijas(<\/p>)/, '$1Kart&amp;Fun Málaga$2')
  .replace(/(<td><p>R7<\/p><\/td><td><p>5 de junio de 2027<\/p><\/td><td><p>)Kart&amp;Fun Málaga(<\/p>)/, '$1Mijas$2');

// Títulos: h1 -> h2 y h2 -> h3, con id para enlazar
const toc = [];
html = html
  .replace(/<h2>(.*?)<\/h2>/g, (_, t) => `<h3 id="${slug(t)}">${t}</h3>`)
  .replace(/<h1>(.*?)<\/h1>/g, (_, t) => { const id = slug(t); toc.push({ id, t: t.replace(/<[^>]+>/g, '') }); return `<h2 id="${id}">${t}</h2>`; });

// Cada artículo con su ancla: /reglamento#art-46-bis
html = html.replace(/<p><strong>Art\. (\d+)( (?:bis|ter|quater|quinquies|sexies))?\./g, (m, n, suf) => `<p id="art-${n}${suf ? '-' + suf.trim() : ''}"${m.slice(2)}`);

// Tablas con scroll horizontal en móvil
html = html.replace(/<table>/g, '<div class="table-scroll"><table class="table">').replace(/<\/table>/g, '</table></div>');

await fs.mkdir(path.join(root, 'src', 'content'), { recursive: true });
await fs.writeFile(path.join(root, 'src', 'content', 'reglamento.html'), html);
await fs.writeFile(path.join(root, 'src', 'content', 'reglamento-toc.json'), JSON.stringify({ fuente: docx, toc }, null, 2));
console.log(`ok: ${docx} -> src/content/reglamento.html (${toc.length} secciones)`);
