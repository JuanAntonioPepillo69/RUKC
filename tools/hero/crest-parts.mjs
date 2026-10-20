// Corta el logo principal en piezas (corona, disco, ala izq., ala der., texto) para la escena del hero.
// Todas las piezas mantienen el lienzo de 1024x1024, así que superpuestas reconstruyen el logo exacto.
// Uso: node tools/hero/crest-parts.mjs [ruta-al-logo.png]
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] ??
  'C:/Users/jrfmp/Documents/1.RaceUp/Branding RaceUp/1. Material de Marca/1. Logo/Sin fondo/Principal.png';

const { data, info } = await sharp(src).ensureAlpha().resize(1024, 1024).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;

// Medidas obtenidas analizando los píxeles del logo (disco rojo y silueta de la corona).
const DISC = { cx: 511.5, cy: 391.5, r: 118 };
const CROWN = { yMax: 276, xMin: 340, xMax: 690 };
const WORD_Y = 732;

const parts = {
  crown: (x, y) => y <= CROWN.yMax && x > CROWN.xMin && x < CROWN.xMax,
  disc: (x, y) => Math.hypot(x - DISC.cx, y - DISC.cy) < DISC.r,
  word: (x, y) => y >= WORD_Y,
};
const owner = (x, y) => {
  if (parts.word(x, y)) return 'word';
  if (parts.disc(x, y)) return 'disc';
  if (parts.crown(x, y)) return 'crown';
  return x < W / 2 ? 'wingL' : 'wingR';
};

for (const name of ['crown', 'disc', 'wingL', 'wingR', 'word']) {
  const out = Buffer.from(data);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (owner(x, y) !== name) out[(y * W + x) * 4 + 3] = 0;
  }
  await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(here, 'assets', `crest-${name}.png`));
  console.log('ok', name);
}
