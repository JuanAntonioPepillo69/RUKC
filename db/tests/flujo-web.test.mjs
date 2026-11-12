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
// WhatsApp (YCloud) simulado para la confirmación de plaza (B1).
process.env.YCLOUD_API_KEY = 'clave_simulada';
process.env.YCLOUD_PHONE_E164 = '+34602072802';
process.env.BETTER_AUTH_SECRET ||= 'secreto_de_prueba_para_firmar';
process.env.YCLOUD_WEBHOOK_SECRET = 'whsec_prueba_flujo';
const ADMIN_WA = `+34699${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
process.env.ADMIN_PHONE_E164 = ADMIN_WA;

const { POST: crear, PATCH: actualizar } = await import('../../api/solicitud.js');
const { POST: pagar } = await import('../../api/checkout/index.js');
const { GET: estadoPago } = await import('../../api/checkout/estado.js');
const { POST: webhook } = await import('../../api/stripe-webhook.js');
const { GET: catalogo } = await import('../../api/catalogo.js');
const { GET: grupo } = await import('../../api/grupo.js');
const { enviarConfirmacionReserva, leerTokenGrupo, fechaLarga } = await import('../../lib/whatsapp/confirmacion.js');
const { manejar: webhookWa } = await import('../../api/wa/webhook.js');
const { recordatoriosBizum } = await import('../../lib/bot/bizum.js');
const { firmar } = await import('../../lib/whatsapp/signature.js');

// Mensajes de WhatsApp entrantes firmados como YCloud.
let nWa = 0;
async function whatsappEntrante(from, contenido) {
  nWa += 1;
  const ev = { id: `evt_flujo_${Date.now()}_${nWa}`, type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date().toISOString(),
    whatsappInboundMessage: { id: `in_flujo_${Date.now()}_${nWa}`, wamid: `wamid.flujo.${Date.now()}.${nWa}`, from, to: '+34602072802', ...contenido } };
  const raw = JSON.stringify(ev);
  const t = Math.floor(Date.now() / 1000);
  return webhookWa(new Request(`${BASE}/api/wa/webhook`, { method: 'POST', body: raw,
    headers: { 'YCloud-Signature': `t=${t},s=${firmar(raw, process.env.YCLOUD_WEBHOOK_SECRET, t)}` } }), { esperar: true, esperaAgruparMs: 0 });
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = async (t, p) => (await pool.query(t, p)).rows;
const BASE = 'https://raceupkc-pruebas.vercel.app';

// --- Stripe y Meta simulados -------------------------------------------------------------------------------------
const llamadas = { stripe: [], meta: [], ycloud: [] };
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
  if (u.startsWith('https://api.ycloud.com/')) {
    const cuerpo = JSON.parse(init.body);
    llamadas.ycloud.push(cuerpo);
    return Response.json({ id: `yc_sim_${Date.now()}_${llamadas.ycloud.length}`, wamid: `wamid.sim.${Date.now()}.${llamadas.ycloud.length}`, status: 'accepted', ...cuerpo });
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
  await q('DELETE FROM tutela WHERE menor_persona_id = ANY($1::uuid[]) OR tutor_persona_id = ANY($1::uuid[])', [personas]);
  for (const t of ['onboarding', 'consentimiento', 'interaccion', 'oportunidad']) {
    await q(`DELETE FROM ${t} WHERE persona_id = ANY($1::uuid[])`, [personas]);
  }
  await q('DELETE FROM persona WHERE id = ANY($1::uuid[])', [personas]);
  const telefonosWa = [...new Set([...llamadas.ycloud.map((m) => m.to), ADMIN_WA])];
  await q(`DELETE FROM wa_webhook_events WHERE provider_event_id LIKE 'evt_flujo_%'`);
  await q(`UPDATE admin_actions SET estado = 'cancelada' WHERE estado = 'propuesta'`);
  const contactos = (await q('SELECT id FROM wa_contacts WHERE phone_e164 = ANY($1)', [telefonosWa])).map((x) => x.id);
  // wa_consents es de solo añadir para rukc_app: se limpia con el rol de migraciones.
  if (process.env.DATABASE_URL_MIGRACIONES) {
    const limpia = new Pool({ connectionString: process.env.DATABASE_URL_MIGRACIONES });
    await limpia.query('DELETE FROM wa_consents WHERE contact_id = ANY($1::uuid[])', [contactos]);
    await limpia.end();
  }
  for (const t of ['wa_outbox', 'wa_messages', 'wa_conversations']) await q(`DELETE FROM ${t} WHERE contact_id = ANY($1::uuid[])`, [contactos]);
  await q('DELETE FROM wa_contacts WHERE id = ANY($1::uuid[])', [contactos]);
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
  llamadas.ycloud.length = 0;
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

  // B1: confirmación de plaza por WhatsApp al piloto, con su botón al grupo; el aviso repetido no la reenvía.
  const confirmaciones = llamadas.ycloud.filter((m) => m.template?.name === 'rukc_reserva_confirmada');
  assert.equal(confirmaciones.length, 1, JSON.stringify(llamadas.ycloud));
  const [m] = confirmaciones;
  const [rr] = await q('SELECT r.numero, r.fecha::text AS fecha, c.nombre AS circuito, i.id FROM ronda r JOIN circuito c ON c.id = r.circuito_id JOIN inscripcion i ON i.ronda_id = r.id JOIN solicitud_inscripcion s ON s.pedido_id = i.pedido_id WHERE s.id = $1', [s.id]);
  assert.deepEqual(m.template.components[0].parameters.map((p) => p.text),
    ['Prueba', `R${rr.numero}`, fechaLarga(rr.fecha), rr.circuito, '69', 'https://raceupkc.com/reglamento']);
  const token = m.template.components[1].parameters[0].text;
  assert.equal(leerTokenGrupo(token), rr.id);

  // /grupo/<token>: sin acceso aprobado, a la ficha del piloto; un token cambiado no vale.
  const g = await grupo(new Request(`${BASE}/api/grupo?token=${token}`));
  assert.equal(g.status, 302);
  assert.match(g.headers.get('location'), /^https:\/\/raceupkc\.com\/onboarding\/[\w-]{40,}$/);
  const malo = await grupo(new Request(`${BASE}/api/grupo?token=${token.slice(0, -2)}xx`));
  assert.equal(malo.status, 404);

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

test('Bizum: con el código ya dado, cambiar el piloto no sobrescribe la reserva; volver sin cambios sí conserva el código', async () => {
  const { cuerpo } = await nuevaSolicitud();
  await completar(cuerpo.token, { pagador_nombre: 'Paga Prueba', piloto_es_pagador: true });
  const dar = await pagar(peticion('POST', '/api/checkout', { token: cuerpo.token, cuerpo: { metodo: 'bizum', acepta: true } }));
  assert.equal(dar.status, 200);

  const igual = await actualizar(peticion('PATCH', '/api/solicitud', { token: cuerpo.token, cuerpo: { campos: {
    pagador_nombre: 'Paga Prueba', piloto_es_pagador: true, piloto_nombre: '', metodo_elegido: 'bizum', paso_actual: 3, acepta_comunicaciones: true } } }));
  assert.equal(igual.status, 200, 'sin cambios en los datos sigue siendo la misma reserva');

  const otro = await actualizar(peticion('PATCH', '/api/solicitud', { token: cuerpo.token, cuerpo: { campos: {
    piloto_es_pagador: false, piloto_nombre: 'Amigo Prueba' } } }));
  assert.equal(otro.status, 409);
  assert.equal((await otro.json()).estado, 'enviada');
  const [s] = await q('SELECT piloto_es_pagador, piloto_nombre FROM solicitud_inscripcion WHERE codigo = $1', [cuerpo.codigo]);
  assert.deepEqual(s, { piloto_es_pagador: true, piloto_nombre: null });
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

  const [ins] = await q(`SELECT i.id, pil.telefono AS piloto_tel, pag.telefono AS pagador_tel FROM inscripcion i
    JOIN solicitud_inscripcion s ON s.pedido_id = i.pedido_id JOIN persona pil ON pil.id = i.piloto_persona_id
    JOIN pedido pe ON pe.id = i.pedido_id JOIN persona pag ON pag.id = pe.pagador_persona_id WHERE s.id = $1`, [s.id]);
  const alPiloto = llamadas.ycloud.filter((m) => m.to === ins.piloto_tel && m.template?.name === 'rukc_reserva_confirmada');
  assert.equal(alPiloto.length, 1);
  assert.equal(alPiloto[0].template.components[0].parameters[0].text, 'Piloto');

  // Si el piloto es menor: al tutor (quien paga) la variante de tutor; al menor no se le repite.
  await q('UPDATE inscripcion SET es_menor = true WHERE id = $1', [ins.id]);
  const antes = llamadas.ycloud.length;
  const res = await enviarConfirmacionReserva(ins.id);
  const nuevas = llamadas.ycloud.slice(antes);
  assert.equal(nuevas.length, 1, JSON.stringify(res));
  assert.equal(nuevas[0].to, ins.pagador_tel);
  assert.equal(nuevas[0].template.name, 'rukc_reserva_confirmada_tutor');
  assert.deepEqual(nuevas[0].template.components[0].parameters.slice(0, 2).map((p) => p.text), ['Prueba', 'Piloto']);
});

test('Bizum por WhatsApp: el justificante avisa a John con código y CONFIRMO reserva la plaza y manda la confirmación', async () => {
  await q(`UPDATE cupo_ronda SET estado_inscripcion = 'abierta' WHERE ronda_id = $1`, [ronda.id]);
  const { cuerpo, telefono } = await nuevaSolicitud();
  const pilotoTel = tel();
  await completar(cuerpo.token, { piloto_es_pagador: false, piloto_nombre: 'Lucía Bizum', piloto_telefono: pilotoTel });
  await pagar(peticion('POST', '/api/checkout', { token: cuerpo.token, cuerpo: { metodo: 'bizum', acepta: true } }));

  // John con su ventana de 24 h abierta.
  await whatsappEntrante(ADMIN_WA, { type: 'text', text: { body: 'ESTADO' } });
  llamadas.ycloud.length = 0;

  // B2: el pagador manda la captura del Bizum.
  await whatsappEntrante(telefono, { type: 'image', image: { id: 'media_1', mime_type: 'image/jpeg' } });
  const acuse = llamadas.ycloud.find((m) => m.to === telefono);
  assert.match(acuse?.text?.body ?? '', /El equipo comprueba el Bizum/);
  const aviso = llamadas.ycloud.find((m) => m.to === ADMIN_WA)?.text?.body ?? '';
  assert.match(aviso, /Justificante de Bizum/);
  assert.match(aviso, new RegExp(cuerpo.codigo));
  const codigo = aviso.match(/CONFIRMO (\d{4})/)?.[1];
  assert.ok(codigo, aviso);

  // Otra foto con la propuesta viva: ni acuse ni aviso repetidos.
  const antes = llamadas.ycloud.length;
  await whatsappEntrante(telefono, { type: 'image', image: { id: 'media_2', mime_type: 'image/jpeg' } });
  assert.equal(llamadas.ycloud.length, antes);

  // B3: John confirma → solicitud pagada, inscripción reservada y confirmación de plaza al piloto.
  await whatsappEntrante(ADMIN_WA, { type: 'text', text: { body: `CONFIRMO ${codigo}` } });
  assert.match(llamadas.ycloud.filter((m) => m.to === ADMIN_WA).at(-1).text.body, /Bizum confirmado/);
  const [v] = await q(`SELECT s.estado, i.estado AS inscripcion, pg.metodo FROM solicitud_inscripcion s
    JOIN inscripcion i ON i.pedido_id = s.pedido_id JOIN pago pg ON pg.referencia_externa = s.codigo WHERE s.codigo = $1`, [cuerpo.codigo]);
  assert.deepEqual(v, { estado: 'pagada', inscripcion: 'reservada', metodo: 'bizum_manual' });
  const conf = llamadas.ycloud.find((m) => m.to === pilotoTel && m.template?.name === 'rukc_reserva_confirmada');
  assert.ok(conf, 'confirmación al piloto');
  assert.equal(conf.template.components[0].parameters[0].text, 'Lucía');
});

test('Bizum: recordatorio a las 24 h, una sola vez y en horario', async () => {
  await q(`UPDATE cupo_ronda SET estado_inscripcion = 'abierta' WHERE ronda_id = $1`, [ronda.id]);
  const { cuerpo, telefono } = await nuevaSolicitud();
  await completar(cuerpo.token, { pagador_nombre: 'Marta Recordatorio' });
  await pagar(peticion('POST', '/api/checkout', { token: cuerpo.token, cuerpo: { metodo: 'bizum', acepta: true } }));
  const mediodia = new Date(`${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })}T11:00:00Z`); // 12:00 o 13:00 en Madrid
  await q(`UPDATE solicitud_inscripcion SET enviada_en = $2::timestamptz - interval '25 hours' WHERE codigo = $1`, [cuerpo.codigo, mediodia.toISOString()]);
  const noche = new Date(`${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })}T22:30:00Z`);
  assert.equal((await recordatoriosBizum({ ahora: noche })).nota, 'fuera de horario');

  llamadas.ycloud.length = 0;
  await recordatoriosBizum({ ahora: mediodia });
  const recordatorio = llamadas.ycloud.filter((m) => m.to === telefono && m.template?.name === 'rukc_bizum_pendiente');
  assert.equal(recordatorio.length, 1, JSON.stringify(llamadas.ycloud));
  assert.deepEqual(recordatorio[0].template.components[0].parameters.map((p) => p.text),
    ['Marta', `R${ronda.numero}`, `https://raceupkc.com/inscripcion?ronda=${ronda.numero}`]);
  await recordatoriosBizum({ ahora: mediodia });
  assert.equal(llamadas.ycloud.filter((m) => m.to === telefono).length, 1, 'no se repite');
});

