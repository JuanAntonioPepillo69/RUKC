// Capturas de cada sección (y del pie) de una página a 1440 y 390 px.
// Recorre la página despacio para que se disparen las animaciones de aparición.
// Uso: node tools/qa/page-shots.mjs <url> <carpeta-salida> [selector,...]
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const [URL = 'http://localhost:4321/', OUT = 'qa-shots', sel = 'main > section:not([data-hero]), footer'] = process.argv.slice(2);
await fs.mkdir(OUT, { recursive: true });
const DEVICES = {
  '1440': { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  '390': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const browser = await chromium.launch({ channel: 'chrome' });
for (const [name, d] of Object.entries(DEVICES)) {
  const page = await browser.newPage(d);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += 400) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(60); }
  await page.waitForTimeout(1200);
  const els = await page.locator(sel).all();
  let i = 0;
  for (const el of els) {
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await el.screenshot({ path: `${OUT}/${name}-${String(++i).padStart(2, '0')}.png` });
  }
  // Comprobación de desbordamiento horizontal
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(name, `${els.length} secciones`, overflow > 0 ? `DESBORDA ${overflow}px` : 'sin scroll horizontal', errors.length ? errors.join(' | ') : 'sin errores');
  await page.close();
}
await browser.close();
