// Tests del lector de la hoja: datos DEMO válidos y mensajes de error claros.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carpetaDrive, construirTemporada, leerLibro, parseCsv, youtube } from '../src/lib/season/load.ts';
import { campeonato } from '../src/lib/season/points.ts';
import fs from 'node:fs';

const tab = (name: string) => {
  const [head, ...body] = parseCsv(fs.readFileSync(`data/demo/${name}.csv`, 'utf8'));
  const keys = head.map((k) => k.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
};
const demoTabs = () => ({
  Config: tab('config'), Rondas: tab('rondas'), Pilotos: tab('pilotos'),
  Resultados: tab('resultados'), Sanciones: tab('sanciones'), Menciones: tab('menciones'),
});

test('CSV con comillas, comas y saltos de línea', () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n'), [['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
});

test('los datos DEMO se leen y la R1 reparte puntos', () => {
  const t = construirTemporada(demoTabs(), true);
  assert.equal(t.rondas.length, 8);
  assert.equal(t.rondas[0].fecha, '2026-10-17');
  const { filas } = campeonato(t, 'Ligeros');
  assert.equal(filas[0].dorsal, 7);
  assert.equal(filas[0].bruto, 25 + 3); // ganador con constancia
});

test('errores de la hoja con pestaña y fila', () => {
  const tabs = demoTabs();
  tabs.Resultados.push({ ronda: '1', categoria: 'Ligeros', dorsal: '99', posicion: '20' });
  assert.throws(() => construirTemporada(tabs, true), /Resultados, fila \d+: el dorsal "99" no está en la pestaña Pilotos/);
});

test('la plantilla de Google Sheets se lee y valida (sin resultados todavía)', async () => {
  const buf = fs.readFileSync('tools/sheet/RUKC-Temporada-2.xlsx');
  const tabs = await leerLibro(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const t = construirTemporada(tabs, false);
  assert.equal(t.rondas.length, 8);
  assert.equal(t.rondas[6].circuito, 'Karting Mijas'); // R7 en Mijas
  assert.equal(t.rondas[4].circuito, 'Kart&Fun Málaga'); // R5 en Kart&Fun Málaga
  assert.equal(t.rondas[0].estado, 'programada'); // sin resultados, aún no cuenta como disputada
  assert.equal(t.config.descarte, 'auto');
});

test('un piloto puede competir en las dos categorías en la misma ronda y puntúa en cada una', () => {
  const tabs = demoTabs();
  tabs.Pilotos.push({ dorsal: '50', nombre: 'Doble', categoria: 'Ligeros y Pesados' });
  tabs.Resultados.push({ ronda: '1', categoria: 'Ligeros', dorsal: '50', posicion: '15' });
  tabs.Resultados.push({ ronda: '1', categoria: 'Pesados', dorsal: '50', posicion: '11' });
  const t = construirTemporada(tabs, true);
  assert.equal(t.pilotos.find((p) => p.dorsal === 50)!.categoria, 'Ambas');
  assert.ok(campeonato(t, 'Ligeros').filas.some((f) => f.dorsal === 50));
  assert.ok(campeonato(t, 'Pesados').filas.some((f) => f.dorsal === 50));
});

test('si compite en las dos categorías, la categoría del resultado es obligatoria', () => {
  const tabs = demoTabs();
  tabs.Pilotos.push({ dorsal: '50', nombre: 'Doble', categoria: 'Ambas' });
  tabs.Resultados.push({ ronda: '1', categoria: '', dorsal: '50', posicion: '15' });
  assert.throws(() => construirTemporada(tabs, true), /el dorsal 50 compite en las dos categorías/);
});

test('enlaces de Drive y YouTube', () => {
  assert.equal(carpetaDrive('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQ?usp=sharing'), '1AbCdEfGhIjKlMnOpQ');
  assert.equal(carpetaDrive('https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOpQ'), '1AbCdEfGhIjKlMnOpQ');
  assert.equal(carpetaDrive('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQ/view'), null);
  assert.deepEqual(youtube('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), { tipo: 'video', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(youtube('https://youtu.be/dQw4w9WgXcQ'), { tipo: 'video', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(youtube('https://youtube.com/shorts/dQw4w9WgXcQ'), { tipo: 'video', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(youtube('https://www.youtube.com/playlist?list=PLabcdefghij1234'), { tipo: 'lista', id: 'PLabcdefghij1234' });
  assert.equal(youtube('https://vimeo.com/123'), null);
});

test('fotos y vídeos: columnas de Rondas y pestaña Media', () => {
  const tabs = { ...demoTabs(), Media: [{ ronda: '1', id: 'abc123', nombre: 'IMG_1.jpg', tipo: 'foto' }, { ronda: '1', id: 'def456', nombre: 'v.mp4', tipo: 'video' }] };
  tabs.Rondas[0] = { ...tabs.Rondas[0], fotos: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQ', videos: 'https://youtu.be/dQw4w9WgXcQ' };
  const t = construirTemporada(tabs, true);
  assert.equal(t.rondas[0].videos[0].id, 'dQw4w9WgXcQ');
  assert.deepEqual(t.media.map((m) => m.tipo), ['foto', 'video']);
  tabs.Rondas[0] = { ...tabs.Rondas[0], fotos: 'https://drive.google.com/file/d/xyz/view' };
  assert.throws(() => construirTemporada(tabs, true), /"fotos" tiene que ser el enlace a una carpeta de Google Drive/);
});
