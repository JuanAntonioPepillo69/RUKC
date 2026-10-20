// Monta una hoja de contactos con los frames de out/preview (solo para revisar).
import sharp from 'sharp';
import fs from 'node:fs';
const [dir = 'tools/hero/out/preview', out = 'sheet'] = process.argv.slice(2);
for (const m of ['desktop', 'mobile']) {
  const f = fs.readdirSync(dir).filter((x) => x.startsWith(m)).sort();
  if (!f.length) continue;
  const tw = m === 'desktop' ? 480 : 180, th = m === 'desktop' ? 270 : 372, cols = 5;
  const bufs = await Promise.all(f.map((x) => sharp(`${dir}/${x}`).resize(tw, th).png().toBuffer()));
  await sharp({ create: { width: tw * cols, height: th * Math.ceil(f.length / cols), channels: 3, background: '#f0f' } })
    .composite(bufs.map((b, i) => ({ input: b, left: (i % cols) * tw, top: Math.floor(i / cols) * th })))
    .png().toFile(`${out}-${m}.png`);
}
