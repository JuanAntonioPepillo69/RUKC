import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error: módulo JavaScript sin tipos
import { DORSALES_R1, dorsalesR1Bloqueados, esSuPiloto } from '../src/config/dorsales-r1.js';

test('dorsales de la R1: el piloto se reconoce sin acentos ni mayúsculas y con apellidos de más', () => {
  assert.ok(esSuPiloto('Moises', 'Moisés Sepúlveda Merchán'));
  assert.ok(esSuPiloto('Cristobal Jimenez', 'CRISTÓBAL JIMÉNEZ Aragon'));
  assert.ok(esSuPiloto('Felix Doña', 'Félix Doña Ruiz'));
});

test('dorsales de la R1: otra persona no pasa aunque comparta nombre o apellido', () => {
  assert.equal(esSuPiloto('Alvaro Cobos', 'Álvaro Medina'), false);
  assert.equal(esSuPiloto('Manuel Merino', 'Alejandro Merino'), false);
  assert.equal(esSuPiloto('', 'Cualquiera'), false);
});

test('dorsales de la R1: se bloquean los 35 salvo el propio', () => {
  assert.equal(Object.keys(DORSALES_R1).length, 35);
  assert.equal(dorsalesR1Bloqueados('Vito Crescimanno').length, 35);
  const moises = dorsalesR1Bloqueados('Moises Sepúlveda Merchán');
  assert.equal(moises.length, 34);
  assert.ok(!moises.includes(18));
  assert.ok(moises.includes(7));
});
