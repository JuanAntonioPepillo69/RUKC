// Flujos F1 y F2 de punta a punta contra la rama de desarrollo de Neon, llamando a las funciones de api/ como lo haría
// Vercel. Stripe y Meta se simulan (no sale ninguna petición a internet salvo a Neon). Crea datos reales y los borra
// al terminar. Necesita DATABASE_URL (rukc_app) y el seed de la T2.
// Uso: npm run db:test
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from '@neondatabase/serverless';
import { RONDAS, rondaPorId } from '../../src/config/feedback/rondas.js';

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
const { planificar, procesarCola } = await import('../../lib/whatsapp/programador.js');
const INICIO_TESTS = new Date();
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
const telefonosPrueba = new Set();   // todos los teléfonos que usan estos tests, para limpiar al final
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
    telefonosPrueba.add(cuerpo.to);
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
const tel = () => { const t = `+3469${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`; telefonosPrueba.add(t); return t; };
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
  const tutores = (await q('SELECT tutor_persona_id AS x FROM tutela WHERE menor_persona_id = ANY($1::uuid[])', [personas])).map((r) => r.x);
  personas.push(...tutores.filter((x) => !personas.includes(x)));
  for (const p of await q('SELECT telefono FROM persona WHERE id = ANY($1::uuid[]) AND telefono IS NOT NULL', [personas])) telefonosPrueba.add(p.telefono);
  const pagos = (await q(`SELECT id FROM pago WHERE pagador_persona_id = ANY($1::uuid[])`, [personas])).map((r) => r.id);
  await q('DELETE FROM aplicacion_pago WHERE pago_id = ANY($1::uuid[])', [pagos]);
  await q('DELETE FROM pago WHERE id = ANY($1::uuid[])', [pagos]);
  await q('DELETE FROM envio_feedback WHERE inscripcion_id IN (SELECT id FROM inscripcion WHERE pedido_id = ANY($1::uuid[]))', [pedidos]);
  if (plantillaFeedback) {
    await q('UPDATE plantilla_feedback SET activa = false WHERE id = $1', [plantillaFeedback]);
    await q('DELETE FROM plantilla_feedback WHERE id = $1', [plantillaFeedback]);
  }
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
  const telefonosWa = [...telefonosPrueba, ADMIN_WA];
  await q(`DELETE FROM wa_webhook_events WHERE provider_event_id LIKE 'evt_flujo_%'`);
  await q(`UPDATE admin_actions SET estado = 'cancelada' WHERE estado = 'propuesta'`);
  const lotes = (await q('SELECT id FROM wa_batches WHERE created_at >= $1', [INICIO_TESTS])).map((x) => x.id);
  await q('DELETE FROM wa_outbox WHERE lote_id = ANY($1::uuid[])', [lotes]);
  await q('DELETE FROM wa_batches WHERE id = ANY($1::uuid[])', [lotes]);
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

// --- Fase 3: recordatorios programados ---------------------------------------------------------------------------
/** Un piloto con plaza pagada con tarjeta en la ronda de los tests. Devuelve su teléfono. */
async function pilotoConPlaza(categoria = 'LIG') {
  await q(`UPDATE cupo_ronda SET estado_inscripcion = 'abierta' WHERE ronda_id = $1`, [ronda.id]);
  const { cuerpo, telefono } = await nuevaSolicitud();
  await completar(cuerpo.token, { categoria_elegida: categoria });
  await pagar(peticion('POST', '/api/checkout', { token: cuerpo.token, cuerpo: { metodo: 'tarjeta', acepta: true } }));
  const [sol] = await q('SELECT id, stripe_checkout_session_id FROM solicitud_inscripcion WHERE codigo = $1', [cuerpo.codigo]);
  const ev = eventoFirmado('checkout.session.completed', { id: sol.stripe_checkout_session_id, payment_status: 'paid', amount_total: 3000,
    payment_intent: `pi_sim_${Date.now()}_${Math.random()}`, metadata: { solicitud_id: sol.id } });
  assert.equal((await webhook(ev.request())).status, 200);
  return telefono;
}
/** Instante de Madrid: fecha de la ronda + días, a la hora dada. */
async function enMadrid(dias, hora) {
  const [x] = await q(`SELECT (($1::date + $2::int)::text || ' ' || $3)::timestamp AT TIME ZONE 'Europe/Madrid' AS t`, [ronda.fecha, dias, hora]);
  return new Date(x.t);
}
const deEstosTests = (d) => telefonosPrueba.has(d.telefono);

