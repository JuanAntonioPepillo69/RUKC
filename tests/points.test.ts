// Tests del motor de puntos. Ejecutar con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campeonato, clasificacionRonda, descarteActivo, mencionesRonda, pasaporte } from '../src/lib/season/points.ts';
import type { Resultado, Ronda, Temporada } from '../src/lib/season/types.ts';

const ronda = (n: number, extra: Partial<Ronda> = {}): Ronda => ({
  ronda: n, fecha: `2027-0${n}-01`, circuito: 'Test', estado: 'disputada', carrera: 'completa', nota: '', ...extra,
});
const res = (ronda: number, dorsal: number, posicion: number | null, extra: Partial<Resultado> = {}): Resultado => ({
  ronda, categoria: 'Ligeros', dorsal, posicion, finaliza: posicion !== null, pole: false, vueltaRapida: false,
  constancia: false, pierdeBonus: false, dsq: false, salida: null, mejorVuelta: '', ...extra,
});
const temporada = (rondas: Ronda[], resultados: Resultado[], extra: Partial<Temporada> = {}): Temporada => ({
  config: { descarte: 'no', aviso: '' }, rondas, resultados,
  pilotos: [...new Set(resultados.map((r) => r.dorsal))].map((d) => ({ dorsal: d, nombre: `P${d}`, categoria: 'Ligeros' })),
  sanciones: [], menciones: [], demo: false, ...extra,
});

test('puntos del Art. 46: escala hasta el 15.º y 1 punto por finalizar del 16.º en adelante', () => {
  const rs = Array.from({ length: 17 }, (_, i) => res(1, i + 1, i + 1));
  const f = clasificacionRonda(temporada([ronda(1)], rs), 1, 'Ligeros');
  assert.deepEqual(f.map((x) => x.puntos), [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1]);
});

test('quien no finaliza no suma puntos de posición', () => {
  const f = clasificacionRonda(temporada([ronda(1)], [res(1, 1, 1), res(1, 2, 2, { finaliza: false })]), 1, 'Ligeros');
  assert.equal(f[1].puntos, 0);
});

test('bonificaciones: pole +2, vuelta rápida +2, constancia +3', () => {
  const f = clasificacionRonda(temporada([ronda(1)], [res(1, 1, 1, { pole: true, vueltaRapida: true, constancia: true })]), 1, 'Ligeros');
  assert.equal(f[0].puntos, 25 + 2 + 2 + 3);
});

test('constancia solo si finaliza; pierde bonus las anula todas', () => {
  const t = temporada([ronda(1)], [
    res(1, 1, 1, { constancia: true, finaliza: false }),
    res(1, 2, 2, { pole: true, vueltaRapida: true, constancia: true, pierdeBonus: true }),
  ]);
  const f = clasificacionRonda(t, 1, 'Ligeros');
  assert.equal(f.find((x) => x.dorsal === 1)!.bonus.constancia, 0);
  assert.equal(f.find((x) => x.dorsal === 2)!.puntos, 20);
});

test('la posición se recalcula dentro de la categoría y sin los descalificados', () => {
  // Clasificación conjunta: 1.º Pesados, 2.º Ligeros DSQ, 3.º Ligeros -> en Ligeros el dorsal 3 queda 1.º
  const t = temporada([ronda(1)], [
    res(1, 1, 1, { categoria: 'Pesados' }), res(1, 2, 2, { dsq: true }), res(1, 3, 3),
  ]);
  const f = clasificacionRonda(t, 1, 'Ligeros');
  assert.equal(f[0].dorsal, 3);
  assert.equal(f[0].pos, 1);
  assert.equal(f[0].puntos, 25);
  assert.equal(f[1].dsq, true);
  assert.equal(f[1].puntos, 0);
});

test('bandera roja: media carrera da la mitad y sin vuelta rápida ni constancia; carrera nula no puntúa', () => {
  const mitad = clasificacionRonda(temporada([ronda(1, { carrera: 'mitad' })], [res(1, 1, 1, { pole: true, vueltaRapida: true, constancia: true })]), 1, 'Ligeros');
  assert.equal(mitad[0].puntos, 12.5 + 2);
  const nula = temporada([ronda(1, { carrera: 'nula' })], [res(1, 1, 1)]);
  assert.equal(campeonato(nula, 'Ligeros').filas.length, 0);
});

test('campeonato suma rondas y ordena por puntos', () => {
  // R1: 1-2-3 · R2: 1-3-2 -> dorsal 1 = 50; dorsales 2 y 3 = 36. Desempata la R2 (última común): el 3 fue 2.º
  const t = temporada([ronda(1), ronda(2)], [res(1, 1, 1), res(1, 2, 2), res(1, 3, 3), res(2, 1, 1), res(2, 2, 3), res(2, 3, 2)]);
  const { filas } = campeonato(t, 'Ligeros');
  assert.deepEqual(filas.map((f) => [f.pos, f.dorsal, f.bruto]), [[1, 1, 50], [2, 3, 36], [3, 2, 36]]);
});