test('formulario v2: piloto menor con su tutor → tutela, confirmación al tutor y al menor, y consentimientos con su versión', async () => {
  await q(`UPDATE cupo_ronda SET estado_inscripcion = 'abierta' WHERE ronda_id = $1`, [ronda.id]);
  const { cuerpo, telefono } = await nuevaSolicitud();
  const menorTel = tel();
  const tutorTel = tel();
  // Sin los datos del tutor no deja pagar.
  await completar(cuerpo.token, { pagador_nombre: 'Rosa Pagadora', piloto_es_pagador: false, piloto_nombre: 'Hugo Menor', piloto_telefono: menorTel, piloto_menor: true });
  const sinTutor = await pagar(peticion('POST', '/api/checkout', { token: cuerpo.token, cuerpo: { metodo: 'tarjeta', acepta: true, textos: 'formulario-web-v2-2026-11' } }));
  assert.equal(sinTutor.status, 400);
  assert.match((await sinTutor.json()).error, /padre, madre o tutor legal/);

  await completar(cuerpo.token, { pagador_nombre: 'Rosa Pagadora', piloto_es_pagador: false, piloto_nombre: 'Hugo Menor', piloto_telefono: menorTel,
    piloto_menor: true, tutor_nombre: 'Luis Tutor', tutor_telefono: tutorTel, tutor_relacion: 'padre', acepta_whatsapp_novedades: false });
  const res = await pagar(peticion('POST', '/api/checkout', { token: cuerpo.token, cuerpo: { metodo: 'tarjeta', acepta: true, textos: 'formulario-web-v2-2026-11' } }));
  assert.equal(res.status, 200, await res.clone().text());

  // Consentimientos de quien rellena: el aviso de WhatsApp (operativo) sí; sin la casilla, ningún comercial.
  const consentimientos = await q(`SELECT k.tipo, k.accion, k.fuente, k.otorgado_por, k.texto_version FROM wa_consents k
    JOIN wa_contacts c ON c.id = k.contact_id WHERE c.phone_e164 = $1 ORDER BY k.tipo`, [telefono]);
  assert.deepEqual(consentimientos, [{ tipo: 'operativo', accion: 'otorga', fuente: 'formulario_web', otorgado_por: 'tutor', texto_version: 'formulario-web-v2-2026-11' }]);

  // Pago con tarjeta → inscripción de menor, tutela con el tutor y confirmación al tutor (variante) y al menor.
  const [sol] = await q('SELECT id, stripe_checkout_session_id FROM solicitud_inscripcion WHERE codigo = $1', [cuerpo.codigo]);
  llamadas.ycloud.length = 0;
  const ev = eventoFirmado('checkout.session.completed', { id: sol.stripe_checkout_session_id, payment_status: 'paid', amount_total: 3000,
    payment_intent: `pi_sim_${Date.now()}_menor`, metadata: { solicitud_id: sol.id } });
  assert.equal((await webhook(ev.request())).status, 200);
  const [i] = await q(`SELECT i.es_menor, i.tutor_nombre, tu.relacion, pt.telefono AS tutor_tel FROM inscripcion i
    JOIN solicitud_inscripcion s ON s.pedido_id = i.pedido_id JOIN tutela tu ON tu.menor_persona_id = i.piloto_persona_id
    JOIN persona pt ON pt.id = tu.tutor_persona_id WHERE s.id = $1`, [sol.id]);
  assert.deepEqual(i, { es_menor: true, tutor_nombre: 'Luis Tutor', relacion: 'padre', tutor_tel: tutorTel });
  const alTutor = llamadas.ycloud.find((m) => m.to === tutorTel);
  assert.equal(alTutor?.template?.name, 'rukc_reserva_confirmada_tutor');
  assert.deepEqual(alTutor.template.components[0].parameters.slice(0, 2).map((p) => p.text), ['Luis', 'Hugo']);
  assert.equal(llamadas.ycloud.find((m) => m.to === menorTel)?.template?.name, 'rukc_reserva_confirmada');
  assert.ok(!llamadas.ycloud.some((m) => m.to === telefono), 'a quien paga (no es el tutor) no le llega');
});