test('fase 3 · D1: propuesta a las 12:00 con código; sin CONFIRMO a las 18:00 no sale; con CONFIRMO, una sola vez', async () => {
  [ronda.fecha] = (await q('SELECT fecha::text AS f FROM ronda WHERE id = $1', [ronda.id])).map((x) => x.f);
  await q(`UPDATE ronda SET maps_url = coalesce(maps_url, 'https://maps.app.goo.gl/prueba') WHERE id = $1`, [ronda.id]);
  await q(`UPDATE cupo_ronda SET hora_llegada = coalesce(hora_llegada, '14:30'), hora_briefing = coalesce(hora_briefing, '15:30') WHERE ronda_id = $1`, [ronda.id]);
  const telefono = await pilotoConPlaza('LIG');
  const baja = await pilotoConPlaza('LIG');
  await q(`UPDATE wa_contacts SET baja = 'total' WHERE phone_e164 = $1`, [baja]);
  await whatsappEntrante(ADMIN_WA, { type: 'text', text: { body: 'ESTADO' } });   // John con la ventana abierta
  llamadas.ycloud.length = 0;

  // 12:30, una semana antes: propuesta a John, nada a los pilotos.
  await planificar({ ahora: await enMadrid(-7, '12:30'), filtrarDestinatarios: deEstosTests });
  const propuesta = llamadas.ycloud.filter((m) => m.to === ADMIN_WA).at(-1)?.text?.body ?? '';
  assert.match(propuesta, /Recordatorio de una semana de la R\d+/);
  assert.match(propuesta, /Ejemplo:/);
  assert.match(propuesta, /Queda una semana para la R\d+ de RUKC/);
  assert.match(propuesta, /para \d+ persona\(s\)/);
  const enLote = await q(`SELECT c.phone_e164 AS t FROM wa_outbox o JOIN wa_contacts c ON c.id = o.contact_id
    WHERE o.automatizacion = 'D1' AND o.created_at >= $1`, [INICIO_TESTS]);
  assert.ok(enLote.some((x) => x.t === telefono));
  assert.ok(!enLote.some((x) => x.t === baja), 'quien se dio de baja no entra en el lote');
  const codigo = propuesta.match(/CONFIRMO (\d{4})/)?.[1];
  assert.ok(codigo, propuesta);
  // Planificar otra vez no repite la propuesta.
  const antes = llamadas.ycloud.length;
  await planificar({ ahora: await enMadrid(-7, '12:40'), filtrarDestinatarios: deEstosTests });
  assert.equal(llamadas.ycloud.length, antes);

  // 18:05 sin confirmar: no sale nada y John recibe el aviso.
  await procesarCola({ ahora: await enMadrid(-7, '18:05') });
  await planificar({ ahora: await enMadrid(-7, '18:05'), filtrarDestinatarios: deEstosTests });
  assert.ok(!llamadas.ycloud.some((m) => m.to === telefono), 'sin CONFIRMO no sale');
  assert.match(llamadas.ycloud.filter((m) => m.to === ADMIN_WA).at(-1).text.body, /no ha salido a las 18:00 porque falta tu CONFIRMO/);

  // CONFIRMO: queda en la cola; el cron dos veces → un solo mensaje, con su hora de llegada.
  await whatsappEntrante(ADMIN_WA, { type: 'text', text: { body: `CONFIRMO ${codigo}` } });
  assert.match(llamadas.ycloud.filter((m) => m.to === ADMIN_WA).at(-1).text.body, /Confirmado/);
  await procesarCola({ ahora: await enMadrid(-7, '18:10') });
  await procesarCola({ ahora: await enMadrid(-7, '18:15') });
  const recibidos = llamadas.ycloud.filter((m) => m.to === telefono && m.template?.name === 'rukc_recordatorio_semana');
  assert.equal(recibidos.length, 1);
  assert.equal(recibidos[0].template.components[0].parameters[4].text, '14:30');
  assert.ok(!llamadas.ycloud.some((m) => m.to === baja && m.template?.name === 'rukc_recordatorio_semana'));
});

