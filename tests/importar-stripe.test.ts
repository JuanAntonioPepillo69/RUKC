// Importación de las reservas antiguas de Stripe (D4): de la sesión a los datos de la solicitud, sin base de datos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretar } from '../db/importar-stripe.mjs';

const sesion = (metadata: object = {}, extra: object = {}) => ({
  id: 'cs_1', payment_intent: 'pi_1', payment_status: 'paid', amount_total: 3000, created: 1793000000,
  customer_details: { email: 'Piloto@Ejemplo.com' },
  metadata: { producto: 'reserva-t2', ronda: 'R2 · sáb 21 nov · Karting Campillos', nombre: 'Ana Ruiz Gil', telefono: '600112233', categoria: 'Ligeros', origen: 'landing', meta: 'no', fbc: 'x', fbp: 'y', ...metadata },
  ...extra,
});
const cargo = { created: 1793000100, amount_refunded: 0, payment_method_details: { type: 'card' } };

test('Una reserva pagada: ronda, categoría, teléfono en E.164 y email en minúsculas', () => {
  const { fila } = interpretar(sesion(), cargo);
  assert.equal(fila.numero, 2);
  assert.equal(fila.categoria, 'LIG');
  assert.equal(fila.telefono, '+34600112233');
  assert.equal(fila.email, 'piloto@ejemplo.com');
  assert.equal(fila.metodo, 'stripe_tarjeta');
  assert.equal(fila.fecha, new Date(1793000100 * 1000).toISOString());
});

test('"Aún no lo sé" queda sin categoría', () => {
  assert.equal(interpretar(sesion({ categoria: 'Aún no lo sé' }), cargo).fila.categoria, 'no_se');
});

test('La landing cuenta como Meta Ads y fbc/fbp solo se guardan con meta = si', () => {
  const sin = interpretar(sesion(), cargo).fila.origen;
  assert.equal(sin.canal, 'meta_ads');
  assert.equal(sin.fbc, null);
  assert.equal(interpretar(sesion({ meta: 'si' }), cargo).fila.origen.fbc, 'x');
  assert.equal(interpretar(sesion({ origen: 'web' }), cargo).fila.origen.canal, 'web_directa');
});

test('No se importa lo reembolsado, lo no pagado ni lo que no sea la reserva', () => {
  assert.equal(interpretar(sesion(), { ...cargo, amount_refunded: 3000 }).descartada, 'reembolsada');
  assert.ok(interpretar(sesion({}, { payment_status: 'unpaid' }), cargo).descartada);
  assert.ok(interpretar(sesion({ producto: 'otro' }), cargo).descartada);
  assert.equal(interpretar(sesion({ ronda: '' }), cargo).descartada, 'sin ronda');
});
