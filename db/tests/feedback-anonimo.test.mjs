// Feedback anónimo y sorteo contra Neon desarrollo, llamando a /api/feedback-anonimo como lo haría Vercel.
// Usa una ronda de prueba (T9-R9, añadida a la configuración solo mientras dura el test) y borra lo que crea.
// Cubre las pruebas 5 a 8 de la tarea en el servidor: preguntas ocultas que no se guardan, filas sin datos que
// identifiquen ni hora, tablas sin nada en común, el cuerpo de la petición fuera de los logs y las fechas de cierre.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from '@neondatabase/serverless';
import { RONDAS } from '../../src/config/feedback/rondas.js';

if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');
const { GET, POST } = await import('../../api/feedback-anonimo.js');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = async (t, p) => (await pool.query(t, p)).rows;

const PRUEBA = {
  slug: 'prueba-anonimo', round_id: 'T9-R9', nombre: 'R9', circuito: 'Circuito de prueba', fecha_carrera: '2026-11-22',
  abre: '2026-11-22T18:00:00+01:00', cierra: '2026-11-28T23:59:00+01:00', modulo: 'M1', formacion_entregada: false,
  proxima_ronda: 'R10, de prueba',
};
const ABIERTO = '2026-11-23T10:00:00Z';
const BASE = 'http://localhost:4321';
const CENTINELA = 'CENTINELA-LOGS-7f3a9c';

// Respuestas válidas de un piloto que repite y no lleva lastre, con datos que deben caerse.
const RESPUESTAS = {
  C1: 'dos_tres', C2: 'ligeros', C3: 'suelta', C4: 'no', C5: 'menos_30', C6: 2, C6_seg: '', C7: 'no_lastre', C8: 'mas_10',
  C9: 'si', C10: 'mayoria', C11: 'no', C12: 4, C13: 'no', C14: 'si', C15: 'no', C16: 5, C17: 'no', C18: 'si', C19: 'poco',
  C20: 4, C21: 'si', 'M1.1': 'no', 'M1.2': 'bastante', 'M1.3': 'poco', 'M1.4': ['frenada', 'trazada'], 'M1.5': 'igual',
  C22: 3, C22_seg: '  ', C23: 'no', C24: 'si', C25: 'varias', C26: 'apuntado', C27: 7, C27_seg: CENTINELA,
  N1: 'otro', N1_otro: 'No debería guardarse',
};

async function llamar(ruta, cuerpo, { ahora = ABIERTO, origin = BASE, ronda = PRUEBA.slug, crudo } = {}) {
  const u = new URL(`${BASE}/api/feedback-anonimo`);
  u.searchParams.set('ruta', ruta);
  if (ahora) u.searchParams.set('ahora', ahora);
  if (cuerpo === undefined) u.searchParams.set('ronda', ronda);
  const res = await (cuerpo === undefined ? GET : POST)(new Request(u, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77', 'user-agent': 'Prueba/1.0' },
    body: cuerpo === undefined ? undefined : (crudo ?? JSON.stringify({ ronda, ...cuerpo })),
  }));
  return { status: res.status, datos: await res.json() };
}

// Todo lo que se escriba en consola durante el test, para comprobar que el cuerpo nunca aparece.
const salida = [];
const originales = {};
before(() => {
  RONDAS.push(PRUEBA);
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
    originales[m] = console[m];
    console[m] = (...a) => { salida.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, Object.getOwnPropertyNames(x ?? {})))).join(' ')); };
  }
});
after(async () => {
  Object.assign(console, originales);
  RONDAS.splice(RONDAS.indexOf(PRUEBA), 1);
  await q(`DELETE FROM feedback_responses WHERE round_id = $1`, [PRUEBA.round_id]);
  await q(`DELETE FROM raffle_entries WHERE round_id = $1`, [PRUEBA.round_id]);
  await q(`DELETE FROM limite_peticion WHERE clave LIKE $1`, [`anonimo:%:${PRUEBA.round_id}`]);
  await pool.end();
});