test('fase 3 · D2 fuera de horario espera a las 9:30 y se anula si la ronda ya pasó; D3 borrador para el grupo', async () => {
  const telefono = await pilotoConPlaza('PES');
  llamadas.ycloud.length = 0;
  // D3, dos días antes: borrador solo a John.
  await planificar({ ahora: await enMadrid(-2, '12:05'), filtrarDestinatarios: deEstosTests });
  assert.ok(llamadas.ycloud.some((m) => m.to === ADMIN_WA && /Borrador para el grupo de pilotos/.test(m.text?.body ?? '')));
  // D2, la víspera.
  await planificar({ ahora: await enMadrid(-1, '12:05'), filtrarDestinatarios: deEstosTests });
  const propuesta = llamadas.ycloud.filter((m) => m.to === ADMIN_WA).at(-1).text.body;
  assert.match(propuesta, /Recordatorio de la víspera/);
  const codigo = propuesta.match(/CONFIRMO (\d{4})/)[1];
  await whatsappEntrante(ADMIN_WA, { type: 'text', text: { body: `CONFIRMO ${codigo}` } });
  // A las 22:00 no se manda nada (fuera de horario).
  assert.equal((await procesarCola({ ahora: await enMadrid(-1, '22:00') })).nota, 'fuera de horario');
  assert.ok(!llamadas.ycloud.some((m) => m.to === telefono && m.template?.name === 'rukc_recordatorio_manana'));
  // El día después de la ronda: se anula, no se manda.
  await procesarCola({ ahora: await enMadrid(1, '10:00') });
  assert.ok(!llamadas.ycloud.some((m) => m.to === telefono && m.template?.name === 'rukc_recordatorio_manana'));
  const [o] = await q(`SELECT o.estado FROM wa_outbox o JOIN wa_contacts c ON c.id = o.contact_id WHERE c.phone_e164 = $1 AND o.automatizacion = 'D2'`, [telefono]);
  assert.equal(o.estado, 'caducado');
});

let plantillaFeedback = null;
test('fase 3 · E1: sin asistencia marcada avisa una vez; marcada, propuesta a las 10:00 y a las 12:00 sale con el enlace anónimo de la ronda', async () => {
  // La ronda de prueba necesita formulario anónimo configurado (la R2 ya lo tiene; si es otra, uno temporal).
  let formulario = rondaPorId(`T2-R${ronda.numero}`);
  if (!formulario) { formulario = { slug: `prueba-r${ronda.numero}`, round_id: `T2-R${ronda.numero}` }; RONDAS.push(formulario); }
  const telefono = await pilotoConPlaza('LIG');
  llamadas.ycloud.length = 0;
  const aJohn = () => llamadas.ycloud.filter((m) => m.to === ADMIN_WA).map((m) => m.text?.body ?? '');

  // Día siguiente a las 10:05, nadie marcado como asistido: aviso a John, una sola vez.
  await planificar({ ahora: await enMadrid(1, '10:05'), filtrarDestinatarios: deEstosTests });
  assert.match(aJohn().at(-1), /mensaje de feedback de la R\d+ hace falta marcar en el panel quién asistió/);
  const avisos = aJohn().length;
  await planificar({ ahora: await enMadrid(1, '10:30'), filtrarDestinatarios: deEstosTests });
  assert.equal(aJohn().length, avisos, 'el aviso no se repite');

  // Marcada la asistencia: propuesta con código; a las 12:05 sale con el botón y su enlace.
  const [i] = await q(`SELECT i.id FROM inscripcion i JOIN persona p ON p.id = i.piloto_persona_id WHERE p.telefono = $1 AND i.ronda_id = $2`, [telefono, ronda.id]);
  await q(`UPDATE inscripcion SET estado = 'asistio', motivo = 'Prueba de E1' WHERE id = $1`, [i.id]);
  await planificar({ ahora: await enMadrid(1, '10:40'), filtrarDestinatarios: deEstosTests });
  const propuesta = aJohn().at(-1);
  assert.match(propuesta, /Mensaje de feedback de la R\d+ .* para 1 persona\(s\)\. Sale a las 12:00/);
  assert.match(propuesta, /Gracias por correr la R\d+ de RUKC/);
  const codigo = propuesta.match(/CONFIRMO (\d{4})/)[1];
  await whatsappEntrante(ADMIN_WA, { type: 'text', text: { body: `CONFIRMO ${codigo}` } });
  await procesarCola({ ahora: await enMadrid(1, '11:00') });
  assert.ok(!llamadas.ycloud.some((m) => m.to === telefono), 'antes de las 12:00 no sale');
  await procesarCola({ ahora: await enMadrid(1, '12:05') });
  await procesarCola({ ahora: await enMadrid(1, '12:10') });
  const enviados = llamadas.ycloud.filter((m) => m.to === telefono && m.template?.name === 'rukc_feedback_ronda');
  assert.equal(enviados.length, 1);
  const sufijo = enviados[0].template.components.find((c) => c.type === 'button').parameters[0].text;
  assert.equal(sufijo, formulario.slug, 'el botón lleva a /feedback/<slug> de la ronda');
  const [e] = await q('SELECT count(*)::int AS n FROM envio_feedback WHERE inscripcion_id = $1', [i.id]);
  assert.equal(e.n, 0, 'no se crean envíos personales');
  // No se vuelve a proponer.
  const total = aJohn().length;
  await planificar({ ahora: await enMadrid(2, '10:05'), filtrarDestinatarios: deEstosTests });
  assert.equal(aJohn().length, total);
});