test('desempate del Art. 49: a igualdad de puntos, gana el mejor resultado en la última ronda común', () => {
  const t = temporada([ronda(1), ronda(2)], [res(1, 1, 1), res(1, 2, 2), res(2, 1, 2), res(2, 2, 1)]);
  const { filas } = campeonato(t, 'Ligeros');
  // Misma suma (43), una victoria y un segundo cada uno: decide la ronda 2, que ganó el dorsal 2
  assert.equal(filas[0].dorsal, 2);
  assert.equal(filas[0].pos, 1);
  assert.equal(filas[1].pos, 2);
});

test('descarte del Art. 48: se quita la peor ronda, las ausencias valen 0 y una DSQ no se puede descartar', () => {
  const rondas = [ronda(1), ronda(2), ronda(3)];
  const t = temporada(rondas, [
    res(1, 1, 1), res(2, 1, 2), // R2: el dorsal 2 es DSQ, así que el dorsal 1 queda 1.º; no corre la R3: se descarta esa (0)
    res(1, 2, 2), res(2, 2, 1, { dsq: true }), res(3, 2, 1), // el dorsal 2 tiene DSQ en la 2: se descarta la 1
    res(3, 1, null, { finaliza: false }),
  ], { config: { descarte: 'si', aviso: '' } });
  const { filas, descarte } = campeonato(t, 'Ligeros');
  assert.equal(descarte, true);
  const d1 = filas.find((f) => f.dorsal === 1)!;
  const d2 = filas.find((f) => f.dorsal === 2)!;
  assert.equal(d1.descartada, 2);
  assert.equal(d1.neto, 50);
  assert.equal(d2.descartada, 0);
  assert.equal(d2.neto, 25);
});

test('descarte automático solo cuando todas las rondas no canceladas están disputadas', () => {
  const base = { config: { descarte: 'auto' as const, aviso: '' } };
  assert.equal(descarteActivo(temporada([ronda(1), ronda(2, { estado: 'programada' })], [], base)), false);
  assert.equal(descarteActivo(temporada([ronda(1), ronda(2, { estado: 'cancelada' })], [], base)), true);
});

test('pasaporte: suma los PP de los últimos 12 meses', () => {
  const t = temporada([ronda(1)], [res(1, 1, 1)], {
    sanciones: [
      { fecha: '2026-11-21', ronda: 2, dorsal: 1, pp: 3, motivo: '' },
      { fecha: '2025-10-01', ronda: null, dorsal: 1, pp: 4, motivo: 'caducada' },
      { fecha: '2027-01-10', ronda: null, dorsal: 1, pp: 9, motivo: '' },
    ],
  });
  const [p] = pasaporte(t, new Date('2027-02-01'));
  assert.equal(p.pp, 12);
  assert.equal(p.alcanzaLimite, true);
});

test('menciones automáticas: pole y mayor remontada', () => {
  const t = temporada([ronda(1)], [res(1, 1, 1, { pole: true, salida: 1 }), res(1, 2, 2, { salida: 6 })]);
  const m = mencionesRonda(t, 1);
  assert.equal(m.find((x) => x.titulo === 'Pole position')!.pilotos[0].dorsal, 1);
  const r = m.find((x) => x.titulo === 'Mayor remontada')!;
  assert.equal(r.pilotos[0].dorsal, 2);
});

test('la tabla del Art. 46 de /reglamento coincide con el cálculo de la web', async () => {
  const fs = await import('node:fs');
  const { PUNTOS_POSICION, PUNTOS_FINALIZAR } = await import('../src/lib/season/points.ts');
  const html = fs.readFileSync('src/content/reglamento.html', 'utf8');
  const tabla = html.slice(html.indexOf('id="art-46"'), html.indexOf('id="art-46-bis"'));
  const celdas = [...tabla.matchAll(/<td><p>([^<]*)<\/p><\/td><td><p>([^<]*)<\/p><\/td>/g)].map((m) => [m[1], m[2]]);
  const esperado = [
    ...PUNTOS_POSICION.map((p, i) => [`${i + 1}.º`, `${p} ${p === 1 ? 'punto' : 'puntos'}`]),
    [`${PUNTOS_POSICION.length + 1}.º en adelante`, `${PUNTOS_FINALIZAR} punto por finalizar`],
  ];
  assert.deepEqual(celdas, esperado);
});
