// Panel de administración contra Neon desarrollo: F3 (lead sin duplicar), F4 (venta de temporada pagada por otra
// persona con Bizum pendiente + efectivo), confirmación del Bizum, cobro en circuito y exportación XLSX sin datos
// sensibles. Crea sus datos y los borra al terminar.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { Pool } from '@neondatabase/serverless';
import { adminConSesion } from './ayuda-panel.mjs';

for (const v of ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL']) if (!process.env[v]) throw new Error(`Falta ${v}`);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = async (t, p) => (await pool.query(t, p)).rows;
const tel = () => `+3469${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

let admin;
const personas = [];

before(async () => { admin = await adminConSesion(); });

after(async () => {
  const pedidos = (await q('SELECT id FROM pedido WHERE pagador_persona_id = ANY($1::uuid[])', [personas])).map((r) => r.id);
  const insc = (await q('SELECT id FROM inscripcion WHERE pedido_id = ANY($1::uuid[]) OR piloto_persona_id = ANY($2::uuid[])', [pedidos, personas])).map((r) => r.id);
  const pagos = (await q('SELECT id FROM pago WHERE pagador_persona_id = ANY($1::uuid[])', [personas])).map((r) => r.id);
  await q('DELETE FROM aplicacion_pago WHERE pago_id = ANY($1::uuid[]) OR inscripcion_id = ANY($2::uuid[])', [pagos, insc]);
  await q('DELETE FROM pago WHERE id = ANY($1::uuid[])', [pagos]);
  await q('DELETE FROM inscripcion WHERE id = ANY($1::uuid[])', [insc]);
  await q('DELETE FROM pedido WHERE id = ANY($1::uuid[])', [pedidos]);
  for (const t of ['onboarding', 'consentimiento', 'interaccion', 'oportunidad', 'atribucion']) await q(`DELETE FROM ${t} WHERE persona_id = ANY($1::uuid[])`, [personas]);
  await q('DELETE FROM persona WHERE id = ANY($1::uuid[])', [personas]);
  const [u] = await q('SELECT id FROM auth_usuario WHERE email = $1', [admin.email]);
  if (u) await q('DELETE FROM auth_usuario WHERE id = $1', [u.id]);
  await q('DELETE FROM vista_guardada WHERE admin_id IN (SELECT id FROM admin WHERE email = $1)', [admin.email]);
  await q('UPDATE admin SET activo = false WHERE email = $1', [admin.email]);
  await pool.end();
});

test('F3: un lead con un teléfono que ya existe abre la ficha en vez de duplicar', async () => {
  const telefono = tel();
  const nuevo = await admin.panel('leads', { telefono, nombre: 'Lead', apellidos: 'Prueba', canal: 'whatsapp', nota: 'Pregunta por la R2', proxima_accion: 'Llamar', proxima_accion_en: new Date(Date.now() - 3600e3).toISOString() });
  personas.push(nuevo.persona_id);
  const buscar = await admin.panel('leads/buscar', { telefono: telefono.replace('+34', '') });
  assert.equal(buscar.persona.id, nuevo.persona_id);
  await assert.rejects(admin.panel('leads', { telefono, nombre: 'Otro', canal: 'whatsapp', nota: 'x' }), (e) => e.status === 409 && e.datos.persona_id === nuevo.persona_id);
  const [l] = await q('SELECT etapa, origen, canal, accion_vencida, ultima_interaccion_tipo FROM v_leads WHERE persona_id = $1', [nuevo.persona_id]);
  assert.deepEqual(l, { etapa: 'nueva', origen: 'alta_manual', canal: 'whatsapp', accion_vencida: true, ultima_interaccion_tipo: 'whatsapp_entrante' });
  const hoy = await admin.panel('hoy');
  assert.ok(hoy.leadsVencidos.some((x) => x.persona_id === nuevo.persona_id), 'Sale en "Hoy" como acción vencida');
});

test('F4: temporada completa a un piloto que paga otra persona, Bizum pendiente + efectivo; al confirmar el Bizum cambian solas', async () => {
  const cat = await admin.panel('catalogo-venta');
  const temporada = cat.productos.find((p) => p.codigo === 'temporada_completa');
  const n = cat.rondas.length;
  const venta = await admin.panel('ventas', {
    pagador: { nombre: 'Madre Pagadora', telefono: tel(), email: `madre+${Date.now()}@example.com` },
    lineas: [{ piloto: { nombre: 'Hijo Piloto', telefono: tel() }, producto: 'temporada_completa', categoria: 'LIG' }],
    pagos: [
      { metodo: 'bizum_manual', importe_cent: 20000, verificado: false, referencia: 'Bizum de la madre' },
      { metodo: 'efectivo', importe_cent: 15000, verificado: true, cobrado_por: 'John' },
    ],
  });
  const [ped] = await q('SELECT pagador_persona_id, estado, total_cent FROM pedido WHERE id = $1', [venta.pedido_id]);
  personas.push(ped.pagador_persona_id, ...(await q('SELECT DISTINCT piloto_persona_id FROM inscripcion WHERE pedido_id = $1', [venta.pedido_id])).map((r) => r.piloto_persona_id));
  assert.equal(venta.inscripciones.length, n);
  assert.equal(venta.inscripciones.reduce((s, i) => s + i.precio_cent, 0), temporada.precio_cent, 'El precio de la temporada se reparte entre sus rondas');
  assert.equal(ped.total_cent, temporada.precio_cent);
  // Solo cuenta el efectivo (150 €): cubre la primera ronda entera y parte de la segunda. El Bizum está comprometido pero no cuenta.
  const estados = venta.inscripciones.map((i) => i.estado);
  assert.equal(estados[0], 'pagada');
  assert.equal(estados[1], 'reservada');
  assert.ok(estados.slice(2).every((e) => e === 'pendiente_pago'));
  assert.equal(ped.estado, 'pagado_parcial');
  const [o] = await q('SELECT estado FROM onboarding WHERE persona_id = $1', [personas.at(-1)]);
  assert.equal(o.estado, 'pendiente', 'El piloto con pago confirmado recibe su onboarding');
  assert.ok((await admin.panel('hoy')).porVerificar.some((p) => p.referencia_externa === 'Bizum de la madre'), 'El Bizum sale en "Pagos por verificar"');

  const [bizum] = await q(`SELECT id FROM pago WHERE pagador_persona_id = $1 AND metodo = 'bizum_manual'`, [ped.pagador_persona_id]);
  await admin.panel(`pagos/${bizum.id}/confirmar`, {});
  const tras = await q('SELECT vi.estado, vi.saldo_cent FROM v_inscripciones vi JOIN inscripcion i ON i.id = vi.id WHERE i.pedido_id = $1 ORDER BY vi.ronda_fecha', [venta.pedido_id]);
  const pagado = 35000;
  const cubiertas = tras.filter((x) => x.estado === 'pagada').length;
  assert.ok(cubiertas >= 2, `Con 350 € quedan pagadas al menos dos rondas (pagadas: ${cubiertas})`);
  assert.equal(tras.reduce((s, x) => s + Number(x.saldo_cent), 0), temporada.precio_cent - pagado, 'Los saldos cuadran con lo pagado');
  const [v] = await q('SELECT paga_otra_persona, pagador, piloto FROM v_inscripciones vi JOIN inscripcion i ON i.id = vi.id WHERE i.pedido_id = $1 LIMIT 1', [venta.pedido_id]);
  assert.deepEqual(v, { paga_otra_persona: true, pagador: 'Madre Pagadora', piloto: 'Hijo Piloto' });
});

test('cobro en circuito: 69 € en efectivo pasan una inscripción de reservada a pagada en un toque', async () => {
  const cat = await admin.panel('catalogo-venta');
  const ronda = cat.rondas[0];
  const venta = await admin.panel('ventas', {
    pagador: { nombre: 'Piloto Circuito', telefono: tel() },
    lineas: [{ piloto: 'pagador', producto: 'carrera_suelta', ronda_id: ronda.id, categoria: 'PES' }],
    pagos: [{ metodo: 'bizum_manual', importe_cent: 3000, verificado: true }],
  });
  const [ped] = await q('SELECT pagador_persona_id FROM pedido WHERE id = $1', [venta.pedido_id]);
  personas.push(ped.pagador_persona_id);
  assert.equal(venta.inscripciones[0].estado, 'reservada');
  const pendientes = await admin.panel(`rondas/${ronda.id}/cobros`);
  const fila = pendientes.inscripciones.find((i) => i.id === venta.inscripciones[0].id);
  assert.equal(Number(fila.saldo_cent), 6900);
  const r = await admin.panel(`rondas/${ronda.id}/cobro`, { inscripcion_id: fila.id });
  assert.deepEqual({ estado: r.inscripcion.estado, saldo: Number(r.inscripcion.saldo_cent) }, { estado: 'pagada', saldo: 0 });
  const [p] = await q(`SELECT metodo, importe_cent, cobrado_por, ronda_id FROM pago WHERE codigo = $1`, [r.pago]);
  assert.deepEqual(p, { metodo: 'efectivo', importe_cent: 6900, cobrado_por: 'Prueba Panel', ronda_id: ronda.id });
});

test('exportación XLSX de inscripciones: abre como Excel y no lleva DNI ni peso; los sensibles exigen confirmación', async () => {
  const buf = await admin.panel(`exportar/inscripciones?formato=xlsx&q=${encodeURIComponent('Hijo Piloto')}`);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(Buffer.from(buf));
  const hoja = libro.worksheets[0];
  const cabeceras = hoja.getRow(1).values.filter(Boolean).map(String);
  assert.ok(cabeceras.includes('Piloto') && cabeceras.includes('Saldo (€)'));
  assert.ok(!cabeceras.some((h) => /dni|documento|peso|nacimiento/i.test(h)), `Sin datos sensibles: ${cabeceras.join(', ')}`);
  assert.ok(hoja.rowCount >= 2, 'Trae las filas filtradas');
  await assert.rejects(admin.panel('exportar/inscripciones?formato=xlsx&sensibles=1'), (e) => e.status === 400);
  const csv = Buffer.from(await admin.panel('exportar/pagos?formato=csv')).toString('utf8');
  assert.match(csv, /^﻿Código;Fecha;Método;Importe \(€\)/);
});

test('listas: filtros combinados con Y y vistas guardadas', async () => {
  const f = JSON.stringify([{ c: 'estado', op: 'eq', v: 'pagada' }, { c: 'paga_otra_persona', op: 'si' }]);
  const r = await admin.panel(`lista/inscripciones?f=${encodeURIComponent(f)}`);
  assert.ok(r.filas.length >= 1 && r.filas.every((x) => x.estado === 'pagada' && x.paga_otra_persona));
  await assert.rejects(admin.panel(`lista/inscripciones?f=${encodeURIComponent(JSON.stringify([{ c: 'nif; DROP', op: 'eq', v: 1 }]))}`), (e) => e.status === 400);
  await admin.panel('vistas', { pantalla: 'inscripciones', nombre: 'Pagadas por otros', filtros: { f } });
  const v = await admin.panel('vistas/inscripciones');
  assert.ok(v.vistas.some((x) => x.nombre === 'Pagadas por otros'));
});

test('Cerrar sesión en todos los dispositivos: las dos sesiones dejan de valer', async () => {
  const otro = await adminConSesion();
  const movil = await otro.otroDispositivo();
  assert.equal((await movil.panel('hoy')).status, 200, 'El segundo dispositivo entra');
  assert.ok(await otro.panel('hoy'), 'El primero también');
  const r = await otro.auth('revoke-sessions', {});
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await movil.panel('hoy')).status, 401, 'El otro dispositivo queda fuera');
  assert.equal((await otro.crudo('hoy')).status, 401, 'Y este también');
});