// --- Fase 4: comercial (C1, C2), consentimiento, conocimiento y métricas ------------------------------------------
const { seguimientosReserva } = await import('../../lib/whatsapp/comercial.js');
const { metricasMes } = await import('../../lib/whatsapp/metricas.js');
const { registrarUso } = await import('../../lib/bot/llm.js');
const { documentosKb, martesAnterior } = await import('../../lib/bot/datos.js');
const { enviar: enviarYcloud } = await import('../../lib/whatsapp/client.js');
const { construirPlantilla } = await import('../../lib/whatsapp/templates.js');
const migraciones = () => new Pool({ connectionString: process.env.DATABASE_URL_MIGRACIONES });

/** Instante de Madrid relativo al cierre de inscripción de la ronda de los tests (el martes anterior). */
async function relativoACierre(dias, hora) {
  const [r] = await q('SELECT fecha::text AS f FROM ronda WHERE id = $1', [ronda.id]);
  const cierre = martesAnterior(r.f);
  const [x] = await q(`SELECT (($1::date + $2::int)::text || ' ' || $3)::timestamp AT TIME ZONE 'Europe/Madrid' AS t`, [cierre, dias, hora]);
  return { t: new Date(x.t), cierre };
}
/** Contacto de WhatsApp de prueba con los consentimientos comerciales dados, en orden. */
async function contactoComercial(acciones = [], extra = {}) {
  const telefono = tel();
  const [c] = await q(`INSERT INTO wa_contacts (phone_e164, display_name, rol, baja) VALUES ($1, 'Prueba Comercial', 'lead', $2) RETURNING id`,
    [telefono, extra.baja ?? 'ninguna']);
  for (const accion of acciones) await consentir(c.id, accion);
  return { telefono, id: c.id };
}
async function consentir(contactId, accion) {
  await q(`INSERT INTO wa_consents (contact_id, tipo, accion, fuente, texto_version, evidencia) VALUES ($1, 'comercial', $2, 'whatsapp', 'prueba', 'test')`, [contactId, accion]);
  await q('SELECT pg_sleep(0.01)');
}