test('8. Fuera de fechas las dos rutas dicen cerrado y no guardan nada', async () => {
  assert.equal((await llamar('estado', undefined, { ahora: '2026-11-22T16:59:00Z' })).datos.estado, 'antes');
  assert.equal((await llamar('estado', undefined, { ahora: ABIERTO })).datos.estado, 'abierto');
  assert.equal((await llamar('estado', undefined, { ahora: '2026-11-28T23:00:00Z' })).datos.estado, 'cerrado');
  const r = await llamar('responder', { respuestas: RESPUESTAS }, { ahora: '2026-11-29T10:00:00Z' });
  assert.equal(r.status, 410);
  const s = await llamar('sorteo', { nombre: 'Ana Prueba', whatsapp: '600000001', privacidad: true }, { ahora: '2026-11-22T10:00:00Z' });
  assert.equal(s.status, 410);
  assert.equal((await q(`SELECT count(*)::int AS n FROM feedback_responses WHERE round_id = $1`, [PRUEBA.round_id]))[0].n, 0);
  assert.equal((await llamar('estado', undefined, { ronda: 'no-existe' })).status, 404);
});

test('5 y 6. Se guarda solo lo visible, con la fecha y sin nada que identifique', async () => {
  const r = await llamar('responder', { respuestas: RESPUESTAS, web: '' });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  const filas = await q(`SELECT * FROM feedback_responses WHERE round_id = $1`, [PRUEBA.round_id]);
  assert.equal(filas.length, 1);
  const f = filas[0];
  assert.deepEqual(Object.keys(f).sort(), ['answers', 'form_version', 'id', 'round_id', 'submitted_on']);
  assert.match(f.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'UUID v4 aleatorio');
  assert.equal(f.form_version, '1-M1');
  const [tipo] = await q(`SELECT pg_typeof(submitted_on)::text AS t, submitted_on::text AS d FROM feedback_responses WHERE id = $1`, [f.id]);
  assert.equal(tipo.t, 'date', 'solo la fecha, sin hora');
  const a = f.answers;
  assert.equal(a.C8, 'no_lastre', 'C8 automática');
  for (const k of ['C14', 'M1.2', 'M1.3', 'N1', 'N1_otro', 'C6_seg', 'C22_seg']) assert.ok(!(k in a), `${k} no debería guardarse`);
  assert.equal(a.C27_seg, CENTINELA);
  assert.deepEqual(a['M1.4'], ['trazada', 'frenada'], 'las múltiples en el orden del banco');
  // Ni IP ni user agent en ninguna parte de la fila.
  assert.ok(!JSON.stringify(f).includes('203.0.113.77') && !JSON.stringify(f).includes('Prueba/1.0'));
  // Ni rastro de la IP en el límite de peticiones: la clave es solo ruta y ronda.
  const claves = await q(`SELECT clave FROM limite_peticion WHERE clave LIKE $1`, [`anonimo:%:${PRUEBA.round_id}`]);
  assert.deepEqual(claves.map((c) => c.clave), ['anonimo:responder:T9-R9']);
});

test('Obligatorias y validación en el servidor', async () => {
  const sinC5 = { ...RESPUESTAS }; delete sinC5.C5;
  const r = await llamar('responder', { respuestas: sinC5 });
  assert.equal(r.status, 400);
  assert.equal(r.datos.campo, 'C5');
  assert.ok(!JSON.stringify(r.datos).includes(CENTINELA), 'el error no repite lo enviado');
  assert.equal((await llamar('responder', { respuestas: { ...RESPUESTAS, ip: 'x' } })).status, 400);
  assert.equal((await llamar('responder', {}, { crudo: '{no es json' })).status, 400);
  assert.equal((await llamar('responder', {}, { crudo: JSON.stringify({ ronda: PRUEBA.slug, x: 'a'.repeat(40000) }) })).status, 413);
  assert.equal((await llamar('responder', { respuestas: RESPUESTAS }, { origin: 'https://otra-web.com' })).status, 403);
  // Campo trampa relleno: responde ok y no guarda.
  const antes = (await q(`SELECT count(*)::int AS n FROM feedback_responses WHERE round_id = $1`, [PRUEBA.round_id]))[0].n;
  assert.equal((await llamar('responder', { respuestas: RESPUESTAS, web: 'http://spam' })).status, 200);
  assert.equal((await q(`SELECT count(*)::int AS n FROM feedback_responses WHERE round_id = $1`, [PRUEBA.round_id]))[0].n, antes);
});

