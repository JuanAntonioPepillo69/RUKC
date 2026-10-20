// Convierte los PNG de out/<variante> a WebP en public/hero/<d|m>/ y escribe public/hero/manifest.json.
// Uso: node tools/hero/encode.mjs
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const PUB = path.join(root, 'public', 'hero');

const VARIANTS = { desktop: { dir: 'd', quality: 70 }, mobile: { dir: 'm', quality: 64 } };
const manifest = { version: Date.now().toString(36), variants: {} };

for (const [name, v] of Object.entries(VARIANTS)) {
  const src = path.join(here, 'out', name);
  const files = (await fs.readdir(src)).filter((f) => f.endsWith('.png')).sort();
  const dst = path.join(PUB, v.dir);
  await fs.rm(dst, { recursive: true, force: true });
  await fs.mkdir(dst, { recursive: true });
  let bytes = 0, w = 0, h = 0;
  for (const f of files) {
    const out = path.join(dst, f.replace('.png', '.webp'));
    const info = await sharp(path.join(src, f)).webp({ quality: v.quality, effort: 6, smartSubsample: true }).toFile(out);
    bytes += info.size; w = info.width; h = info.height;
  }
  const cues = JSON.parse(await fs.readFile(path.join(src, 'cues.json'), 'utf8'));
  // Anclajes: por cada punto, [x0, y0, x1, y1, ...] en 0..1 (o -1 si ese frame no se ve)
  const raw = JSON.parse(await fs.readFile(path.join(src, 'anchors.json'), 'utf8'));
  const anchors = {};
  for (const name of Object.keys(raw[0])) {
    anchors[name] = raw.flatMap((f) => (f[name] ? f[name].map((n) => Math.round(n * 1000) / 1000) : [-1, -1]));
  }
  await fs.writeFile(path.join(PUB, `anchors-${v.dir}.json`), JSON.stringify(anchors));
  manifest.cues = cues;
  manifest.variants[v.dir] = { frames: files.length, width: w, height: h };
  console.log(`${name}: ${files.length} frames, ${(bytes / 1024 / 1024).toFixed(2)} MB (media ${(bytes / files.length / 1024).toFixed(0)} KB)`);
}
await fs.writeFile(path.join(PUB, 'manifest.json'), JSON.stringify(manifest, null, 2));
