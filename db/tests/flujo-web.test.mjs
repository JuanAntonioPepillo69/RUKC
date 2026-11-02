// Flujos F1 y F2 de punta a punta contra la rama de desarrollo de Neon, llamando a las funciones de api/ como lo haría
// Vercel. Stripe y Meta se simulan (no sale ninguna petición a internet salvo a Neon). Crea datos reales y los borra
// al terminar. Necesita DATABASE_URL (rukc_app) y el seed de la T2.
// Uso: npm run db:test
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');
process.env.STRIPE_SECRET_KEY = 'sk_test_simulada';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_simulado';
process.env.META_CAPI_TOKEN = 'token_simulado';

const { POST: crear, PATCH: actualizar } = await import('../../api/solicitud.js');
const { POST: pagar } = await import('../../api/checkout/index.js');
const { GET: estadoPago } = await import('../../api/checkout/estado.js');
const { POST: webhook } = await import('../../api/stripe-webhook.js');
const { GET: catalogo } = await import('../../api/catalogo.js');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = async (t, p) => (await pool.query(t, p)).rows;
const BASE = 'https://raceupkc-pruebas.vercel.app';

// --- Stripe y Meta simulados -------------------------------------------------------------------------------------
const llamadas = { stripe: [], meta: [] };
const fetchReal = globalThis.fetch;
let sesiones = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.stripe.com/')) {
    llamadas.stripe.push({ url: u, body: init.body ? String(init.body) : '' });
    if (u.endsWith('/v1/checkout/sessions')) {
      const id = `cs_test_sim_${++sesiones}_${Date.now()}`;
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}`, expires_at: Math.floor(Date.now() / 1000) + 1860 });
    }
    if (u.includes('/payment_intents/')) return Response.json({ id: 'pi', latest_charge: { payment_method_details: { type: 'card' } } });
    if (u.endsWith('/expire')) return Response.json({ status: 'expired' });
    return Response.json({ error: { message: 'no simulado' } }, { status: 400 });
  }
  if (u.startsWith('https://graph.facebook.com/')) {
    llamadas.meta.push(JSON.parse(init.body));
    return Response.json({ events_received: 1 });
  }
  return fetchReal(url, init);
};

const peticion = (metodo, ruta, { cuerpo, token } = {}) => new Request(`${BASE}${ruta}`, {
  method: metodo,
  headers: { 'content-type': 'application/json', 'user-agent': 'test', 'x-forwarded-for': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: cuerpo ? JSON.stringify(cuerpo) : undefined,
});

function eventoFirmado(tipo, objeto) {
  const evento = { id: `evt_sim_${crypto.randomUUID()}`, type: tipo, created: Math.floor(Date.now() / 1000), data: { object: objeto } };
  const payload = JSON.stringify(evento);
  const t = Math.floor(Date.now() / 1000);
  const firma = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
  return { evento, request: () => new Request(`${BASE}/api/stripe-webhook`, { method: 'POST', body: payload, headers: { 'stripe-signature': `t=${t},v1=${firma}` } }) };
}

// --- Datos de la prueba ------------------------------------------------------------------------------------------
const tel = () => `+3469${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const creadas = [];          // ids de solicitudes para limpiar
let ronda, cupoOriginal;

before(async () => {
  [ronda] = await q(`SELECT r.id, r.numero FROM ronda r JOIN temporada t ON t.id = r.temporada_id
    WHERE t.codigo = 'T2' AND r.estado = 'programada' AND r.fecha >= current_date ORDER BY r.fecha LIMIT 1`);
  cupoOriginal = await q(`SELECT categoria_id, estado_inscripcion FROM cupo_ronda WHERE ronda_id = $1`, [ronda.id]);
  await q(`UPDATE cupo_ronda SET estado_inscripcion = 'cerrada' WHERE ronda_id = $1`, [ronda.id]);
});

after(async () => {
  for (const c of cupoOriginal) {
    await q('UPDATE cupo_ronda SET estado_inscripcion = $3 WHERE ronda_id = $1 AND categoria_id = $2', [ronda.id, c.categoria_id, c.estado_inscripcion]);
  }
  const sol = await q('SELECT id, pedido_id FROM solicitud_inscripcion WHERE id = ANY($1::uuid[])', [creadas]);
  const pedidos = sol.map((s) => s.pedido_id).filter(Boolean);
  const personas = (await q(`SELECT DISTINCT x FROM (
      SELECT persona_id AS x FROM solicitud_inscripcion WHERE id = ANY($1::uuid[])
      UNION SELECT piloto_persona_id FROM inscripcion WHERE pedido_id = ANY($2::uuid[])
      UNION SELECT pagador_persona_id FROM pago WHERE referencia_externa IN (SELECT codigo FROM solicitud_inscripcion WHERE id = ANY($1::uuid[]))
    ) p WHERE x IS NOT NULL`, [creadas, pedidos])).map((r) => r.x);
  const pagos = (await q(`SELECT id FROM pago WHERE pagador_persona_id = ANY($1::uuid[])`, [personas])).map((r) => r.id);
  await q('DELETE FROM aplicacion_pago WHERE pago_id = ANY($1::uuid[])', [pagos]);
  await q('DELETE FROM pago WHERE id = ANY($1::uuid[])', [pagos]);
  await q('DELETE FROM inscripcion WHERE pedido_id = ANY($1::uuid[])', [pedidos]);
  await q('UPDATE solicitud_inscripcion SET pedido_id = NULL WHERE id = ANY($1::uuid[])', [creadas]);
  await q('DELETE FROM pedido WHERE id = ANY($1::uuid[])', [pedidos]);
  await q('DELETE FROM atribucion WHERE solicitud_id = ANY($1::uuid[]) OR persona_id = ANY($2::uuid[])', [creadas, personas]);
  await q('DELETE FROM solicitud_inscripcion WHERE id = ANY($1::uuid[])', [creadas]);
  for (const t of ['onboarding', 'consentimiento', 'interaccion', 'oportunidad']) {
    await q(`DELETE FROM ${t} WHERE persona_id = ANY($1::uuid[])`, [personas]);
  }
  await q('DELETE FROM persona WHERE id = ANY($1::uuid[])', [personas]);
  await q(`DELETE FROM stripe_evento WHERE stripe_event_id LIKE 'evt_sim_%'`);
  await q(`DELETE FROM limite_peticion WHERE ventana_inicio < now() + interval '1 day'`);
  globalThis.fetch = fetchReal;
  await pool.end();
});

async function nuevaSolicitud(extra = {}) {
  const telefono = tel();
  const res = await crear(peticion('POST', '/api/solicitud', { cuerpo: {
    campos: { pagador_telefono: telefono.replace('+34', ''), ronda_id: ronda.id },
    origen: { ultimo: { utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'r2-campillos', fbclid: 'IwAR-prueba', landing_path: '/acceso-t2-c7e594', capturada_en: new Date().toISOString() } },
    consentimiento_medicion: true, fbp: 'fb.1.123.456', ...extra,
  } }));
  const cuerpo = await res.json();
  if (cuerpo.token && res.status === 201) {
    const [s] = await q('SELECT id FROM solicitud_inscripcion WHERE codigo = $1', [cuerpo.codigo]);
    if (s) creadas.push(s.id);
  }
  return { res, cuerpo, telefono };
}

async function completar(token, campos = {}) {
  return actualizar(peticion('PATCH', '/api/solicitud', { token, cuerpo: { campos: {
    pagador_nombre: 'Prueba Integración', pagador_email: `prueba+${Date.now()}@example.com`, categoria_elegida: 'LIG', paso_actual: 2, ...campos } } }));
}

// --- Casos -------------------------------------------------------------------------------------------------------
test('catálogo: rondas futuras con cupo por categoría, precio y reserva', async () => {
  const res = await catalogo();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /max-age=60/);
  const c = await res.json();
  assert.equal(c.reserva_cent, 3000);
  assert.equal(c.carrera_cent, 9900);
  assert.ok(c.rondas.length >= 1 && c.rondas.every((r) => r.categorias.length === 2));
  // La fecha llega tal cual está en la base de datos, sin desplazarse por la zona horaria del servidor.
  const [bd] = await q('SELECT fecha::text AS fecha FROM ronda WHERE id = $1', [c.rondas[0].id]);
  assert.equal(c.rondas[0].fecha, bd.fecha);
  assert.equal(c.aviso_borradores.provisional, true);
});