test('fase 4 · C1: reserva con tarjeta abandonada → seguimiento a las 2 h y otro a las 48 h, nunca un tercero; sin consentimiento, nada', async (t) => {
  const { t: t0, cierre } = await relativoACierre(-3, '10:00');
  if (cierre < new Date().toISOString().slice(0, 10)) return t.skip('la inscripción de la ronda de pruebas ya ha cerrado');
  await q(`UPDATE cupo_ronda SET estado_inscripcion = 'abierta' WHERE ronda_id = $1`, [ronda.id]);
  const abandono = async (novedades) => {
    const { cuerpo, telefono } = await nuevaSolicitud();
    await completar(cuerpo.token, { acepta_whatsapp_novedades: novedades });
    await pagar(peticion('POST', '/api/checkout', { token: cuerpo.token, cuerpo: { metodo: 'tarjeta', acepta: true, textos: 'formulario-web-v2-2026-11' } }));
    await q('UPDATE solicitud_inscripcion SET enviada_en = $2 WHERE codigo = $1', [cuerpo.codigo, t0]);
    return telefono;
  };
  const con = await abandono(true);
  const sin = await abandono(false);
  const contesta = await abandono(true);
  llamadas.ycloud.length = 0;
  const seguimientos = (tel) => llamadas.ycloud.filter((m) => m.to === tel && m.template?.name === 'rukc_seguimiento_reserva');

  // 1 h después: todavía nada. 2 h 5 min: el primero, con el botón a su ronda.
  await seguimientosReserva({ ahora: new Date(t0.getTime() + 3.6e6), enviar: enviarYcloud });
  assert.equal(seguimientos(con).length, 0);
  await seguimientosReserva({ ahora: new Date(t0.getTime() + 2.1 * 3.6e6), enviar: enviarYcloud });
  assert.equal(seguimientos(con).length, 1);
  assert.equal(seguimientos(con)[0].template.components.find((c) => c.type === 'button').parameters[0].text, String(ronda.numero));
  assert.equal(seguimientos(contesta).length, 1);
  assert.equal(seguimientos(sin).length, 0, 'sin la casilla de novedades no se le escribe');
  // Repetir no duplica.
  await seguimientosReserva({ ahora: new Date(t0.getTime() + 2.3 * 3.6e6), enviar: enviarYcloud });
  assert.equal(seguimientos(con).length, 1);

  // Uno contesta; a las 48 h solo el que no contestó recibe el segundo (y último).
  await q(`UPDATE wa_contacts SET last_inbound_at = now() + interval '1 second' WHERE phone_e164 = $1`, [contesta]);
  await q(`UPDATE wa_contacts SET last_inbound_at = NULL WHERE phone_e164 = $1`, [con]);
  await seguimientosReserva({ ahora: new Date(t0.getTime() + 48.1 * 3.6e6), enviar: enviarYcloud });
  assert.equal(seguimientos(con).length, 2);
  assert.equal(seguimientos(contesta).length, 1, 'si contestó, no hay segundo');
  await seguimientosReserva({ ahora: new Date(t0.getTime() + 60 * 3.6e6), enviar: enviarYcloud });
  assert.equal(seguimientos(con).length, 2, 'nunca un tercero');
});

