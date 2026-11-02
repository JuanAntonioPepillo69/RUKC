// Pago de la reserva: validación del formulario, sesión de Stripe sin datos personales, firma del webhook,
// atribución y teléfonos. Sin base de datos: los flujos completos están en db/tests/flujo-web.test.mjs (npm run db:test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parametrosSesion, POST as checkout } from '../api/checkout/index.js';
import { POST as webhook, eventoCompra, firmaValida } from '../api/stripe-webhook.js';
import { canal, limpiarOrigen } from '../lib/atribucion.js';
import { normalizarTelefono } from '../lib/telefono.js';
import { crearSolicitud, faltaParaPagar, pedirPago } from '../lib/validacion/solicitud.js';
import { diaSemana, restarDias } from '../src/lib/season/format.ts';

const firmar = (payload: string, secreto: string, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${crypto.createHmac('sha256', secreto).update(`${t}.${payload}`).digest('hex')}`;

const SOLICITUD = {
  id: '00000000-0000-4000-8000-000000000001', codigo: 'RK-AB23', pagador_email: 'carlos@mail.com', pagador_nombre: 'Carlos Martín',
  pagador_telefono: '+34600112233', importe_reserva_cent: 3000, ronda_numero: 2, circuito: 'Karting Campillos', ronda_fecha: '2026-11-21',
};

test('teléfonos: se normalizan a E.164 y se rechazan los que no lo son', () => {
  assert.equal(normalizarTelefono('600 11 22 33'), '+34600112233');
  assert.equal(normalizarTelefono('0034 600112233'), '+34600112233');
  assert.equal(normalizarTelefono('+44 7700 900123'), '+447700900123');
  assert.equal(normalizarTelefono('123'), null);
  assert.equal(normalizarTelefono(''), null);
});

test('formulario: el borrador valida teléfono y email; pagar exige aceptar y datos completos', () => {
  assert.equal(crearSolicitud.safeParse({ campos: { pagador_telefono: '600112233' } }).data?.campos.pagador_telefono, '+34600112233');
  assert.equal(crearSolicitud.safeParse({ campos: { pagador_email: 'x' } }).success, false);
  assert.equal(crearSolicitud.safeParse({ campos: { desconocido: 1 } }).success, false);
  assert.equal(pedirPago.safeParse({ metodo: 'tarjeta', acepta: false }).success, false);
  assert.match(faltaParaPagar({ ...SOLICITUD, ronda_id: 'x', categoria_elegida: 'LIG', piloto_es_pagador: false })!, /piloto/);
  assert.equal(faltaParaPagar({ ...SOLICITUD, ronda_id: 'x', categoria_elegida: 'LIG', piloto_es_pagador: true }), null);
});

test('sesión de Stripe: importe de reserva, caduca a los 30 min y solo solicitud_id en los metadatos', () => {
  const ahora = Date.now();
  const p = parametrosSesion(SOLICITUD, 'https://raceupkc.com', ahora);
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '3000');
  assert.ok(Number(p.get('expires_at')) - ahora / 1000 >= 1800);
  assert.deepEqual([...p.keys()].filter((k) => k.includes('metadata')).sort(), ['metadata[solicitud_id]', 'payment_intent_data[metadata][solicitud_id]']);
  for (const [, v] of p) assert.doesNotMatch(v, /Carlos|Martín|600112233/);
  assert.equal(p.get('success_url'), 'https://raceupkc.com/inscripcion/confirmada');
});

test('checkout: sin token del borrador responde 401', async () => {
  const res = await checkout(new Request('https://raceupkc.com/api/checkout', { method: 'POST', body: JSON.stringify({ metodo: 'tarjeta', acepta: true }) }));
  assert.equal(res.status, 401);
});

test('webhook: firma válida y reciente; sin secreto 503; firma mala 400', async () => {
  const body = '{"a":1}';
  assert.equal(firmaValida(body, firmar(body, 'whsec_1'), 'whsec_1'), true);
  assert.equal(firmaValida(body, firmar(body, 'whsec_otro'), 'whsec_1'), false);
  assert.equal(firmaValida('{"a":2}', firmar(body, 'whsec_1'), 'whsec_1'), false);
  assert.equal(firmaValida(body, firmar(body, 'whsec_1', Math.floor(Date.now() / 1000) - 3600), 'whsec_1'), false);
  const prev = process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  assert.equal((await webhook(new Request('https://raceupkc.com/api/stripe-webhook', { method: 'POST', body }))).status, 503);
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  assert.equal((await webhook(new Request('https://raceupkc.com/api/stripe-webhook', { method: 'POST', body, headers: { 'stripe-signature': 't=1,v1=00' } }))).status, 400);
  if (prev) process.env.STRIPE_WEBHOOK_SECRET = prev; else delete process.env.STRIPE_WEBHOOK_SECRET;
});

test('Purchase para Meta: solo con consentimiento de medición y con event_id = id del pago', () => {
  const solicitud = { consentimiento_medicion: true, pagador_email: 'a@b.c', pagador_telefono: '+34600112233', fbp: 'fb.1.x', fbc: null };
  const ev = eventoCompra({ pagoId: 'pago-1', importeCent: 3000, solicitud, creadoEn: 1 })!;
  assert.equal(ev.event_name, 'Purchase');
  assert.equal(ev.event_id, 'pago-1');
  assert.equal(ev.custom_data.value, 30);
  assert.equal(ev.user_data.em.length, 64);
  assert.equal(eventoCompra({ pagoId: 'pago-1', importeCent: 3000, solicitud: { ...solicitud, consentimiento_medicion: false } }), null);
});

test('atribución: canal según UTM, fbclid, landing y referrer; fbc/fbp solo con consentimiento', () => {
  assert.equal(canal({ fbclid: 'x' }), 'meta_ads');
  assert.equal(canal({ landing_path: '/acceso-t2-c7e594' }), 'meta_ads');
  assert.equal(canal({ utm_source: 'instagram', utm_medium: 'bio' }), 'instagram');
  assert.equal(canal({ referrer: 'https://wa.me/' }), 'whatsapp');
  assert.equal(canal({}), 'web_directa');
  assert.equal(limpiarOrigen({ utm_source: 'ig' }, { consentimiento: false, fbp: 'fb.1' })!.fbp, null);
  assert.equal(limpiarOrigen({ utm_source: 'ig' }, { consentimiento: true, fbp: 'fb.1' })!.fbp, 'fb.1');
  assert.equal(limpiarOrigen(null), null);
});

test('fechas: día de la semana y resta de días', () => {
  assert.equal(diaSemana('2026-11-21'), 'sábado');
  assert.equal(restarDias('2026-11-21', 4), '2026-11-17');
});