test('borrador: se crea con el teléfono, guarda atribución y sale en v_embudo', async () => {
  const { res, cuerpo, telefono } = await nuevaSolicitud();
  assert.equal(res.status, 201);
  assert.match(cuerpo.codigo, /^RK-[A-Z2-9]{4}$/);
  const [e] = await q('SELECT estado, pagador_telefono, canal, utm_campaign FROM v_embudo WHERE codigo = $1', [cuerpo.codigo]);
  assert.deepEqual(e, { estado: 'borrador', pagador_telefono: telefono, canal: 'meta_ads', utm_campaign: 'r2-campillos' });
  const [a] = await q('SELECT fbp, fbclid FROM atribucion a JOIN solicitud_inscripcion s ON s.id = a.solicitud_id WHERE s.codigo = $1', [cuerpo.codigo]);
  assert.deepEqual(a, { fbp: 'fb.1.123.456', fbclid: 'IwAR-prueba' });
});

test('borrador: sin teléfono ni email no se crea; con el campo trampa no se guarda nada', async () => {
  const sin = await crear(peticion('POST', '/api/solicitud', { cuerpo: { campos: { pagador_nombre: 'X' } } }));
  assert.equal(sin.status, 400);
  const antes = (await q('SELECT count(*)::int AS n FROM solicitud_inscripcion'))[0].n;
  const trampa = await crear(peticion('POST', '/api/solicitud', { cuerpo: { campos: { pagador_telefono: '600000000' }, sitio_web: 'http://spam' } }));
  assert.equal(trampa.status, 201);
  assert.equal((await q('SELECT count(*)::int AS n FROM solicitud_inscripcion'))[0].n, antes);
});

