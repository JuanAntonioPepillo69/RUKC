import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error: módulo JavaScript sin tipos
import { agruparPagos } from '../lib/panel/resumen-pagos.js';

const f = (dia: string, metodo: string, entrado_cent: number, n = 1, reembolsado_cent = 0) => ({ dia, metodo, n, entrado_cent, reembolsado_cent });
// El 8 de noviembre de 2026 es domingo: la semana empieza el lunes 2.
const FILAS = [
  f('2026-10-30', 'stripe_tarjeta', 3000),
  f('2026-11-01', 'bizum_manual', 3000), // domingo de la semana pasada
  f('2026-11-02', 'bizum_manual', 6000, 2),
  f('2026-11-07', 'stripe_tarjeta', 3000),
  f('2026-11-08', 'stripe_tarjeta', 3000),
  f('2026-11-08', 'efectivo', 6900),
  f('2026-11-08', 'stripe_tarjeta', 0, 0, 3000), // reembolso emitido hoy
];

test('resumen de pagos: hoy, ayer, semana de lunes a domingo, mes y total, restando reembolsos', () => {
  const { periodos: p } = agruparPagos(FILAS, '2026-11-08');
  assert.deepEqual(p.hoy, { n: 2, cent: 6900, tarjeta_cent: 0, bizum_cent: 0, otros_cent: 6900, reembolsado_cent: 3000 });
  assert.equal(p.ayer.cent, 3000);
  assert.equal(p.semana.cent, 6000 + 3000 + 6900);
  assert.equal(p.semana.n, 5);
  assert.equal(p.semana_pasada.cent, 3000 + 3000);
  assert.equal(p.mes.cent, 3000 + 6000 + 3000 + 6900);
  assert.equal(p.mes_pasado.cent, 3000);
  assert.equal(p.total.cent, 21900);
});

test('resumen de pagos: series de 14 días con ceros, 8 semanas y solo los meses con movimiento', () => {
  const r = agruparPagos(FILAS, '2026-11-08');
  assert.equal(r.dias.length, 14);
  assert.equal(r.dias[0].desde, '2026-11-08');
  assert.equal(r.dias[2].n, 0);
  assert.equal(r.semanas.length, 8);
  assert.deepEqual([r.semanas[0].desde, r.semanas[0].hasta], ['2026-11-02', '2026-11-08']);
  assert.deepEqual(r.meses.map((m: any) => [m.desde, m.hasta, m.cent]), [['2026-11-01', '2026-11-30', 18900], ['2026-10-01', '2026-10-31', 3000]]);
});

test('resumen de pagos: Bizum por Stripe cuenta como Bizum y funciona en cambio de año', () => {
  const r = agruparPagos([f('2026-12-31', 'stripe_bizum', 3000)], '2027-01-01');
  assert.equal(r.periodos.ayer.bizum_cent, 3000);
  assert.equal(r.periodos.mes_pasado.cent, 3000);
  assert.equal(r.periodos.mes.cent, 0);
});