test('formulario v2: con la casilla de novedades marcada se guarda también el consentimiento comercial', async () => {
  await q(`UPDATE cupo_ronda SET estado_inscripcion = 'abierta' WHERE ronda_id = $1`, [ronda.id]);
  const { cuerpo, telefono } = await nuevaSolicitud();
  await completar(cuerpo.token, { acepta_whatsapp_novedades: true });
  await pagar(peticion('POST', '/api/checkout', { token: cuerpo.token, cuerpo: { metodo: 'bizum', acepta: true, textos: 'formulario-web-v2-2026-11' } }));
  // Volver a pulsar pagar no duplica.
  await pagar(peticion('POST', '/api/checkout', { token: cuerpo.token, cuerpo: { metodo: 'bizum', acepta: true, textos: 'formulario-web-v2-2026-11' } }));
  const tipos = await q(`SELECT k.tipo, k.otorgado_por FROM wa_consents k JOIN wa_contacts c ON c.id = k.contact_id
    WHERE c.phone_e164 = $1 ORDER BY k.tipo`, [telefono]);
  assert.deepEqual(tipos, [{ tipo: 'comercial', otorgado_por: 'titular' }, { tipo: 'operativo', otorgado_por: 'titular' }]);
});

test('formulario anterior (sin FORM_V2): no se guarda nada en wa_consents', async () => {
  await q(`UPDATE cupo_ronda SET estado_inscripcion = 'abierta' WHERE ronda_id = $1`, [ronda.id]);
  const { cuerpo, telefono } = await nuevaSolicitud();
  await completar(cuerpo.token, { acepta_comunicaciones: true });
  await pagar(peticion('POST', '/api/checkout', { token: cuerpo.token, cuerpo: { metodo: 'bizum', acepta: true } }));
  const filas = await q(`SELECT 1 FROM wa_consents k JOIN wa_contacts c ON c.id = k.contact_id WHERE c.phone_e164 = $1`, [telefono]);
  assert.equal(filas.length, 0);
});