test('fase 4 · C2 con 10 contactos mezclados: solo sale a quien tiene consentimiento comercial vigente', async (t) => {
  const { t: sabado, cierre } = await relativoACierre(-3, '10:05');
  if (cierre < new Date().toISOString().slice(0, 10)) return t.skip('la inscripción de la ronda de pruebas ya ha cerrado');
  await q(`UPDATE cupo_ronda SET estado_inscripcion = 'abierta' WHERE ronda_id = $1`, [ronda.id]);
  const a = await contactoComercial(['otorga']);
  const b = await contactoComercial(['otorga']);
  const cSin = await contactoComercial([]);
  const dRevoca = await contactoComercial(['otorga', 'revoca']);
  const eNo = await contactoComercial(['revoca']);
  const fBajaCom = await contactoComercial(['otorga'], { baja: 'comercial' });
  const gBajaTot = await contactoComercial(['otorga'], { baja: 'total' });
  const hReciente = await contactoComercial(['otorga']);
  await q(`INSERT INTO wa_messages (contact_id, direccion, autor, cuerpo) VALUES ($1, 'entrada', 'usuario', 'hola')`, [hReciente.id]);
  const conPlaza = await pilotoConPlaza('LIG');
  let [iFila] = await q('SELECT id FROM wa_contacts WHERE phone_e164 = $1', [conPlaza]);
  if (!iFila) [iFila] = await q(`INSERT INTO wa_contacts (phone_e164) VALUES ($1) RETURNING id`, [conPlaza]);
  const iPlaza = { telefono: conPlaza, id: iFila.id };
  await consentir(iPlaza.id, 'otorga');
  await q('DELETE FROM wa_messages WHERE contact_id = $1', [iPlaza.id]);   // que no lo excluya el "sin mensajes en 3 días"
  const jRevocaDespues = await contactoComercial(['otorga']);
  const todos = [a, b, cSin, dRevoca, eNo, fBajaCom, gBajaTot, hReciente, iPlaza, jRevocaDespues];
  await whatsappEntrante(ADMIN_WA, { type: 'text', text: { body: 'ESTADO' } });
  llamadas.ycloud.length = 0;

  await planificar({ ahora: sabado, filtrarDestinatarios: deEstosTests });
  const propuesta = llamadas.ycloud.filter((m) => m.to === ADMIN_WA).map((m) => m.text?.body ?? '').find((x) => /Aviso de la próxima ronda/.test(x));
  assert.ok(propuesta, 'llega la propuesta del C2');
  assert.match(propuesta, /para 3 persona\(s\)/, propuesta);
  assert.match(propuesta, /La inscripción cierra el/);
  const enLote = (await q(`SELECT c.phone_e164 AS t FROM wa_outbox o JOIN wa_contacts c ON c.id = o.contact_id
    WHERE o.automatizacion = 'C2' AND o.created_at >= $1`, [INICIO_TESTS])).map((x) => x.t).sort();
  assert.deepEqual(enLote, [a.telefono, b.telefono, jRevocaDespues.telefono].sort());

  // J retira el consentimiento antes del envío: se comprueba otra vez justo antes de mandar.
  await consentir(jRevocaDespues.id, 'revoca');
  const codigo = propuesta.match(/CONFIRMO (\d{4})/)[1];
  await whatsappEntrante(ADMIN_WA, { type: 'text', text: { body: `CONFIRMO ${codigo}` } });
  await procesarCola({ ahora: new Date(sabado.getTime() + 2 * 3.6e6) });
  const recibieron = todos.filter((x) => llamadas.ycloud.some((m) => m.to === x.telefono && m.template?.name === 'rukc_nueva_ronda')).map((x) => x.telefono);
  assert.deepEqual(recibieron.sort(), [a.telefono, b.telefono].sort());
  const [j] = await q(`SELECT o.estado, o.ultimo_error FROM wa_outbox o WHERE o.contact_id = $1 AND o.automatizacion = 'C2'`, [jRevocaDespues.id]);
  assert.equal(j.estado, 'cancelado');
  assert.equal(j.ultimo_error, 'sin consentimiento comercial vigente');

  // Y el cliente de envío lo rechaza por su cuenta: sin consentimiento, ninguna plantilla de marketing sale.
  const antes = llamadas.ycloud.length;
  const [fila] = await q('SELECT * FROM wa_contacts WHERE id = $1', [cSin.id]);
  const r = await enviarYcloud({ contacto: fila, autor: 'sistema',
    plantilla: construirPlantilla('rukc_nueva_ronda', ['Prueba', 'R9', 'sábado', 'Circuito', 'martes']) });
  assert.equal(r.ok, false);
  assert.equal(llamadas.ycloud.length, antes, 'no llega a YCloud');
});

test('fase 4 · un cambio en la base de conocimiento se ve en la siguiente respuesta (sin esperar a la caché)', async () => {
  const slug = `prueba_fase4_${Date.now()}`;
  await q(`INSERT INTO kb_documents (slug, titulo, categoria, contenido_md, fuente, actualizado_por) VALUES ($1, 'Prueba', 'precios', 'La reserva cuesta 30 €.', 'john', 'test')`, [slug]);
  try {
    assert.match((await documentosKb()).find((x) => x.slug === slug)?.contenido_md ?? '', /30 €/);
    await q(`UPDATE kb_documents SET contenido_md = 'La reserva cuesta 35 €.' WHERE slug = $1`, [slug]);
    assert.match((await documentosKb()).find((x) => x.slug === slug)?.contenido_md ?? '', /35 €/);
  } finally {
    const m = migraciones();
    await m.query('DELETE FROM kb_document_versions WHERE slug = $1', [slug]);
    await m.query('DELETE FROM kb_documents WHERE slug = $1', [slug]);
    await m.end();
  }
});

