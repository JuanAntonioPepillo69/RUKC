// QA final: captura de página completa de cada ruta a 390 y 1440 px (la home, por partes: hero + secciones).
// Uso: node tools/qa/final.mjs <url-base> <carpeta-salida>
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const [BASE = 'http://localhost:4321', OUT = 'qa/final'] = process.argv.slice(2);
const ROUTES = ['/season-2', '/season-2/r1-karting-mijas', '/reglamento', '/aviso-legal', '/privacidad', '/cookies', '/acceso-t2-c7e594', '/no-existe'];
const DEVICES = {
  '1440': { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  '390': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
await fs.mkdir(OUT, { recursive: true });
const name = (r) => r.replace(/^\//, '').replace(/\//g, '_') || 'home';
const browser = await chromium.launch({ channel: 'chrome' });
const report = [];

for (const [w, d] of Object.entries(DEVICES)) {
  for (const route of ['/', ...ROUTES]) {
    const page = await browser.newPage(d);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const res = await page.goto(BASE + route, { waitUntil: 'networkidle' });
    // recorre la página para que se disparen las animaciones de aparición
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 500) { await page.evaluate((v) => scrollTo(0, v), y); await page.waitForTimeout(40); }
    await page.waitForTimeout(900);
    if (route === '/') {
      // hero al principio, a mitad y al final, y después las secciones
      const hero = await page.evaluate(() => { const e = document.querySelector('[data-hero]'); return { top: e.offsetTop, len: e.offsetHeight - innerHeight }; });
      for (const p of [0, 0.5, 1]) {
        await page.evaluate((v) => scrollTo(0, v), Math.round(hero.top + hero.len * p));
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${OUT}/${w}-home-hero-${p * 100}.png` });
      }
      let i = 0;
      for (const el of await page.locator('main > section:not([data-hero]), footer').all()) {
        await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
        await el.screenshot({ path: `${OUT}/${w}-home-${++i}.png` });
      }
    } else {
      await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${w}-${name(route)}.png`, fullPage: true });
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    report.push(`${w} ${route} HTTP ${res?.status()} ${overflow > 0 ? `DESBORDA ${overflow}px` : 'ok'}${errors.length ? ' errores: ' + errors.join(' | ') : ''}`);
    await page.close();
  }
}
await browser.close();
console.log(report.join('\n'));
