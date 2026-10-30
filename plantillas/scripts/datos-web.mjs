// Descarga de raceupkc.com los datos de una ronda y los guarda en <carpeta>/datos/ronda.json.
// Uso: node datos-web.mjs <carpeta-carrera> <numero-ronda>
// Solo copia lo que publica la web: resultados por categoría, clasificación del campeonato y menciones.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [carpeta, numero] = process.argv.slice(2);
if (!carpeta || !numero) {
  console.error('Uso: node datos-web.mjs <carpeta-carrera> <numero-ronda>');
  process.exit(1);
}
const BASE = 'https://raceupkc.com';
const ronda = Number(numero);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();

// Página de la temporada: enlace a la ronda y clasificación del campeonato.
await page.goto(`${BASE}/season-2`, { waitUntil: 'networkidle' });
const enlace = await page.evaluate((n) => {
  const a = [...document.querySelectorAll('a[href^="/season-2/r"]')].find((x) => new RegExp(`^/season-2/r${n}-`).test(x.getAttribute('href')));
  return a ? a.getAttribute('href') : null;
}, ronda);
if (!enlace) {
  console.error(`La web no tiene publicada la ronda ${ronda} (no hay enlace /season-2/r${ronda}-...).`);
  await browser.close();
  process.exit(2);
}

const clasificacion = await page.evaluate(() => {
  const out = {};
  for (const t of document.querySelectorAll('table.standings')) {
    const cat = t.querySelector('caption').textContent.split('categoría').pop().trim();
    const cab = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rondas = cab.filter((c) => /^R\d+$/.test(c));
    out[cat] = {
      filas: [...t.querySelectorAll('tbody tr')].map((tr) => {
        const celdas = [...tr.children];
        const txt = (i) => celdas[i]?.textContent.trim() ?? '';
        const nombreCelda = tr.querySelector('th.c-name');
        const dorsal = Number(nombreCelda.querySelector('.dorsal').textContent.replace('#', ''));
        const nombre = nombreCelda.textContent.replace(/^\s*#\d+\s*/, '').trim();
        const porRonda = {};
        rondas.forEach((r) => { porRonda[r] = txt(cab.indexOf(r)) || null; });
        return {
          pos: Number(txt(0).replace(/\D/g, '')),
          empateSorteo: !!celdas[0].querySelector('.tie'),
          dorsal, nombre, porRonda,
          victorias: Number(txt(cab.indexOf('V'))),
          poles: Number(txt(cab.indexOf('P'))),
          puntos: txt(cab.length - 1),
        };
      }),
    };
  }
  return out;
});

// Pesos por categoría tal como aparecen en la web (p. ej. "70 a 80 kg").
const pesos = await page.evaluate(() => {
  const o = {};
  for (const h of document.querySelectorAll('#clasificacion .panel__title')) {
    const span = h.querySelector('span');
    o[h.firstChild.textContent.trim()] = span?.textContent.trim() ?? null;
  }
  return o;
});

// Página de la ronda.
const urlRonda = BASE + enlace;
await page.goto(urlRonda, { waitUntil: 'networkidle' });
const datosRonda = await page.evaluate(() => {
  const cabecera = document.querySelector('.head');
  const categorias = {};
  for (const sec of document.querySelectorAll('section.block')) {
    const h2 = sec.querySelector('h2')?.textContent.trim();
    const tabla = sec.querySelector('table.table');
    if (!tabla || !h2) continue;
    const cab = [...tabla.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const col = (n) => cab.indexOf(n);
    categorias[h2] = [...tabla.querySelectorAll('tbody tr')].map((tr) => {
      const celdas = [...tr.children];
      const txt = (i) => (i >= 0 ? celdas[i]?.textContent.trim() ?? '' : '');
      const nombreCelda = tr.querySelector('th.c-name');
      const dorsal = Number(nombreCelda.querySelector('.dorsal').textContent.replace('#', ''));
      const clon = nombreCelda.cloneNode(true);
      clon.querySelectorAll('.dorsal, .bonus-inline').forEach((n) => n.remove());
      const posTxt = txt(0);
      const salidaTxt = txt(col('Salida'));
      const bonusCelda = celdas[col('Bonus')];
      return {
        pos: /^\d+$/.test(posTxt) ? Number(posTxt) : null,
        estado: /^\d+$/.test(posTxt) ? 'finaliza' : posTxt, // NC o DSQ
        dorsal,
        nombre: clon.textContent.trim(),
        salida: /^\d+/.test(salidaTxt) ? Number(salidaTxt.match(/^\d+/)[0]) : null,
        remontada: /\+(\d+)/.test(salidaTxt) ? Number(salidaTxt.match(/\+(\d+)/)[1]) : 0,
        mejorVuelta: txt(col('Mejor vuelta')).replace('–', '') || null,
        puntosPosicion: txt(col('Posición') >= 0 ? col('Posición') : col('Pos. (½)')),
        bonus: bonusCelda ? [...bonusCelda.querySelectorAll('.badge')].map((b) => b.textContent.trim()) : [],
        puntos: txt(col('Puntos')),
      };
    });
  }
  const menciones = [...document.querySelectorAll('.mention')].map((m) => {
    const t = m.querySelector('.mention__title');
    const cat = t.querySelector('span')?.textContent.replace('·', '').trim() ?? null;
    const titulo = t.firstChild.textContent.trim();
    return { titulo, categoria: cat, quien: m.querySelector('.mention__who')?.textContent.trim() ?? null, texto: m.querySelector('.mention__text')?.textContent.trim() ?? null };
  });
  return {
    circuito: cabecera.querySelector('h1').textContent.trim(),
    fechaTexto: cabecera.querySelector('.lead').textContent.trim(),
    aviso: cabecera.querySelector('.aviso')?.textContent.trim() ?? null,
    demo: !!document.querySelector('.demo-banner, [class*="demo"]'),
    categorias,
    menciones,
  };
});
await browser.close();

const salida = {
  temporada: 2,
  ronda,
  circuito: datosRonda.circuito,
  fechaTexto: datosRonda.fechaTexto,
  aviso: datosRonda.aviso,
  fuente: urlRonda,
  descargado: new Date().toISOString(),
  categorias: Object.keys(datosRonda.categorias).map((nombre) => ({
    nombre,
    peso: pesos[nombre] ?? null,
    resultados: datosRonda.categorias[nombre],
    clasificacion: clasificacion[nombre]?.filas ?? null,
  })),
  menciones: datosRonda.menciones,
};
if (datosRonda.demo) console.warn('AVISO: la web muestra datos DEMO. No los uses para publicar.');

const dir = path.join(carpeta, 'datos');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'ronda.json'), JSON.stringify(salida, null, 2) + '\n', 'utf8');
console.log(`Guardado ${path.join(dir, 'ronda.json')}`);
for (const c of salida.categorias) console.log(`  ${c.nombre}: ${c.resultados.length} resultados, ${c.clasificacion?.length ?? 0} en la clasificación`);
