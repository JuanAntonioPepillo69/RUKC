// Comprueba que la landing oculta sigue oculta: noindex en vercel.json y fuera del sitemap y de los enlaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const slug = fs.readFileSync('src/config/landing.ts', 'utf8').match(/slug:\s*'([^']+)'/)![1];

test('vercel.json manda X-Robots-Tag: noindex a la landing con el slug configurado', () => {
  const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const rule = v.headers.find((h: { source: string }) => h.source.startsWith(`/${slug}`));
  assert.ok(rule, `Falta en vercel.json la cabecera para /${slug}. Si cambiaste el slug, cámbialo también allí.`);
  assert.equal(rule.headers[0].value, 'noindex, nofollow');
});

test('la landing lleva meta robots noindex', () => {
  assert.match(fs.readFileSync('src/landing/landing.html', 'utf8'), /<meta name="robots" content="noindex, nofollow"/);
});

test('ninguna página ni componente enlaza a la landing', () => {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  const hits = walk('src').filter((f) => !f.endsWith('config/landing.ts') && fs.readFileSync(f, 'utf8').includes(slug));
  assert.deepEqual(hits, []);
});
