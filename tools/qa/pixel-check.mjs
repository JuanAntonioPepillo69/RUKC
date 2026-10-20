// Comprueba en las peticiones de red que el píxel de Meta dispara PageView y Lead, y que tras "Rechazar" no envía nada.
// Uso: node tools/qa/pixel-check.mjs http://localhost:4321/acceso-t2-xxxx
import { chromium } from 'playwright';

const TARGET = process.argv[2];
if (!TARGET) throw new Error('Pasa la URL de la landing');
// Meta ignora los navegadores marcados como automatizados (navigator.webdriver): se quita esa marca
const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] });

const UA = (await browser.newPage().then(async (p) => { const u = await p.evaluate(() => navigator.userAgent); await p.close(); return u; })).replace('HeadlessChrome', 'Chrome');

const eventos = (page) => {
  const out = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/facebook\.com\/tr/.test(u)) out.push(new URL(u).searchParams.get('ev') ?? (r.postData()?.match(/ev=([A-Za-z]+)/)?.[1] ?? '?'));
    if (u.includes('/api/lead')) out.push('CAPI /api/lead');
  });
  return out;
};

async function rellenarYEnviar(page) {
  await page.fill('#f-nombre', 'Prueba QA');
  await page.fill('#f-tel', '600000000');
  await page.fill('#f-email', 'qa@example.com');
  await page.selectOption('#f-nivel', { index: 1 });
  await page.check('#f-consent');
  const popup = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
  await page.click('#submit');
  const p = await popup;
  const wa = p ? p.url() : '(sin ventana)';
  if (p) await p.close();
  return wa;
}

// 1) Aceptar
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
  await ctx.route(/wa\.me|whatsapp/, (r) => r.abort()); // no abrir WhatsApp de verdad
  const page = await ctx.newPage();
  const ev = eventos(page);
  await page.goto(TARGET, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const banner = await page.isVisible('#cookie');
  await page.click('#cookieOk');
  const wa = await rellenarYEnviar(page);
  await page.waitForTimeout(2500);
  console.log('ACEPTAR  banner visible:', banner, '| eventos:', ev.join(', ') || 'ninguno', '| WhatsApp:', wa.slice(0, 60));
  await ctx.close();
}

// 2) Rechazar y volver a entrar
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA });
  await ctx.route(/wa\.me|whatsapp/, (r) => r.abort());
  const page = await ctx.newPage();
  const ev1 = eventos(page);
  await page.goto(TARGET, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.click('#cookieNo');
  const antes = ev1.length;
  await rellenarYEnviar(page);
  await page.waitForTimeout(2500);
  console.log('RECHAZAR eventos antes de pulsar:', ev1.slice(0, antes).join(', ') || 'ninguno', '| después:', ev1.slice(antes).join(', ') || 'ninguno');
  const page2 = await ctx.newPage();
  const ev2 = eventos(page2);
  await page2.goto(TARGET, { waitUntil: 'load' });
  await page2.waitForTimeout(3000);
  console.log('RECHAZAR segunda visita, banner visible:', await page2.isVisible('#cookie'), '| eventos:', ev2.join(', ') || 'ninguno');
  await ctx.close();
}
await browser.close();
