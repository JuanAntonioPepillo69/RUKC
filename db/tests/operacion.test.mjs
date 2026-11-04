// Fase 6 contra Neon desarrollo: traslados (F7), cancelación de una ronda y su resolución (F8), reembolsos, créditos,
// tareas programadas, documentos y RGPD. Crea una temporada de prueba (en borrador: no sale en la web ni en el
// panel) con 3 rondas, y lo borra todo al terminar.
// Stripe: si STRIPE_SECRET_KEY es de prueba (sk_test_), el reembolso se hace de verdad en modo test con un pago de
// prueba (pm_card_visa); si no, se simula la API de Stripe.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from '@neondatabase/serverless';
import { adminConSesion } from './ayuda-panel.mjs';

for (const v of ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'RUKC_BACKUP_KEY', 'CRON_SECRET', 'RUKC_BLOB_LOCAL_DIR']) if (!process.env[v]) throw new Error(`Falta ${v}`);
delete process.env.BLOB_READ_WRITE_TOKEN;
const STRIPE_REAL = /^sk_test_/.test(process.env.STRIPE_SECRET_KEY || '');
const llamadasStripe = [];
if (!STRIPE_REAL) {
  process.env.STRIPE_SECRET_KEY = 'sk_test_simulada';
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.startsWith('https://api.stripe.com/')) return fetchReal(url, init);
    const params = Object.fromEntries(new URLSearchParams(init.body ?? ''));
    llamadasStripe.push({ ruta: u.replace('https://api.stripe.com/v1/', ''), params, idempotencia: init.headers?.['Idempotency-Key'] });
    const cuerpo = u.endsWith('/payment_intents') ? { id: `pi_sim_${crypto.randomBytes(6).toString('hex')}`, status: 'succeeded' }
      : { id: `re_sim_${crypto.randomBytes(6).toString('hex')}`, status: 'succeeded', amount: Number(params.amount) };
    return Response.json(cuerpo);
  };
}
const { stripe } = await import('../../lib/stripe.js');
const { GET: cron } = await import('../../api/cron.js');
const { descifrarCopia } = await import('../../lib/copia.js');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = async (t, p) => (await pool.query(t, p)).rows;
const tel = () => `+3469${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const dia = (dias) => new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10);
const sufijo = crypto.randomBytes(3).toString('hex');

let admin, T;   // T: temporada de prueba { temporada, circuito, r1, r2, r3, lig, producto, entidad }
const personas = [];
const documentos = [];

/** Piloto con una carrera de la ronda pagada (9900): efectivo, o Stripe con un PaymentIntent de prueba. */
async function piloto(ronda, { metodo = 'efectivo', nombre = 'Piloto' } = {}) {
  const [p] = await q(`INSERT INTO persona (nombre, apellidos, telefono, origen_alta) VALUES ($1, 'Operación Prueba', $2, 'alta_manual') RETURNING id`, [nombre, tel()]);
  personas.push(p.id);
  const [ped] = await q(`INSERT INTO pedido (temporada_id, pagador_persona_id, origen, subtotal_cent, total_cent) VALUES ($1, $2, 'manual', 9900, 9900) RETURNING id`, [T.temporada, p.id]);
  const [i] = await q(`INSERT INTO inscripcion (pedido_id, piloto_persona_id, ronda_id, producto_id, precio_cent, categoria_id, categoria_origen)
    VALUES ($1, $2, $3, $4, 9900, $5, 'por_peso') RETURNING id, codigo`, [ped.id, p.id, ronda, T.producto, T.lig]);
  let pi = null;
  if (metodo === 'stripe_tarjeta') {
    pi = (await stripe('payment_intents', { amount: '9900', currency: 'eur', payment_method: 'pm_card_visa', confirm: 'true', 'payment_method_types[]': 'card' })).id;
  }
  const [pg] = await q(`INSERT INTO pago (pagador_persona_id, entidad_cobradora_id, metodo, importe_cent, estado, stripe_payment_intent_id, confirmado_por)
    VALUES ($1, $2, $3, 9900, 'confirmado', $4, $5) RETURNING id, codigo`, [p.id, T.entidad, metodo, pi, metodo.startsWith('stripe') ? 'stripe' : null]);
  await q('INSERT INTO aplicacion_pago (pago_id, inscripcion_id, importe_cent) VALUES ($1, $2, 9900)', [pg.id, i.id]);
  return { persona: p.id, pedido: ped.id, inscripcion: i.id, codigo: i.codigo, pago: pg.id, pi };
}
const insc = async (id) => (await q(`SELECT i.estado, i.resolucion, i.ronda_id, inscripcion_saldo_cent(i.id) AS saldo, inscripcion_pagado_cent(i.id) AS pagado,
  inscripcion_credito_cent(i.id) AS credito FROM inscripcion i WHERE i.id = $1`, [id]))[0];

before(async () => {
  admin = await adminConSesion();
  const [t] = await q(`INSERT INTO temporada (codigo, nombre, inicio, fin, importe_reserva_cent, dias_aviso_traslado) VALUES ($1, 'Temporada de prueba', $2, $3, 3000, 14) RETURNING id`,
    [`TP${sufijo.toUpperCase()}`, dia(1), dia(120)]);
  const [ci] = await q(`INSERT INTO circuito (nombre) VALUES ($1) RETURNING id`, [`Circuito prueba ${sufijo}`]);
  const rondas = [];
  for (const [n, d] of [[1, 30], [2, 60], [3, 90]]) rondas.push((await q(`INSERT INTO ronda (temporada_id, numero, circuito_id, fecha) VALUES ($1, $2, $3, $4) RETURNING id`, [t.id, n, ci.id, dia(d)]))[0].id);
  const [lig] = await q(`INSERT INTO categoria (temporada_id, codigo, nombre, peso_minimo_kg) VALUES ($1, 'LIG', 'Ligeros', 70) RETURNING id`, [t.id]);
  const [pr] = await q(`INSERT INTO producto (temporada_id, codigo, rondas_incluidas) VALUES ($1, 'carrera_suelta', 1) RETURNING id`, [t.id]);
  const [en] = await q('SELECT id FROM entidad_cobradora WHERE activa_hasta IS NULL');
  T = { temporada: t.id, circuito: ci.id, r1: rondas[0], r2: rondas[1], r3: rondas[2], lig: lig.id, producto: pr.id, entidad: en.id };
});

after(async () => {
  const ins = (await q('SELECT i.id FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id WHERE r.temporada_id = $1', [T.temporada])).map((r) => r.id);
  const pagos = (await q('SELECT id FROM pago WHERE pagador_persona_id = ANY($1::uuid[])', [personas])).map((r) => r.id);
  await q('DELETE FROM reembolso WHERE pago_id = ANY($1::uuid[])', [pagos]);
  await q('DELETE FROM movimiento_credito WHERE persona_id = ANY($1::uuid[])', [personas]);
  await q('DELETE FROM aplicacion_pago WHERE pago_id = ANY($1::uuid[]) OR inscripcion_id = ANY($2::uuid[])', [pagos, ins]);
  await q('DELETE FROM traslado WHERE inscripcion_origen_id = ANY($1::uuid[]) OR inscripcion_destino_id = ANY($1::uuid[])', [ins]);
  await q('DELETE FROM inscripcion WHERE id = ANY($1::uuid[])', [ins]);
  await q('DELETE FROM pago WHERE id = ANY($1::uuid[])', [pagos]);
  await q('DELETE FROM pedido WHERE temporada_id = $1', [T.temporada]);
  await q('DELETE FROM solicitud_inscripcion WHERE temporada_id = $1', [T.temporada]);
  for (const t of ['interaccion', 'solicitud_rgpd', 'consentimiento', 'atribucion']) await q(`DELETE FROM ${t} WHERE persona_id = ANY($1::uuid[])`, [personas]);
  await q('DELETE FROM persona WHERE id = ANY($1::uuid[])', [personas]);
  await q('DELETE FROM cupo_ronda WHERE ronda_id IN (SELECT id FROM ronda WHERE temporada_id = $1)', [T.temporada]);
  await q('DELETE FROM ronda WHERE temporada_id = $1', [T.temporada]);
  for (const t of ['producto', 'categoria']) await q(`DELETE FROM ${t} WHERE temporada_id = $1`, [T.temporada]);
  await q('DELETE FROM temporada WHERE id = $1', [T.temporada]);
  await q('DELETE FROM circuito WHERE id = $1', [T.circuito]);
  await q('DELETE FROM documento_legal WHERE id = ANY($1::uuid[])', [documentos]);
  const [u] = await q('SELECT id FROM auth_usuario WHERE email = $1', [admin.email]);
  if (u) await q('DELETE FROM auth_usuario WHERE id = $1', [u.id]);
  await q('UPDATE admin SET activo = false WHERE email = $1', [admin.email]);
  await pool.end();
});

let A;   // piloto que se traslada y luego recibe un reembolso parcial manual

test('Traslado fuera de plazo sin motivo: rechazado. Con motivo: los pagos se mueven y los saldos cuadran', async () => {
  A = await piloto(T.r1, { nombre: 'Traslado' });
  assert.equal((await insc(A.inscripcion)).estado, 'pagada');
  const aviso = dia(27);   // la R1 es dentro de 30 días: avisa con 3 días, fuera del plazo de 14
  await assert.rejects(admin.panel(`inscripciones/${A.inscripcion}/trasladar`, { ronda_id: T.r2, aviso }), (e) => e.status === 400 && e.datos.necesita_motivo === true);
  assert.equal((await insc(A.inscripcion)).estado, 'pagada', 'No se ha tocado nada');
  const r = await admin.panel(`inscripciones/${A.inscripcion}/trasladar`, { ronda_id: T.r2, aviso, motivo: 'Lesión con parte médico' });
  assert.deepEqual([r.fuera_de_plazo, r.dias_antelacion], [true, 3]);
  assert.equal((await insc(A.inscripcion)).estado, 'trasladada');
  const d = await insc(r.destino.id);
  assert.deepEqual([d.estado, d.pagado, d.saldo, d.ronda_id], ['pagada', 9900, 0, T.r2], 'El pago va con la inscripción nueva');
  const [ap] = await q('SELECT inscripcion_id, importe_cent FROM aplicacion_pago WHERE pago_id = $1', [A.pago]);
  assert.deepEqual(ap, { inscripcion_id: r.destino.id, importe_cent: 9900 });
  const [tr] = await q('SELECT fuera_de_plazo, motivo_excepcion FROM traslado WHERE inscripcion_origen_id = $1', [A.inscripcion]);
  assert.deepEqual(tr, { fuera_de_plazo: true, motivo_excepcion: 'Lesión con parte médico' });
  // En plazo (avisa hoy, 60 días antes de la R2) no hace falta motivo.
  const r2 = await admin.panel(`inscripciones/${r.destino.id}/trasladar`, { ronda_id: T.r3 });
  assert.equal(r2.fuera_de_plazo, false);
  A.inscripcion = r2.destino.id;
  assert.deepEqual([(await insc(A.inscripcion)).estado, (await insc(A.inscripcion)).ronda_id], ['pagada', T.r3]);
});

let B, C;

test('Cancelar una ronda con 2 inscritos: uno se resuelve con reembolso de Stripe (modo test) y otro con crédito', async () => {
  B = await piloto(T.r2, { metodo: 'stripe_tarjeta', nombre: 'Stripe' });
  C = await piloto(T.r2, { nombre: 'Credito' });
  const r = await admin.panel(`rondas/${T.r2}/cancelar`, { motivo: 'El circuito cierra por obras' });
  assert.equal(r.canceladas, 2);
  for (const x of [B, C]) assert.deepEqual([(await insc(x.inscripcion)).estado, (await insc(x.inscripcion)).resolucion], ['cancelada', 'pendiente']);
  const lista = await admin.panel(`rondas/${T.r2}/canceladas`);
  assert.equal(lista.inscripciones.find((i) => i.id === B.inscripcion).pagos[0].stripe, true);

  const rb = await admin.panel(`inscripciones/${B.inscripcion}/resolver`, { resolucion: 'reembolso', motivo: 'Ronda cancelada' });
  assert.equal(rb.resuelta, true);
  const [re] = await q('SELECT estado, importe_cent, stripe_refund_id FROM reembolso WHERE pago_id = $1', [B.pago]);
  assert.equal(re.estado, 'emitido');
  assert.equal(re.importe_cent, 9900);
  assert.match(re.stripe_refund_id, /^re_/);
  assert.equal((await q('SELECT estado FROM pago WHERE id = $1', [B.pago]))[0].estado, 'reembolsado');
  assert.deepEqual([(await insc(B.inscripcion)).resolucion, (await insc(B.inscripcion)).pagado], ['reembolso', 0]);
  if (STRIPE_REAL) {
    const refund = await stripe(`refunds/${re.stripe_refund_id}`);
    assert.deepEqual([refund.amount, refund.payment_intent], [9900, B.pi], 'El reembolso existe en Stripe (modo test)');
  } else {
    const llamada = llamadasStripe.find((l) => l.ruta === 'refunds');
    assert.deepEqual([llamada.params.payment_intent, llamada.params.amount, llamada.idempotencia?.startsWith('reembolso-')], [B.pi, '9900', true]);
    assert.ok(!Object.keys(llamada.params).some((k) => k.startsWith('metadata') && k !== 'metadata[reembolso_id]'), 'Sin datos personales en Stripe');
  }
  await assert.rejects(admin.panel(`inscripciones/${B.inscripcion}/resolver`, { resolucion: 'credito' }), (e) => e.status === 400, 'Ya está resuelta');

  const rc = await admin.panel(`inscripciones/${C.inscripcion}/resolver`, { resolucion: 'credito' });
  assert.equal(rc.abonado_cent, 9900);
  assert.equal((await insc(C.inscripcion)).resolucion, 'credito');
  const libro = await admin.panel(`personas/${C.persona}/creditos`);
  assert.equal(libro.saldo_cent, 9900);
  assert.deepEqual(libro.movimientos.map((m) => [m.tipo, m.importe_cent]), [['compensacion_cancelacion', 9900]]);
});

test('Créditos: el canje cuenta para el saldo de la inscripción; abonos y ajustes desde la ficha', async () => {
  const [ped] = await q(`INSERT INTO pedido (temporada_id, pagador_persona_id, origen, subtotal_cent, total_cent) VALUES ($1, $2, 'manual', 9900, 9900) RETURNING id`, [T.temporada, C.persona]);
  const [nueva] = await q(`INSERT INTO inscripcion (pedido_id, piloto_persona_id, ronda_id, producto_id, precio_cent, categoria_id, categoria_origen)
    VALUES ($1, $2, $3, $4, 9900, $5, 'por_peso') RETURNING id`, [ped.id, C.persona, T.r3, T.producto, T.lig]);
  assert.equal((await insc(nueva.id)).estado, 'pendiente_pago');
  await assert.rejects(admin.panel(`personas/${C.persona}/canje`, { inscripcion_id: nueva.id, importe_cent: 20000 }), (e) => e.status === 400, 'No canjea más de lo que tiene ni de lo que falta');
  const c1 = await admin.panel(`personas/${C.persona}/canje`, { inscripcion_id: nueva.id, importe_cent: 9900 });
  assert.equal(c1.saldo_cent, 0);
  const n = await insc(nueva.id);
  assert.deepEqual([n.estado, n.credito, n.saldo], ['pagada', 9900, 0]);
  await admin.panel(`personas/${C.persona}/creditos`, { tipo: 'fidelidad', importe_cent: 1500, motivo: 'Tres rondas seguidas' });
  await assert.rejects(admin.panel(`personas/${C.persona}/creditos`, { tipo: 'ajuste', importe_cent: -5000, motivo: 'Corrección' }), (e) => e.status === 400, 'El saldo no baja de cero');
  const r = await admin.panel(`personas/${C.persona}/creditos`, { tipo: 'ajuste', importe_cent: -500, motivo: 'Corrección' });
  assert.equal(r.saldo_cent, 1000);
  const libro = await admin.panel(`personas/${C.persona}/creditos`);
  assert.equal(libro.movimientos.reduce((s, m) => s + m.importe_cent, 0), 1000, 'El libro cuadra con el saldo');
});

test('Reembolso manual parcial de un pago: libera lo aplicado y la inscripción vuelve a reservada', async () => {
  const r = await admin.panel(`pagos/${A.pago}/reembolsar`, { importe_cent: 2000, motivo: 'Devolución parcial por Bizum' });
  assert.deepEqual([r.estado, r.metodo], ['emitido', 'manual']);
  assert.match(r.aviso, /20 €/);
  assert.equal((await q('SELECT estado FROM pago WHERE id = $1', [A.pago]))[0].estado, 'reembolsado_parcial');
  const i = await insc(A.inscripcion);
  assert.deepEqual([i.estado, i.pagado, i.saldo], ['reservada', 7900, 2000]);
  await assert.rejects(admin.panel(`pagos/${A.pago}/reembolsar`, { importe_cent: 9000, motivo: 'Demasiado' }), (e) => e.status === 400);
});

test('Tareas: sin CRON_SECRET no entra; a mano se ejecuta cada una y deja el resultado (o el error) en evento', async () => {
  const llamar = (tareas, secreto = process.env.CRON_SECRET) => cron(new Request(`${process.env.BETTER_AUTH_URL}/api/cron${tareas ? `?tareas=${tareas}` : ''}`,
    { headers: secreto ? { authorization: `Bearer ${secreto}` } : {} }));
  assert.equal((await llamar('bizum', null)).status, 401);
  assert.equal((await llamar('bizum', 'otro')).status, 401);
  assert.equal((await llamar('borrar_todo')).status, 400);

  // Un Bizum avisado hace 73 h sin confirmar.
  const [s] = await q(`INSERT INTO solicitud_inscripcion (temporada_id, ronda_id, pagador_nombre, pagador_telefono, metodo_elegido, acepta_documentos)
    VALUES ($1, $2, 'Bizum Viejo', $3, 'bizum', '{"condiciones_reserva": "prueba"}') RETURNING id`, [T.temporada, T.r3, tel()]);
  await q(`UPDATE solicitud_inscripcion SET estado = 'enviada' WHERE id = $1`, [s.id]);
  await q(`UPDATE solicitud_inscripcion SET enviada_en = now() - interval '73 hours' WHERE id = $1`, [s.id]);

  const res = await llamar('bizum,feedback,copia,anonimizacion,neon');
  assert.equal(res.status, 200, 'Responde 200 aunque un paso falle: no se reintenta');
  const d = await res.json();
  const por = Object.fromEntries(d.resultados.map((r) => [r.tarea, r]));
  assert.ok(por.bizum.ok && por.bizum.resultado.abandonadas >= 1);
  assert.equal((await q('SELECT estado FROM solicitud_inscripcion WHERE id = $1', [s.id]))[0].estado, 'pago_abandonado');
  assert.ok(por.feedback.ok && Number.isInteger(por.feedback.resultado.caducados));
  assert.ok(por.anonimizacion.ok && Number.isInteger(por.anonimizacion.resultado.candidatos));
  assert.ok(por.copia.ok, por.copia.error);
  if (!process.env.NEON_API_KEY) {
    assert.equal(por.neon.ok, false);
    assert.match(por.neon.error, /NEON_API_KEY/);
    assert.equal(d.ok, false);
  } else {
    assert.ok(por.neon.ok, por.neon.error);
    assert.ok(por.neon.resultado.cu_horas >= 0 && por.neon.resultado.limite_cu_horas > 0);
  }
  const eventos = await q(`SELECT entidad_id, accion FROM evento WHERE entidad = 'tarea' AND ocurrido_en > now() - interval '5 minutes' ORDER BY id DESC LIMIT 5`);
  assert.deepEqual(new Set(eventos.map((e) => e.entidad_id)), new Set(['bizum', 'feedback', 'copia', 'anonimizacion', 'neon']));
  if (!process.env.NEON_API_KEY) assert.ok(eventos.some((e) => e.entidad_id === 'neon' && e.accion === 'error'), 'El error queda en evento');
  const hoy = await admin.panel('hoy');
  if (!process.env.NEON_API_KEY) assert.ok(hoy.avisos.tareas.some((t) => t.tarea === 'neon'), 'Y sale en "Hoy"');

  // La copia: cifrada (no se lee sin la clave) y con todas las tablas.
  const ruta = path.join(process.env.RUKC_BLOB_LOCAL_DIR, por.copia.resultado.rutas[0]);
  const buf = fs.readFileSync(ruta);
  assert.ok(!buf.includes(Buffer.from('persona')), 'El archivo no se lee sin la clave');
  const copia = descifrarCopia(buf);
  const [n] = await q('SELECT count(*)::int AS n FROM persona');
  assert.ok(Math.abs(copia.conteos.persona - n.n) <= 1);
  assert.ok(['evento', 'inscripcion', 'pago', 'aceptacion', 'documento_legal', 'auth_usuario'].every((t) => t in copia.tablas));
  const sistema = await admin.panel('sistema');
  assert.ok(sistema.copias.some((c) => c.ruta === por.copia.resultado.rutas[0]));
});

test('Documentos: una versión sin fecha del abogado no se activa; con ella, sí, y cierra la anterior', async () => {
  const base = { tipo: 'aviso_borradores', titulo: 'Prueba', contenido_md: 'Texto de prueba del aviso de borradores, solo para el test.', obligatorio_onboarding: false, revocable: false };
  const v1 = await admin.panel('documentos', { ...base, version: `test-${sufijo}-1` });
  const v2 = await admin.panel('documentos', { ...base, version: `test-${sufijo}-2`, contenido_md: `${base.contenido_md} Segunda.` });
  documentos.push(v1.id, v2.id);
  await assert.rejects(admin.panel(`documentos/${v1.id}/activar`, {}), (e) => e.status === 400 && /abogado/.test(e.message));
  await admin.panel(`documentos/${v1.id}/revision`, { revisado_abogado_en: dia(0) });
  await admin.panel(`documentos/${v1.id}/activar`, {});
  await assert.rejects(admin.panel(`documentos/${v1.id}`, { ...base, version: `test-${sufijo}-1`, contenido_md: 'Cambiado después de activar, no debe dejar.' }), (e) => e.status === 400);
  await admin.panel(`documentos/${v2.id}/revision`, { revisado_abogado_en: dia(0) });
  const r = await admin.panel(`documentos/${v2.id}/activar`, {});
  assert.deepEqual(r.cerradas, [`test-${sufijo}-1`]);
  const vig = await q(`SELECT version FROM documento_legal WHERE tipo = 'aviso_borradores' AND vigente_desde <= now() AND (vigente_hasta IS NULL OR vigente_hasta > now())`);
  assert.deepEqual(vig.map((x) => x.version), [`test-${sufijo}-2`]);
});

test('RGPD: solicitud con plazo de un mes, exportar todo lo de una persona y anonimizar (conserva los importes)', async () => {
  const s = await admin.panel('rgpd', { contacto: 'piloto@example.com', tipo: 'acceso', persona_id: B.persona });
  const dias = (new Date(s.vence_en) - Date.now()) / 864e5;
  assert.ok(dias > 27 && dias < 32, 'Vence en un mes');
  const res = await admin.crudo(`personas/${B.persona}/exportar`);
  assert.equal(res.status, 200);
  const datos = JSON.parse(Buffer.from(await res.arrayBuffer()).toString('utf8'));
  assert.equal(datos.persona.id, B.persona);
  assert.ok(datos.inscripciones.length === 1 && datos.pagos.length === 1);
  assert.ok((await q(`SELECT 1 FROM evento WHERE entidad = 'persona' AND entidad_id = $1 AND accion = 'exportacion_rgpd'`, [B.persona])).length, 'La exportación queda en el historial');
  await admin.panel(`rgpd/${s.id}/resolver`, { estado: 'resuelta', resolucion: 'Enviado por email el JSON' });

  await assert.rejects(admin.panel(`personas/${A.persona}/anonimizar`, { motivo: 'Prueba' }), (e) => e.status === 400 && /activas/.test(e.message));
  await admin.panel(`personas/${B.persona}/anonimizar`, { motivo: 'Supresión pedida' });
  const [p] = await q('SELECT nombre, telefono, email, estado FROM persona WHERE id = $1', [B.persona]);
  assert.deepEqual(p, { nombre: 'Anonimizada', telefono: null, email: null, estado: 'anonimizada' });
  assert.equal((await q('SELECT importe_cent FROM pago WHERE id = $1', [B.pago]))[0].importe_cent, 9900, 'Los importes se conservan');

  // Una persona sin actividad en más de 12 meses sale en la lista; con algo pendiente, no.
  const [vieja] = await q(`INSERT INTO persona (nombre, telefono, origen_alta, creado_en) VALUES ('Sin Actividad', $1, 'alta_manual', now() - interval '13 months') RETURNING id`, [tel()]);
  personas.push(vieja.id);
  const { candidatos } = await admin.panel('rgpd');
  assert.ok(candidatos.some((x) => x.id === vieja.id));
  assert.ok(!candidatos.some((x) => x.id === A.persona));
  await admin.panel(`personas/${vieja.id}/anonimizar`, { motivo: 'Plazo de conservación vencido' });
  assert.ok(!(await admin.panel('rgpd')).candidatos.some((x) => x.id === vieja.id));
});
