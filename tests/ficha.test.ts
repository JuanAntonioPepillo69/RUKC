import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dorsalAlAzar, estadoDorsal, sugerencias } from '../src/lib/ficha/dorsal.ts';
import { estimarPeso, kgTexto, textoEstimacion, tramoPorPeso } from '../src/lib/ficha/peso.ts';

const ocupados = new Set([1, 2, 3, 7, 22, 23, 24, 25]);

test('dorsal: libre, ocupado, vacío o fuera de rango', () => {
  assert.equal(estadoDorsal('', ocupados), 'vacio');
  assert.equal(estadoDorsal('23', ocupados), 'ocupado');
  assert.equal(estadoDorsal('26', ocupados), 'libre');
  assert.equal(estadoDorsal('0', ocupados), 'invalido');
  assert.equal(estadoDorsal('1000', ocupados), 'invalido');
  assert.equal(estadoDorsal('2.5', ocupados), 'invalido');
});

test('dorsal: sugiere los libres más cercanos, y sin número los más bajos', () => {
  assert.deepEqual(sugerencias(ocupados, 23, 4), [20, 21, 26, 27]);
  assert.deepEqual(sugerencias(ocupados, null, 3), [4, 5, 6]);
  assert.deepEqual(sugerencias(ocupados, 1, 2), [4, 5]);
  assert.ok(sugerencias(ocupados, 999, 3).every((n) => n <= 999));
});

test('dorsal al azar: siempre libre, primero de 1 a 99', () => {
  for (let i = 0; i < 50; i++) {
    const n = dorsalAlAzar(ocupados)!;
    assert.ok(n >= 1 && n <= 99 && !ocupados.has(n));
  }
  const llenos = new Set(Array.from({ length: 99 }, (_, i) => i + 1));
  const n = dorsalAlAzar(llenos, () => 0)!;
  assert.equal(n, 100);
  assert.equal(dorsalAlAzar(new Set(Array.from({ length: 999 }, (_, i) => i + 1))), null);
});

test('peso: cortes del reglamento (80,0 Ligeros, 80,1 a 84,9 franja, 85,0 Pesados)', () => {
  assert.equal(tramoPorPeso(80), 'LIG');
  assert.equal(tramoPorPeso(80.1), 'eleccion');
  assert.equal(tramoPorPeso(84.9), 'eleccion');
  assert.equal(tramoPorPeso(85), 'PES');
});

test('peso: de la báscula al peso de competición', () => {
  assert.deepEqual(estimarPeso(72, 'sin_ropa'), { min: 75, max: 76, tramos: ['LIG'], sugerido: 75.5 });
  assert.deepEqual(estimarPeso(78.5, 'equipacion'), { min: 80, max: 80, tramos: ['LIG'], sugerido: 80 });
  assert.deepEqual(estimarPeso(77, 'sin_ropa')?.tramos, ['LIG', 'eleccion']);
  assert.deepEqual(estimarPeso(79, 'ropa_ligera')?.tramos, ['eleccion']);
  assert.equal(estimarPeso(10, 'sin_ropa'), null);
  assert.match(textoEstimacion(estimarPeso(77, 'sin_ropa')!), /cerca de un corte/);
  assert.match(textoEstimacion(estimarPeso(90, 'sin_ropa')!), /entre 93 y 94 kg\. Pesados/);
  assert.equal(kgTexto(82.45), '82,5 kg');
});
