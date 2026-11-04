// Los documentos que firma el piloto salen palabra por palabra del reglamento publicado (versión revisada por el
// abogado). Si alguien cambia src/content/reglamento.html, este test avisa: un texto ya firmado no se edita, hace
// falta una versión nueva (db/documentos-reglamento.mjs, VERSION).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
// @ts-expect-error: módulo JavaScript sin tipos
import { documentos, VERSION } from '../db/documentos-reglamento.mjs';

const html = fs.readFileSync('src/content/reglamento.html', 'utf8');
const docs: { tipo: string; texto: string }[] = documentos(html);
const palabras = (s: string) => s.replace(/\*\*|^#+ |^- |\|/gm, ' ').split(/\s+/).filter(Boolean);
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ' };
const plano = (h: string) => h.replace(/<[^>]+>/g, ' ')
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));

test('el reglamento se carga con las mismas palabras que la página publicada', () => {
  assert.deepEqual(palabras(docs.find((d) => d.tipo === 'reglamento')!.texto), palabras(plano(html)));
});

test('cada documento es un trozo literal del reglamento', () => {
  const todo = palabras(plano(html)).join(' ');
  for (const d of docs.filter((x) => x.tipo !== 'reglamento')) {
    for (const parte of d.texto.split(/\n\n(?=\*\*Art\. )/)) assert.ok(todo.includes(palabras(parte).join(' ')), `${d.tipo} no coincide con el reglamento`);
  }
});

test('los textos de la versión cargada no han cambiado', () => {
  // Huellas de los textos de reglamento-v1.1 tal y como se activaron el 4-11-2026. Si cambian, crea una versión nueva.
  assert.equal(VERSION, 'reglamento-v1.1');
  const huellas = Object.fromEntries(docs.map((d) => [d.tipo, crypto.createHash('sha256').update(d.texto).digest('hex').slice(0, 16)]));
  assert.deepEqual(huellas, HUELLAS);
});

const HUELLAS: Record<string, string> = {
  reglamento: '7029e06ce2c28f93',
  asuncion_riesgos: 'e5b7ade1ce34c814',
  cesion_imagen: 'c0382a07aaf9c236',
  consentimiento_peso: 'c3f5f28589c0db09',
};
