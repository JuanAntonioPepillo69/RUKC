// Feedback post-carrera (F6) contra Neon desarrollo, llamando a /api/feedback y /api/admin como lo haría Vercel.
// Crea una temporada de prueba (en borrador: no sale en la web ni en el panel) con una R1 celebrada y 3 pilotos en
// asistio, para no depender de lo que haya en desarrollo, y una plantilla de prueba que activa mientras dura el test
// (al terminar vuelve a dejar activa la que hubiera). Borra todo lo que crea.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { Pool } from '@neondatabase/serverless';
import { adminConSesion } from './ayuda-panel.mjs';
import { nuevoToken } from '../../lib/tokens.js';

for (const v of ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL']) if (!process.env[v]) throw new Error(`Falta ${v}`);
const { GET, POST } = await import('../../api/feedback.js');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = async (t, p) => (await pool.query(t, p)).rows;
const tel = () => `+3469${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const BASE = process.env.BETTER_AUTH_URL;

async function fb(token, ruta, cuerpo) {
  const u = new URL(`${BASE}/api/feedback`);
  u.searchParams.set('ruta', ruta);
  const res = await (cuerpo === undefined ? GET : POST)(new Request(u, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { origin: BASE, 'x-forwarded-for': '10.7.7.7', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  }));
  return { status: res.status, datos: await res.json() };
}
const tokenDe = (url) => decodeURIComponent(url).match(/\/feedback\/([\w-]{20,100})/)[1];

const PREGUNTAS = [
  { id: 'nota', tipo: 'escala_0_10', texto: '¿Qué nota le pones a la ronda?', obligatoria: true },
  { id: 'organizacion', tipo: 'escala_1_5', texto: '¿Qué tal la organización?', obligatoria: false },
  { id: 'volverias', tipo: 'opcion_unica', texto: '¿Volverías a correr?', obligatoria: true, opciones: ['Sí', 'No', 'No lo sé'] },
  { id: 'mejorar', tipo: 'opcion_multiple', texto: '¿Qué mejorarías?', obligatoria: false, opciones: ['Horarios', 'Karts', 'Comunicación'] },
  { id: 'comentario', tipo: 'texto', texto: '¿Algo más?', obligatoria: false },
];

let admin, r1, r2, activaAntes, plantilla, t;
const pilotos = [];
const plantillas = [];

/** Piloto de prueba con la R1 pagada en efectivo y marcado como asistido (con motivo, sin onboarding). */
async function asistente(nombre) {
  const [p] = await q(`INSERT INTO persona (nombre, apellidos, telefono, origen_alta) VALUES ($1, 'Feedback Prueba', $2, 'alta_manual') RETURNING id`, [nombre, tel()]);
  pilotos.push(p.id);
  const [ped] = await q(`INSERT INTO pedido (temporada_id, pagador_persona_id, origen, subtotal_cent, total_cent) VALUES ($1, $2, 'manual', 9900, 9900) RETURNING id`, [t.temporada, p.id]);
  const [i] = await q(`INSERT INTO inscripcion (pedido_id, piloto_persona_id, ronda_id, producto_id, precio_cent) VALUES ($1, $2, $3, $4, 9900) RETURNING id`, [ped.id, p.id, r1.id, t.producto]);
  const [pg] = await q(`INSERT INTO pago (pagador_persona_id, entidad_cobradora_id, metodo, importe_cent, estado) VALUES ($1, $2, 'efectivo', 9900, 'confirmado') RETURNING id`, [p.id, t.entidad]);
  await q('INSERT INTO aplicacion_pago (pago_id, inscripcion_id, importe_cent) VALUES ($1, $2, 9900)', [pg.id, i.id]);
  await q(`UPDATE inscripcion SET estado = 'asistio', motivo = 'Prueba de feedback' WHERE id = $1`, [i.id]);
  return { persona: p.id, inscripcion: i.id };
}

before(async () => {
  admin = await adminConSesion();
  const sufijo = crypto.randomBytes(3).toString('hex').toUpperCase();
  const [tp] = await q(`INSERT INTO temporada (codigo, nombre, importe_reserva_cent, dias_aviso_traslado) VALUES ($1, 'Temporada de prueba', 3000, 14) RETURNING id`, [`TF${sufijo}`]);
  const [ci] = await q('INSERT INTO circuito (nombre) VALUES ($1) RETURNING id', [`Circuito feedback ${sufijo}`]);
  [r1] = await q(`INSERT INTO ronda (temporada_id, numero, circuito_id, fecha) VALUES ($1, 1, $2, current_date - 2) RETURNING id`, [tp.id, ci.id]);
  [r2] = await q(`INSERT INTO ronda (temporada_id, numero, circuito_id, fecha) VALUES ($1, 2, $2, current_date + 30) RETURNING id`, [tp.id, ci.id]);
  await q(`UPDATE ronda SET estado = 'celebrada' WHERE id = $1`, [r1.id]);
  const [pr] = await q(`INSERT INTO producto (temporada_id, codigo, rondas_incluidas) VALUES ($1, 'carrera_suelta', 1) RETURNING id`, [tp.id]);
  const [en] = await q('SELECT id FROM entidad_cobradora WHERE activa_hasta IS NULL');
  t = { temporada: tp.id, circuito: ci.id, producto: pr.id, entidad: en.id };
  [activaAntes] = await q('SELECT id FROM plantilla_feedback WHERE activa');
});

after(async () => {
  const insc = (await q('SELECT id FROM inscripcion WHERE piloto_persona_id = ANY($1::uuid[])', [pilotos])).map((r) => r.id);
  const envios = (await q('SELECT id FROM envio_feedback WHERE inscripcion_id = ANY($1::uuid[])', [insc])).map((r) => r.id);
  await q('DELETE FROM respuesta_feedback WHERE envio_id = ANY($1::uuid[])', [envios]);
  await q('DELETE FROM envio_feedback WHERE id = ANY($1::uuid[])', [envios]);
  await q('UPDATE plantilla_feedback SET activa = false WHERE id = ANY($1::uuid[])', [plantillas]);
  if (activaAntes) await q('UPDATE plantilla_feedback SET activa = true WHERE id = $1', [activaAntes.id]);
  await q('DELETE FROM plantilla_feedback WHERE id = ANY($1::uuid[])', [plantillas]);
  const pagos = (await q('SELECT id FROM pago WHERE pagador_persona_id = ANY($1::uuid[])', [pilotos])).map((r) => r.id);
  await q('DELETE FROM aplicacion_pago WHERE pago_id = ANY($1::uuid[])', [pagos]);
  await q('DELETE FROM pago WHERE id = ANY($1::uuid[])', [pagos]);
  await q('DELETE FROM inscripcion WHERE id = ANY($1::uuid[])', [insc]);
  await q('DELETE FROM pedido WHERE pagador_persona_id = ANY($1::uuid[])', [pilotos]);
  await q('DELETE FROM interaccion WHERE persona_id = ANY($1::uuid[])', [pilotos]);
  await q('DELETE FROM persona WHERE id = ANY($1::uuid[])', [pilotos]);
  await q('DELETE FROM ronda WHERE temporada_id = $1', [t.temporada]);
  await q('DELETE FROM producto WHERE temporada_id = $1', [t.temporada]);
  await q('DELETE FROM temporada WHERE id = $1', [t.temporada]);
  await q('DELETE FROM circuito WHERE id = $1', [t.circuito]);
  const [u] = await q('SELECT id FROM auth_usuario WHERE email = $1', [admin.email]);
  if (u) await q('DELETE FROM auth_usuario WHERE id = $1', [u.id]);
  await q('UPDATE admin SET activo = false WHERE email = $1', [admin.email]);
  await pool.end();
});

const A = {}, B = {}, C = {};

test('Plantillas: se validan, se activan y una usada no se edita', async () => {
  await assert.rejects(admin.panel('feedback/plantillas', { version: 'x', preguntas: [{ id: 'a', tipo: 'opcion_unica', texto: 'Una', obligatoria: true, opciones: ['Sola'] }] }),
    (e) => e.status === 400 && /2 opciones/.test(e.message));
  await assert.rejects(admin.panel('feedback/plantillas', { version: 'x', preguntas: [PREGUNTAS[0], PREGUNTAS[0]] }), (e) => e.status === 400 && /repetido/.test(e.message));
  const vacia = await admin.panel('feedback/plantillas', { version: `prueba-vacia-${crypto.randomBytes(3).toString('hex')}`, preguntas: [] });
  plantillas.push(vacia.id);
  await assert.rejects(admin.panel(`feedback/plantillas/${vacia.id}/activar`, {}), (e) => e.status === 400, 'Sin preguntas no se activa');
  plantilla = await admin.panel('feedback/plantillas', { version: `prueba-${crypto.randomBytes(3).toString('hex')}`, preguntas: PREGUNTAS });
  plantillas.push(plantilla.id);
  await admin.panel(`feedback/plantillas/${plantilla.id}/activar`, {});
  assert.deepEqual((await q('SELECT id FROM plantilla_feedback WHERE activa')).map((r) => r.id), [plantilla.id], 'Solo una activa');
});

test('Generar: un envío por cada inscripción en asistio de una ronda celebrada, caducidad de 14 días', async () => {
  Object.assign(A, await asistente('Ana'));
  Object.assign(B, await asistente('Beto'));
  Object.assign(C, await asistente('Carla'));
  await assert.rejects(admin.panel(`feedback/rondas/${r2.id}/generar`, {}), (e) => e.status === 400 && /celebrada/.test(e.message));
  const g = await admin.panel(`feedback/rondas/${r1.id}/generar`, {});
  assert.equal(g.generados, 3);
  assert.equal((await admin.panel(`feedback/rondas/${r1.id}/generar`, {})).generados, 0, 'Repetir no duplica');
  const envios = await q(`SELECT e.id, e.inscripcion_id, e.estado, e.plantilla_id, round(extract(epoch FROM e.expira_en - e.creado_en) / 86400) AS dias
    FROM envio_feedback e WHERE e.inscripcion_id = ANY($1::uuid[])`, [[A.inscripcion, B.inscripcion, C.inscripcion]]);
  assert.equal(envios.length, 3);
  for (const e of envios) assert.deepEqual([e.estado, e.plantilla_id, Number(e.dias)], ['generado', plantilla.id, 14]);
  for (const x of [A, B, C]) x.envio = envios.find((e) => e.inscripcion_id === x.inscripcion).id;
  await assert.rejects(admin.panel(`feedback/plantillas/${plantilla.id}`, { version: 'otra', preguntas: PREGUNTAS }), (e) => e.status === 400 && /ya se ha usado/.test(e.message));
  const copia = await admin.panel(`feedback/plantillas/${plantilla.id}/duplicar`, { version: `copia-${crypto.randomBytes(3).toString('hex')}` });
  plantillas.push(copia.id);
  await admin.panel(`feedback/plantillas/${copia.id}`, { version: `copia-ed-${crypto.randomBytes(3).toString('hex')}`, preguntas: PREGUNTAS.slice(0, 2) });
});

test('3 asistentes: responde uno, abre otro sin responder, deja el tercero: los contadores cuadran', async () => {
  for (const x of [A, B, C]) {
    const w = await admin.panel(`feedback/envios/${x.envio}/enviar`, {});
    assert.ok(w.url.startsWith('https://wa.me/'));
    x.token = tokenDe(w.url);
  }
  const abierta = await fb(A.token, 'estado');
  assert.equal(abierta.status, 200);
  assert.equal(abierta.datos.preguntas.length, PREGUNTAS.length);
  assert.equal(abierta.datos.ronda.numero, 1);
  assert.equal((await fb(A.token, 'responder', { respuestas: { volverias: 'Sí' } })).status, 400, 'Falta la obligatoria');
  assert.equal((await fb(A.token, 'responder', { respuestas: { nota: 11, volverias: 'Sí' } })).status, 400, 'Fuera de escala');
  assert.equal((await fb(A.token, 'responder', { respuestas: { nota: 9, volverias: 'Quizá' } })).status, 400, 'Opción que no existe');
  const ok = await fb(A.token, 'responder', { respuestas: { nota: 9, organizacion: 5, volverias: 'Sí', mejorar: ['Horarios', 'Karts'], comentario: 'Muy bien' } });
  assert.equal(ok.status, 200);
  assert.equal((await fb(A.token, 'responder', { respuestas: { nota: 1, volverias: 'No' } })).status, 409, 'No se responde dos veces');
  assert.equal((await fb(A.token, 'estado')).datos.respondido, true);
  assert.equal((await fb(B.token, 'estado')).status, 200);

  const filas = await q('SELECT pregunta_id, valor_num::int AS n, valor_texto, valor_opciones FROM respuesta_feedback WHERE envio_id = $1 ORDER BY pregunta_id', [A.envio]);
  assert.deepEqual(filas.map((f) => f.pregunta_id), ['comentario', 'mejorar', 'nota', 'organizacion', 'volverias'], 'Una fila por pregunta respondida');
  assert.deepEqual(filas.find((f) => f.pregunta_id === 'mejorar').valor_opciones, ['Horarios', 'Karts']);

  const d = await admin.panel(`feedback/rondas/${r1.id}`);
  assert.deepEqual([d.contadores.envios, d.contadores.respondidos, d.contadores.abiertos, d.contadores.enviados, d.contadores.generados, d.contadores.caducados], [3, 1, 1, 1, 0, 0]);
  const estados = Object.fromEntries(d.envios.map((e) => [e.id, e.estado]));
  assert.deepEqual([estados[A.envio], estados[B.envio], estados[C.envio]], ['respondido', 'abierto', 'enviado']);
  // La lista de rondas es la de la temporada en curso (la de prueba está en borrador): basta con que cargue.
  assert.ok(Array.isArray((await admin.panel('feedback/rondas')).rondas));
  assert.ok((await admin.panel('hoy')).feedback.sin_responder >= 2, 'Hoy cuenta los que faltan');
});

test('Filtro "nota menor de 7" devuelve solo lo que corresponde, y la exportación respeta el filtro', async () => {
  assert.equal((await fb(B.token, 'responder', { respuestas: { nota: 5, volverias: 'No lo sé', comentario: 'Mucha espera entre mangas' } })).status, 200);
  const menor = await admin.panel(`feedback/rondas/${r1.id}?pregunta=nota&op=lt&valor=7`);
  assert.deepEqual(menor.envios.map((e) => e.id), [B.envio]);
  assert.deepEqual((await admin.panel(`feedback/rondas/${r1.id}?pregunta=nota&op=gte&valor=7`)).envios.map((e) => e.id), [A.envio]);
  assert.deepEqual((await admin.panel(`feedback/rondas/${r1.id}?pregunta=mejorar&op=contiene&valor=Karts`)).envios.map((e) => e.id), [A.envio]);
  assert.deepEqual((await admin.panel(`feedback/rondas/${r1.id}?pregunta=comentario&op=contiene&valor=espera`)).envios.map((e) => e.id), [B.envio]);
  await assert.rejects(admin.panel(`feedback/rondas/${r1.id}?pregunta=nota&op=lt&valor=siete`), (e) => e.status === 400);

  const res = await admin.crudo(`feedback/rondas/${r1.id}/exportar?formato=xlsx&pregunta=nota&op=lt&valor=7`);
  assert.equal(res.status, 200);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const hoja = libro.worksheets[0];
  assert.equal(hoja.rowCount, 2, 'Cabecera + 1 piloto con nota menor de 7');
  assert.equal(hoja.getRow(1).values.includes('¿Qué nota le pones a la ronda?'), true, 'Una columna por pregunta');
  assert.equal(hoja.getRow(2).values.includes(5), true);
});

test('Un enlace caducado ya no acepta respuestas, y el recordatorio cambia el enlace', async () => {
  const viejo = C.token;
  const rec = await admin.panel(`feedback/envios/${C.envio}/recordar`, {});
  C.token = tokenDe(rec.url);
  assert.equal((await fb(viejo, 'estado')).status, 404, 'El enlace anterior deja de valer');
  assert.equal((await fb(C.token, 'estado')).status, 200);
  const [e] = await q('SELECT estado, recordatorio_en IS NOT NULL AS recordado FROM envio_feedback WHERE id = $1', [C.envio]);
  assert.deepEqual(e, { estado: 'abierto', recordado: true });

  await q(`UPDATE envio_feedback SET expira_en = now() - interval '1 minute' WHERE id = $1`, [C.envio]);
  const caducado = await fb(C.token, 'responder', { respuestas: { nota: 3, volverias: 'No' } });
  assert.deepEqual([caducado.status, caducado.datos], [404, { error: 'No encontrado.' }]);
  assert.deepEqual([(await fb(C.token, 'estado')).status, (await fb(nuevoToken(), 'estado')).status, (await fb(null, 'estado')).status], [404, 404, 404]);
  assert.equal((await q('SELECT count(*)::int AS n FROM respuesta_feedback WHERE envio_id = $1', [C.envio]))[0].n, 0);
  await assert.rejects(admin.panel(`feedback/envios/${C.envio}/recordar`, {}), (err) => err.status === 400 && /caducado/.test(err.message));
  const d = await admin.panel(`feedback/rondas/${r1.id}`);
  assert.deepEqual([d.contadores.respondidos, d.contadores.caducados], [2, 1]);
});
