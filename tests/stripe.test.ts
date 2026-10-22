// Pago de la reserva con Stripe: validación del formulario, sesión de Checkout y aviso (webhook) con su firma.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { POST as checkout, parametrosCheckout, validarReserva } from '../api/checkout.js';
import { POST as webhook, eventoCompra, firmaValida } from '../api/stripe-webhook.js';
import { RESERVA } from '../src/config/reserva.js';

const OK = { nombre: 'Carlos Martín', email: 'Carlos@Mail.com ', telefono: '+34 600 11 22 33', categoria: 'Ligeros', acepta: true };
const firmar = (payload: string, secreto: string, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${crypto.createHmac('sha256', secreto).update(`${t}.${payload}`).digest('hex')}`;

test('reserva: valida nombre, correo, teléfono, categoría y condiciones', () => {
  assert.equal(validarReserva(OK).datos?.email, 'carlos@mail.com');
  assert.match(validarReserva({ ...OK, email: 'x' }).error!, /correo/);
  assert.match(validarReserva({ ...OK, telefono: '123' }).error!, /WhatsApp/);
  assert.match(validarReserva({ ...OK, categoria: 'Otra' }).error!, /categoría/);
  assert.match(validarReserva({ ...OK, acepta: 'true' }).error!, /condiciones/);
});

test('reserva: la sesión de Checkout cobra el importe en euros y lleva los datos en metadata', () => {
  const p = parametrosCheckout(validarReserva(OK).datos!, 'https://raceupkc.com', { ip: '1.2.3.4', ua: 'UA' });
  assert.equal(p.get('mode'), 'payment');
  assert.equal(p.get('line_items[0][price_data][currency]'), 'eur');
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), String(RESERVA.importe * 100));
  assert.equal(p.get('success_url'), 'https://raceupkc.com/inscripcion/confirmada?pago={CHECKOUT_SESSION_ID}');
  assert.equal(p.get('metadata[producto]'), RESERVA.id);
  assert.equal(p.get('metadata[categoria]'), 'Ligeros');
  assert.equal(p.has('payment_method_types[0]'), false); // los métodos se eligen en el panel de Stripe
  assert.equal(p.has('metadata[ip]'), false); // sin consentimiento de medición no se guardan datos para Meta
});

test('reserva: sin STRIPE_SECRET_KEY responde 503 con un mensaje claro', async () => {
  const prev = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  const res = await checkout(new Request('https://raceupkc.com/api/checkout', { method: 'POST', body: JSON.stringify(OK) }));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /WhatsApp/);
  if (prev) process.env.STRIPE_SECRET_KEY = prev;
});

test('reserva: con clave llama a Stripe y devuelve la URL de pago', async () => {
  const prevKey = process.env.STRIPE_SECRET_KEY, prevFetch = globalThis.fetch;
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  let llamada: { url: string; body: string } | undefined;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    llamada = { url, body: String(init.body) };
    return Response.json({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  }) as typeof fetch;
  try {
    const res = await checkout(new Request('https://raceupkc.com/api/checkout', { method: 'POST', body: JSON.stringify(OK) }));
    assert.deepEqual(await res.json(), { url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    assert.equal(llamada!.url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.match(llamada!.body, /unit_amount%5D=3000/);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey) process.env.STRIPE_SECRET_KEY = prevKey; else delete process.env.STRIPE_SECRET_KEY;
  }
});

test('webhook: acepta solo firmas válidas y recientes', () => {
  const body = '{"a":1}';
  assert.equal(firmaValida(body, firmar(body, 'whsec_1'), 'whsec_1'), true);
  assert.equal(firmaValida(body, firmar(body, 'whsec_otro'), 'whsec_1'), false);
  assert.equal(firmaValida('{"a":2}', firmar(body, 'whsec_1'), 'whsec_1'), false);
  assert.equal(firmaValida(body, firmar(body, 'whsec_1', Math.floor(Date.now() / 1000) - 3600), 'whsec_1'), false);
  assert.equal(firmaValida(body, null, 'whsec_1'), false);
});

test('webhook: Purchase para Meta solo si hubo consentimiento de medición', () => {
  const sesion = { id: 'cs_1', created: 1, amount_total: 3000, customer_details: { email: 'a@b.c' }, metadata: { producto: RESERVA.id, meta: 'si', telefono: '600112233', fbp: 'fb.1.x' } };
  const ev = eventoCompra(sesion)!;
  assert.equal(ev.event_name, 'Purchase');
  assert.equal(ev.event_id, 'cs_1');
  assert.deepEqual(ev.custom_data.value, 30);
  assert.equal(ev.user_data.fbp, 'fb.1.x');
  assert.equal(ev.user_data.em.length, 64);
  assert.equal(eventoCompra({ ...sesion, metadata: { ...sesion.metadata, meta: 'no' } }), null);
});

test('webhook: firma mala 400; pago completado sin token de Meta 200', async () => {
  const prev = process.env.STRIPE_WEBHOOK_SECRET, prevMeta = process.env.META_CAPI_TOKEN;
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  delete process.env.META_CAPI_TOKEN;
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 3000, metadata: { producto: RESERVA.id, meta: 'si' } } } });
  const req = (sig: string) => new Request('https://raceupkc.com/api/stripe-webhook', { method: 'POST', body, headers: { 'stripe-signature': sig } });
  try {
    assert.equal((await webhook(req('t=1,v1=00'))).status, 400);
    assert.equal((await webhook(req(firmar(body, 'whsec_test')))).status, 200);
  } finally {
    if (prev) process.env.STRIPE_WEBHOOK_SECRET = prev; else delete process.env.STRIPE_WEBHOOK_SECRET;
    if (prevMeta) process.env.META_CAPI_TOKEN = prevMeta;
  }
});