test('pago con tarjeta: cupo cerrado → lista de espera; abierto → sesión de Stripe solo con solicitud_id', async () => {
  const { cuerpo } = await nuevaSolicitud();
  assert.equal((await completar(cuerpo.token)).status, 200);
  const cerrado = await pagar(peticion('POST', '/api/checkout', { token: cuerpo.token, cuerpo: { metodo: 'tarjeta', acepta: true } }));
  assert.equal(cerrado.status, 409);
  const c = await cerrado.json();
  assert.equal(c.cerrada, true);
  assert.match(c.lista_espera, /lista%20de%20espera/);

  await q(`UPDATE cupo_ronda SET estado_inscripcion = 'abierta' WHERE ronda_id = $1`, [ronda.id]);
  llamadas.stripe.length = 0;
  const ok = await pagar(peticion('POST', '/api/checkout', { token: cuerpo.token, cuerpo: { metodo: 'tarjeta', acepta: true } }));
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).url, /^https:\/\/checkout\.stripe\.com\//);
  const crearSesion = llamadas.stripe.find((l) => l.url.endsWith('/v1/checkout/sessions'));
  const p = new URLSearchParams(crearSesion.body);
  const meta = [...p.keys()].filter((k) => k.includes('metadata'));
  assert.deepEqual(meta.sort(), ['metadata[solicitud_id]', 'payment_intent_data[metadata][solicitud_id]']);
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '3000');
  assert.ok(Number(p.get('expires_at')) - Date.now() / 1000 >= 30 * 60);
  assert.doesNotMatch(p.get('payment_intent_data[description]'), /Prueba|Integración/);
  const [s] = await q('SELECT estado, metodo_elegido, stripe_checkout_session_id FROM solicitud_inscripcion WHERE codigo = $1', [cuerpo.codigo]);
  assert.equal(s.estado, 'enviada');
  assert.ok(s.stripe_checkout_session_id.startsWith('cs_test_sim_'));
  assert.ok(llamadas.meta.some((m) => m.data[0].event_name === 'Lead'), 'Lead a Meta con consentimiento');
});

