// QA del hero: capturas a 1440 y 390 px en varios puntos del scroll y medición de fps durante un scroll continuo.
// Uso: node tools/qa/hero-qa.mjs [url] [carpeta-salida]
//   El móvil se mide con la CPU ralentizada x4 (aprox. gama media).
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://localhost:4321/';
const OUT = process.argv[3] ?? 'qa-shots';
await fs.mkdir(OUT, { recursive: true });

const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, cpu: 4 },
};
const POINTS = [0.02, 0.13, 0.16, 0.29, 0.39, 0.53, 0.72, 0.82, 0.92, 1]; // mitad de cada fase del guion

const browser = await chromium.launch({ channel: 'chrome' });
for (const [name, d] of Object.entries(DEVICES)) {
  const ctx = await browser.newContext(d);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE, { waitUntil: 'load' });
  // espera a que estén todos los frames (o 20 s)
  await page.waitForFunction(() => {
    const hero = document.querySelector('[data-hero]');
    if (!hero) return true;
    const imgs = performance.getEntriesByType('resource').filter((r) => r.name.includes('/hero/'));
    const m = JSON.parse(hero.dataset.manifest);
    const key = innerWidth / innerHeight < 0.9 && innerWidth < 900 ? 'm' : 'd';
    return imgs.length >= m.variants[key].frames;
  }, null, { timeout: 20000 }).catch(() => console.log(name, 'aviso: no se cargaron todos los frames a tiempo'));

  const heroRange = await page.evaluate(() => {
    const h = document.querySelector('[data-hero]');
    return { top: h.offsetTop, len: h.offsetHeight - innerHeight };
  });
  for (const p of POINTS) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(heroRange.top + heroRange.len * p));
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/hero-${name}-${String(Math.round(p * 100)).padStart(3, '0')}.png` });
  }

  // fps: scroll continuo de arriba a abajo del hero en 6 s
  if (d.cpu) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: d.cpu });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  const stats = await page.evaluate(async ({ top, len }) => {
    const times = [];
    const dur = 6000;
    const t0 = performance.now();
    await new Promise((res) => {
      const step = (now) => {
        times.push(now);
        const k = Math.min(1, (now - t0) / dur);
        window.scrollTo(0, top + len * k);
        if (k < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    const deltas = times.slice(1).map((t, i) => t - times[i]);
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const sorted = [...deltas].sort((a, b) => a - b);
    return { fps: +(1000 / avg).toFixed(1), p95ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), longFrames: deltas.filter((x) => x > 34).length, frames: deltas.length };
  }, heroRange);
  console.log(name, JSON.stringify(stats), errors.length ? `errores: ${errors.join(' | ')}` : 'sin errores');
  await ctx.close();

  // Movimiento reducido: una sola pantalla estática
  const rm = await browser.newContext({ ...d, reducedMotion: 'reduce' });
  const rp = await rm.newPage();
  await rp.goto(BASE, { waitUntil: 'load' });
  await rp.waitForTimeout(400);
  await rp.screenshot({ path: `${OUT}/hero-${name}-reduced.png` });
  await rm.close();
}
await browser.close();