test('Varias respuestas: todas comparten transacción interna (xmin) y el orden físico no es el de llegada', async () => {
  for (let i = 0; i < 6; i++) assert.equal((await llamar('responder', { respuestas: { ...RESPUESTAS, C27: i } })).status, 200);
  const filas = await q(`SELECT xmin::text AS xmin, answers->>'C27' AS c27 FROM feedback_responses WHERE round_id = $1 ORDER BY ctid`, [PRUEBA.round_id]);
  assert.equal(filas.length, 7);
  assert.equal(new Set(filas.map((f) => f.xmin)).size, 1, 'un solo xmin para toda la ronda');
});

test('6. Sorteo: tabla aparte, sin campo para unirla con las respuestas', async () => {
  const s = await llamar('sorteo', { nombre: '  Ana   Prueba ', whatsapp: '600 00 00 01', privacidad: true, web: '' });
  assert.equal(s.status, 200, JSON.stringify(s.datos));
  // El mismo número otra vez: misma respuesta, una sola fila.
  assert.equal((await llamar('sorteo', { nombre: 'Ana Prueba', whatsapp: '+34600000001', privacidad: true })).status, 200);
  assert.equal((await llamar('sorteo', { nombre: 'Luis Prueba', whatsapp: '600000002', privacidad: true })).status, 200);
  const filas = await q(`SELECT * FROM raffle_entries WHERE round_id = $1 ORDER BY name`, [PRUEBA.round_id]);
  assert.equal(filas.length, 2);
  assert.deepEqual(Object.keys(filas[0]).sort(), ['created_on', 'id', 'name', 'privacy_accepted', 'round_id', 'whatsapp']);
  assert.equal(filas[0].name, 'Ana Prueba');
  assert.equal(filas[0].whatsapp, '+34600000001');
  // Columnas en común: solo id (UUID independientes) y round_id. Sin claves foráneas entre las dos.
  const cols = async (t) => (await q(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [t])).map((c) => c.column_name);
  const fr = await cols('feedback_responses');
  const re = await cols('raffle_entries');
  assert.deepEqual(fr.filter((c) => re.includes(c)).sort(), ['id', 'round_id']);
  const fks = await q(`SELECT conname FROM pg_constraint WHERE contype = 'f' AND conrelid IN ('feedback_responses'::regclass, 'raffle_entries'::regclass)`);
  assert.equal(fks.length, 0);
  const ids = (await q(`SELECT id FROM feedback_responses WHERE round_id = $1`, [PRUEBA.round_id])).map((x) => x.id);
  assert.ok(!filas.some((f) => ids.includes(f.id)));
  // Validación.
  assert.equal((await llamar('sorteo', { nombre: 'Ana Prueba', whatsapp: '12', privacidad: true })).datos.campo, 'whatsapp');
  assert.equal((await llamar('sorteo', { nombre: 'A', whatsapp: '600000003', privacidad: true })).datos.campo, 'nombre');
  assert.equal((await llamar('sorteo', { nombre: 'Ana Prueba', whatsapp: '600000003', privacidad: false })).datos.campo, 'privacidad');
});

test('7. El cuerpo de las peticiones no aparece en los logs, ni siquiera cuando falla la base de datos', async () => {
  // Fuerza un error de base de datos (round_id que no cumple el CHECK) para pasar por el registro de errores.
  const rota = { ...PRUEBA, slug: 'prueba-rota', round_id: 'mal' };
  RONDAS.push(rota);
  try {
    const r = await llamar('responder', { respuestas: RESPUESTAS }, { ronda: 'prueba-rota' });
    assert.equal(r.status, 500);
    const s = await llamar('sorteo', { nombre: `Nombre ${CENTINELA}`, whatsapp: '600000009', privacidad: true }, { ronda: 'prueba-rota' });
    assert.equal(s.status, 500);
  } finally { RONDAS.splice(RONDAS.indexOf(rota), 1); }
  assert.ok(salida.length >= 2, 'los errores sí se registran');
  const todo = salida.join('\n');
  assert.ok(!todo.includes(CENTINELA), `el log contiene el cuerpo:\n${todo}`);
  assert.ok(!todo.includes('600000009') && !todo.includes('203.0.113.77'));
});