test('webhook: pago completado → solicitud pagada, inscripción reservada (30 €), onboarding pendiente y Purchase; repetido no duplica', async () => {
  await q(`UPDATE cupo_ronda SET estado_inscripcion = 'abierta' WHERE ronda_id = $1`, [ronda.id]);
  const { cuerpo } = await nuevaSolicitud();
  await completar(cuerpo.token);
  await pagar(peticion('POST', '/api/checkout', { token: cuerpo.token, cuerpo: { metodo: 'tarjeta', acepta: true } }));
  const [s] = await q('SELECT id, stripe_checkout_session_id FROM solicitud_inscripcion WHERE codigo = $1', [cuerpo.codigo]);

  llamadas.meta.length = 0;
  const pi = `pi_sim_${Date.now()}`;
  const ev = eventoFirmado('checkout.session.completed', { id: s.stripe_checkout_session_id, payment_status: 'paid', amount_total: 3000,
    payment_intent: pi, metadata: { solicitud_id: s.id }, client_reference_id: s.id, created: Math.floor(Date.now() / 1000) });
  const r1 = await webhook(ev.request());
  assert.equal(r1.status, 200, await r1.clone().text());

  const [v] = await q(`SELECT s.estado AS solicitud, i.estado AS inscripcion, i.codigo, vi.pagado_cent, vi.saldo_cent, vi.onboarding,
      pg.metodo, pg.estado AS pago, pg.id AS pago_id
    FROM solicitud_inscripcion s JOIN inscripcion i ON i.pedido_id = s.pedido_id JOIN v_inscripciones vi ON vi.id = i.id
    JOIN pago pg ON pg.stripe_payment_intent_id = $2 WHERE s.id = $1`, [s.id, pi]);
  assert.deepEqual({ ...v, codigo: undefined, pago_id: undefined },
    { solicitud: 'pagada', inscripcion: 'reservada', codigo: undefined, pagado_cent: 3000, saldo_cent: 6900, onboarding: 'pendiente',
      metodo: 'stripe_tarjeta', pago: 'confirmado', pago_id: undefined });
  const purchase = llamadas.meta.find((m) => m.data[0].event_name === 'Purchase');
  assert.ok(purchase, 'Purchase enviado');
  assert.equal(purchase.data[0].event_id, v.pago_id);

  const cuenta = async () => (await q(`SELECT (SELECT count(*) FROM pago WHERE stripe_payment_intent_id = $1)::int AS pagos,
      (SELECT count(*) FROM inscripcion i JOIN solicitud_inscripcion s ON s.pedido_id = i.pedido_id WHERE s.id = $2)::int AS inscripciones`, [pi, s.id]))[0];
  const antes = await cuenta();
  const r2 = await webhook(ev.request());
  assert.equal(r2.status, 200);
  assert.equal((await r2.json()).duplicado, true);
  assert.deepEqual(await cuenta(), antes);
  assert.deepEqual(antes, { pagos: 1, inscripciones: 1 });

  const estado = await (await estadoPago(peticion('GET', '/api/checkout/estado', { token: cuerpo.token }))).json();
  assert.equal(estado.estado, 'pagada');
  assert.match(estado.onboarding_url, /\/onboarding\/[\w-]{40,}$/);
});

