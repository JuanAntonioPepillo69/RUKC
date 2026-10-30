// Renderiza slides a PNG 1080x1350 con Playwright (Chrome del sistema).
// Uso: node render.cjs <post>   (post = calibracion | race05 | race06)
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/jrfmp/Web/plantillas/node_modules/playwright');

const post = process.argv[2] || 'calibracion';
const only = process.argv[3];
const def = require(`./posts/${post}.cjs`);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  fs.mkdirSync(def.out, { recursive: true });
  for (const s of def.slides) {
    if (only && !s.file.startsWith(only)) continue;
    const dst = path.join(def.out, s.file);
    if (s.copy) { fs.copyFileSync(s.copy, dst); console.log('copiado', s.file); continue; }
    const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="t1.css"></head>
      <body><div class="slide">${s.html}</div></body></html>`;
    const tmp = path.join(__dirname, '_tmp.html');
    fs.writeFileSync(tmp, html);
    await page.goto('file:///' + tmp.replace(/\\/g, '/'));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const chk = await page.evaluate(fs.readFileSync(path.join(__dirname, 'fit.js'), 'utf8'));
    if (chk.margen.length) console.log('  margen <60px:', chk.margen.join(' | '));
    if (chk.estrechados.length) console.log('  estrechados:', chk.estrechados.join(' | '));
    await page.locator('.slide').screenshot({ path: dst });
    console.log('render', s.file);
  }
  await browser.close();
})();
