// Bizum con justificante: el código de confirmación dura 24 h (entrante.js) y el resumen de las 20:00 avisa de los que
// siguen sin confirmar (resumen.js). Sin base de datos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textoResumen } from '../lib/whatsapp/resumen.js';
import { caducaTexto, CADUCIDAD_MIN } from '../lib/bot/admin.js';
import { CADUCIDAD_JUSTIFICANTE_MS } from '../lib/whatsapp/entrante.js';

const VACIO = { recibidos: 0, personas: 0, respuestas_bot: 0, respuestas_john: 0, escalados: [], en_tus_manos: 0, fallidos: 0, urgencias: 0, sin_horario: [] };
const AHORA = new Date('2026-11-15T19:00:00Z');   // domingo, 20:00 en Madrid

test('resumen: sin nada pendiente no sale', () => {
  assert.equal(textoResumen({ ...VACIO, bizum_sin_confirmar: { n: 0, desde: null, nombres: [] } }, AHORA), null);
});

test('resumen: un Bizum con justificante sin confirmar basta para que salga, con el más antiguo y un ejemplo', () => {
  const t = textoResumen({ ...VACIO, bizum_sin_confirmar: { n: 2, desde: '2026-11-13T09:40:30Z', nombres: ['Patricio Daniel Castro', 'Ana R.'] } }, AHORA)!;
  assert.match(t, /Bizum con justificante sin confirmar: 2 \(el más antiguo, el viernes 13 a las 10:40\)\./);
  assert.match(t, /«confirma el Bizum de Patricio»/);
  assert.ok(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t));
});

test('resumen: sin nombre, el ejemplo usa <nombre>; sin el dato, el resumen de siempre no cambia', () => {
  const t = textoResumen({ ...VACIO, bizum_sin_confirmar: { n: 1, desde: null, nombres: [] } }, AHORA)!;
  assert.match(t, /Bizum con justificante sin confirmar: 1\. Escríbeme «confirma el Bizum de <nombre>»\./);
  const sin = textoResumen({ ...VACIO, fallidos: 1 }, AHORA)!;
  assert.ok(!sin.includes('Bizum'));
});

test('caducidad: 24 h para el justificante, 10 minutos para lo que pide John en el chat', () => {
  assert.equal(CADUCIDAD_JUSTIFICANTE_MS, 24 * 3600 * 1000);
  assert.equal(CADUCIDAD_MIN, 10);
});

test('caducaTexto: hoy, mañana u otro día (hora de Madrid)', () => {
  const ahora = new Date('2026-11-15T09:40:00Z');   // 10:40 en Madrid
  assert.equal(caducaTexto(new Date('2026-11-15T09:50:00Z'), ahora), 'a las 10:50');
  assert.equal(caducaTexto(new Date(ahora.getTime() + CADUCIDAD_JUSTIFICANTE_MS), ahora), 'mañana a las 10:40');
  assert.equal(caducaTexto(new Date('2026-11-17T09:40:00Z'), ahora), 'el martes 17 a las 10:40');
  // 23:55 en Madrid es ya otro día en UTC+0 para la medianoche: cuenta el día de Madrid.
  assert.equal(caducaTexto(new Date('2026-11-15T22:55:00Z'), ahora), 'a las 23:55');
});