test('fase 4 · métricas del mes: consumo de Claude guardado y coste calculado con las tarifas', async () => {
  const m = migraciones();
  try {
    await m.query(`DELETE FROM wa_llm_usage WHERE created_at < '2002-01-01'`);
    await registrarUso('clasificador', 'claude-haiku-5-5', { model: 'claude-haiku-5-5', usage: { input_tokens: 1000000, output_tokens: 0 } });
    await m.query(`UPDATE wa_llm_usage SET created_at = '2001-01-15 12:00+01' WHERE created_at > now() - interval '1 minute' AND uso = 'clasificador' AND entrada = 1000000`);
    await m.query(`INSERT INTO wa_llm_usage (uso, modelo, entrada, salida, cache_lectura, cache_escritura, busquedas, created_at)
      VALUES ('conversacion', 'claude-sonnet-5-5', 1000000, 100000, 1000000, 0, 2, '2001-01-20 12:00+01')`);
    const r = await metricasMes('2001-01');
    // Sonnet: 2 + 1 + 0,10 + 2 búsquedas (0,02) = 3,12; Haiku: 0,10.
    assert.equal(r.coste_claude_usd, 3.22);
    assert.deepEqual(r.coste_claude_por_uso_usd, { conversacion: 3.12, clasificador: 0.1 });
    assert.equal(r.coste_meta_usd, 0);
    for (const k of ['conversaciones', 'conversaciones_escaladas', 'reservas_pagadas', 'reservas_atribuidas_whatsapp']) assert.equal(typeof r[k], 'number');
    await assert.rejects(metricasMes('enero'));
    assert.equal(typeof (await metricasMes()).coste_total_usd, 'number');
  } finally {
    await m.query(`DELETE FROM wa_llm_usage WHERE created_at < '2002-01-01'`);
    await m.end();
  }
});

// --- Respuestas al recordatorio de una semana: confirma / no va -----------------------------------------------------
const { ejecutarHerramienta } = await import('../../lib/bot/tools.js');
const datosBot = await import('../../lib/bot/datos.js');
const { datosRonda, destinatariosRonda } = await import('../../lib/whatsapp/programador.js');

test('asistencia: el botón «Confirmo asistencia» se anota con texto fijo; quien dice que no va avisa a John una vez y no recibe el D2', async () => {
  const va = await pilotoConPlaza('LIG');
  const noVa = await pilotoConPlaza('PES');
  await whatsappEntrante(ADMIN_WA, { type: 'text', text: { body: 'ESTADO' } });
  llamadas.ycloud.length = 0;

  // Botón del D1: se anota sin pasar por Claude y se le contesta.
  await whatsappEntrante(va, { type: 'button', button: { text: 'Confirmo asistencia', payload: 'Confirmo asistencia' } });
  const respuesta = llamadas.ycloud.filter((m) => m.to === va).at(-1)?.text?.body ?? '';
  assert.match(respuesta, new RegExp(`Apuntado: te esperamos en la R${ronda.numero}`));
  const [d1] = await q(`SELECT o.variables->>'respuesta' AS r FROM wa_outbox o JOIN wa_contacts c ON c.id = o.contact_id
    WHERE c.phone_e164 = $1 AND o.automatizacion = 'D1'`, [va]);
  assert.equal(d1.r, 'confirma');

  // «No puedo ir», por la herramienta del bot: aviso a John (una sola vez aunque lo repita).
  const [contacto] = await q(`INSERT INTO wa_contacts (phone_e164, display_name) VALUES ($1, 'Prueba No Va')
    ON CONFLICT (phone_e164) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING *`, [noVa]);
  const res = await ejecutarHerramienta('registrar_asistencia', { va: false, ronda: null, cita: 'al final no puedo ir' }, { contacto, datos: datosBot });
  assert.equal(res.status, 'ok', JSON.stringify(res));
  await ejecutarHerramienta('registrar_asistencia', { va: false, ronda: `R${ronda.numero}`, cita: 'que no voy' }, { contacto, datos: datosBot });
  const avisos = llamadas.ycloud.filter((m) => m.to === ADMIN_WA && /no va a la R\d+/.test(m.text?.body ?? ''));
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].text.body, /al final no puedo ir/);
  assert.doesNotMatch(avisos[0].text.body, /John/);

  // El D2 no le incluye; al que confirmó, sí.
  const d2 = (await destinatariosRonda(await datosRonda(ronda.id), 'D2')).map((x) => x.telefono);
  assert.ok(d2.includes(va));
  assert.ok(!d2.includes(noVa), 'quien no va no recibe el recordatorio de la víspera');

  // Sin plaza no se anota nada.
  const [otro] = await q(`INSERT INTO wa_contacts (phone_e164) VALUES ($1) RETURNING *`, [tel()]);
  assert.equal((await ejecutarHerramienta('registrar_asistencia', { va: false, ronda: null, cita: 'no voy' }, { contacto: otro, datos: datosBot })).status, 'error');
});

