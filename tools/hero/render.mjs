// Renderiza la escena del hero a PNG, frame a frame, con Chrome sin pantalla.
// Uso:
//   node tools/hero/render.mjs                 -> escritorio y móvil completos
//   node tools/hero/render.mjs --only=desktop  -> solo una versión
//   node tools/hero/render.mjs --preview=0,0.2,0.5,0.9  -> frames sueltos para revisar (en out/preview)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = path.join(here, 'out');

export const VARIANTS = {
  desktop: { w: 1920, h: 1080, frames: 220 },
  mobile: { w: 600, h: 1240, frames: 150 },
};

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const only = args.only ? args.only.split(',') : Object.keys(VARIANTS);
const preview = args.preview ? args.preview.split(',').map(Number) : null;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-gpu'] });
try {
  for (const name of only) {
    const v = VARIANTS[name];
    const page = await browser.newPage({ viewport: { width: v.w, height: v.h } });
    page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(`http://127.0.0.1:${port}/tools/hero/scene.html?w=${v.w}&h=${v.h}`);
    await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 60000 });
    const cues = await page.evaluate(() => window.CUES);

    const dir = path.join(OUT, preview ? 'preview' : name);
    if (!preview) await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const times = preview ?? Array.from({ length: v.frames }, (_, i) => i / (v.frames - 1));
    const t0 = Date.now();
    const anchors = [];
    for (let i = 0; i < times.length; i++) {
      const { dataUrl, a } = await page.evaluate((t) => {
        const a = window.renderFrame(t);
        return { dataUrl: document.querySelector('canvas').toDataURL('image/png'), a };
      }, times[i]);
      anchors.push(a);
      const file = preview ? `${name}-${times[i].toFixed(3)}.png` : `${String(i + 1).padStart(3, '0')}.png`;
      await fs.writeFile(path.join(dir, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
      if (!preview && i % 15 === 0) console.log(`${name} ${i + 1}/${times.length}`);
    }
    console.log(`${name}: ${times.length} frames en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (!preview) {
      await fs.writeFile(path.join(dir, 'cues.json'), JSON.stringify(cues));
      await fs.writeFile(path.join(dir, 'anchors.json'), JSON.stringify(anchors));
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