test('webhook: sesión caducada → pago_abandonado', async () => {
  await q(`UPDATE cupo_ronda SET estado_inscripcion = 'abierta' WHERE ronda_id = $1`, [ronda.id]);
  const { cuerpo } = await nuevaSolicitud();
  await completar(cuerpo.token);
  await pagar(peticion('POST', '/api/checkout', { token: cuerpo.token, cuerpo: { metodo: 'tarjeta', acepta: true } }));
  const [s] = await q('SELECT id, stripe_checkout_session_id FROM solicitud_inscripcion WHERE codigo = $1', [cuerpo.codigo]);
  const ev = eventoFirmado('checkout.session.expired', { id: s.stripe_checkout_session_id, payment_status: 'unpaid', metadata: { solicitud_id: s.id } });
  assert.equal((await webhook(ev.request())).status, 200);
  assert.equal((await q('SELECT estado FROM solicitud_inscripcion WHERE id = $1', [s.id]))[0].estado, 'pago_abandonado');
  const e = await (await estadoPago(peticion('GET', '/api/checkout/estado', { token: cuerpo.token }))).json();
  assert.deepEqual([e.estado, e.onboarding_url], ['pago_abandonado', undefined]);
});

test('Bizum: solicitud enviada con su código y ningún dato personal en el enlace de WhatsApp', async () => {
  await q(`UPDATE cupo_ronda SET estado_inscripcion = 'abierta' WHERE ronda_id = $1`, [ronda.id]);
  const { cuerpo, telefono } = await nuevaSolicitud();
  await completar(cuerpo.token, { pagador_nombre: 'Nombre Secreto', pagador_email: 'secreto@example.com', piloto_es_pagador: false,
    piloto_nombre: 'Hija Prueba', piloto_telefono: '611223344' });
  const res = await pagar(peticion('POST', '/api/checkout', { token: cuerpo.token, cuerpo: { metodo: 'bizum', acepta: true } }));
  assert.equal(res.status, 200);
  const { bizum } = await res.json();
  assert.equal(bizum.codigo, cuerpo.codigo);
  assert.equal(bizum.importe_cent, 3000);
  const texto = decodeURIComponent(bizum.whatsapp.split('text=')[1]);
  assert.match(texto, new RegExp(cuerpo.codigo));
  for (const dato of ['Nombre', 'Secreto', 'secreto@example.com', telefono.slice(3), '611223344', 'Hija']) {
    assert.ok(!texto.includes(dato), `El enlace de WhatsApp no debe llevar "${dato}"`);
  }
  const [s] = await q('SELECT estado, metodo_elegido, acepta_documentos FROM solicitud_inscripcion WHERE codigo = $1', [cuerpo.codigo]);
  assert.equal(s.estado, 'enviada');
  assert.equal(s.metodo_elegido, 'bizum');
  assert.ok(s.acepta_documentos.condiciones_reserva && s.acepta_documentos.privacidad);
});

test('paga otra persona: el webhook crea pagador y piloto por separado', async () => {
  await q(`UPDATE cupo_ronda SET estado_inscripcion = 'abierta' WHERE ronda_id = $1`, [ronda.id]);
  const { cuerpo } = await nuevaSolicitud();
  await completar(cuerpo.token, { piloto_es_pagador: false, piloto_nombre: 'Piloto Distinto', piloto_telefono: tel() });
  await pagar(peticion('POST', '/api/checkout', { token: cuerpo.token, cuerpo: { metodo: 'tarjeta', acepta: true } }));
  const [s] = await q('SELECT id, stripe_checkout_session_id FROM solicitud_inscripcion WHERE codigo = $1', [cuerpo.codigo]);
  const ev = eventoFirmado('checkout.session.completed', { id: s.stripe_checkout_session_id, payment_status: 'paid', amount_total: 3000,
    payment_intent: `pi_sim_${Date.now()}_b`, metadata: { solicitud_id: s.id } });
  assert.equal((await webhook(ev.request())).status, 200);
  const [v] = await q(`SELECT vi.piloto, vi.pagador, vi.paga_otra_persona, vi.estado FROM v_inscripciones vi
    JOIN inscripcion i ON i.id = vi.id JOIN solicitud_inscripcion s ON s.pedido_id = i.pedido_id WHERE s.id = $1`, [s.id]);
  assert.deepEqual(v, { piloto: 'Piloto Distinto', pagador: 'Prueba Integración', paga_otra_persona: true, estado: 'reservada' });
});