// --- Resto por Bizum (69 €) ----------------------------------------------------------------------------------------
test('resto por Bizum: el justificante de quien tiene 69 € pendientes avisa con código; CONFIRMO deja la inscripción pagada y le confirma', async () => {
  const telefono = await pilotoConPlaza('LIG');
  const [antes] = await q(`SELECT vi.estado, vi.saldo_cent FROM v_inscripciones vi JOIN inscripcion i ON i.id = vi.id
    JOIN persona p ON p.id = i.piloto_persona_id WHERE p.telefono = $1 AND i.ronda_id = $2`, [telefono, ronda.id]);
  assert.equal(antes.estado, 'reservada');
  assert.ok(Number(antes.saldo_cent) > 0);
  await whatsappEntrante(ADMIN_WA, { type: 'text', text: { body: 'ESTADO' } });
  llamadas.ycloud.length = 0;

  await whatsappEntrante(telefono, { type: 'image', image: { id: 'media_resto_1', mime_type: 'image/jpeg' } });
  assert.match(llamadas.ycloud.filter((m) => m.to === telefono).at(-1)?.text?.body ?? '', /Recibido, gracias.*queda pagada/s);
  const aviso = llamadas.ycloud.filter((m) => m.to === ADMIN_WA).map((m) => m.text?.body ?? '').find((x) => /Bizum del resto/.test(x)) ?? '';
  assert.match(aviso, new RegExp(`R${ronda.numero}`));
  assert.match(aviso, new RegExp(`total ${Number(antes.saldo_cent) / 100} €`));
  assert.doesNotMatch(aviso, /John/);
  const codigo = aviso.match(/CONFIRMO (\d{4})/)?.[1];
  assert.ok(codigo, aviso);

  // Una segunda foto no repite el aviso.
  const n = llamadas.ycloud.filter((m) => m.to === ADMIN_WA).length;
  await whatsappEntrante(telefono, { type: 'image', image: { id: 'media_resto_2', mime_type: 'image/jpeg' } });
  assert.equal(llamadas.ycloud.filter((m) => m.to === ADMIN_WA).length, n);

  await whatsappEntrante(ADMIN_WA, { type: 'text', text: { body: `CONFIRMO ${codigo}` } });
  assert.match(llamadas.ycloud.filter((m) => m.to === ADMIN_WA).at(-1).text.body, /Pago de \d+ € registrado .*pagado del todo/);
  const [despues] = await q(`SELECT vi.estado, vi.saldo_cent FROM v_inscripciones vi JOIN inscripcion i ON i.id = vi.id
    JOIN persona p ON p.id = i.piloto_persona_id WHERE p.telefono = $1 AND i.ronda_id = $2`, [telefono, ronda.id]);
  assert.equal(Number(despues.saldo_cent), 0);
  assert.equal(despues.estado, 'pagada');
  assert.match(llamadas.ycloud.filter((m) => m.to === telefono).at(-1)?.text?.body ?? '', /está pagada del todo/);
  const [pg] = await q(`SELECT metodo, estado FROM pago WHERE referencia_externa LIKE 'Bizum resto%' AND pagador_persona_id IN (SELECT id FROM persona WHERE telefono = $1)`, [telefono]);
  assert.deepEqual(pg, { metodo: 'bizum_manual', estado: 'confirmado' });

  // Pagada del todo: otra foto ya no genera propuesta (sigue el camino normal del bot).
  assert.equal((await q(`SELECT count(*)::int AS n FROM admin_actions WHERE tipo = 'confirmar_bizum' AND estado = 'propuesta'
    AND parametros->>'telefono' = $1`, [telefono]))[0].n, 0);
});
