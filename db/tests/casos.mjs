// Casos de prueba del esquema. Cada caso recibe una conexión del rol rukc_app dentro de una transacción
// que el ejecutor deshace al terminar (ROLLBACK): crean sus datos, comprueban y no dejan nada.
// Necesitan los datos iniciales de db/seed/t2.sql (temporada T2, rondas, categorías, productos, entidad cobradora).
// db.query(sql, params) devuelve { rows }.
import assert from 'node:assert/strict';

// Teléfono de prueba en formato E.164 (+34 6xx xxx xxx), distinto en cada llamada.
const telefono = () => `+346${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

/** Ejecuta sql esperando un error cuyo mensaje cumpla `patron`. Usa un savepoint para seguir en la transacción. */
async function falla(db, sql, params, patron) {
  await db.query('SAVEPOINT prueba');
  try {
    await db.query(sql, params);
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT prueba');
    assert.match(e.message, patron, `Falló, pero con otro mensaje: ${e.message}`);
    return e;
  }
  await db.query('ROLLBACK TO SAVEPOINT prueba');
  throw new Error(`Debía fallar y no falló: ${sql}`);
}

const uno = async (db, sql, params) => (await db.query(sql, params)).rows[0];

/** Catálogo de la T2 y una persona, un pedido y una inscripción de carrera suelta (99 €) en la R2, categoría LIG. */
async function base(db, { categoria = 'LIG' } = {}) {
  const t = await uno(db, `SELECT t.id AS temporada, r.id AS ronda, r3.id AS ronda3, p.id AS producto,
      (SELECT id FROM categoria WHERE temporada_id = t.id AND codigo = 'LIG') AS lig,
      (SELECT id FROM categoria WHERE temporada_id = t.id AND codigo = 'PES') AS pes,
      (SELECT id FROM entidad_cobradora WHERE activa_hasta IS NULL) AS entidad
    FROM temporada t
    JOIN ronda r ON r.temporada_id = t.id AND r.numero = 2
    JOIN ronda r3 ON r3.temporada_id = t.id AND r3.numero = 3
    JOIN producto p ON p.temporada_id = t.id AND p.codigo = 'carrera_suelta'
    WHERE t.codigo = 'T2'`);
  assert.ok(t?.temporada, 'Faltan los datos iniciales de la T2 (npm run db:sembrar)');
  const persona = (await uno(db, `INSERT INTO persona (nombre, apellidos, telefono, origen_alta)
    VALUES ('Prueba', 'Esquema', $1, 'alta_manual') RETURNING id`, [telefono()])).id;
  const pedido = (await uno(db, `INSERT INTO pedido (temporada_id, pagador_persona_id, origen, subtotal_cent, total_cent)
    VALUES ($1, $2, 'manual', 9900, 9900) RETURNING id`, [t.temporada, persona])).id;
  const cat = categoria === 'LIG' ? t.lig : categoria === 'PES' ? t.pes : null;
  const inscripcion = (await uno(db, `INSERT INTO inscripcion (pedido_id, piloto_persona_id, ronda_id, producto_id, precio_cent, categoria_id, categoria_origen)
    VALUES ($1, $2, $3, $4, 9900, $5, $6) RETURNING id`,
    [pedido, persona, t.ronda, t.producto, cat, cat ? 'por_peso' : 'pendiente'])).id;
  return { ...t, persona, pedido, inscripcion };
}

async function pago(db, b, importe, estado = 'confirmado', metodo = 'efectivo') {
  return (await uno(db, `INSERT INTO pago (pagador_persona_id, entidad_cobradora_id, metodo, importe_cent, estado)
    VALUES ($1, $2, $3, $4, $5) RETURNING id`, [b.persona, b.entidad, metodo, importe, estado])).id;
}
const aplicar = (db, pagoId, inscripcion, importe) =>
  db.query('INSERT INTO aplicacion_pago (pago_id, inscripcion_id, importe_cent) VALUES ($1, $2, $3)', [pagoId, inscripcion, importe]);
const estado = async (db, tabla, id) => (await uno(db, `SELECT estado FROM ${tabla} WHERE id = $1`, [id])).estado;

export const casos = [
  ['1. Una transición no permitida falla', async (db) => {
    const t = await uno(db, `SELECT id FROM temporada WHERE codigo = 'T2'`);
    const s = await uno(db, `INSERT INTO solicitud_inscripcion (temporada_id, pagador_telefono) VALUES ($1, $2) RETURNING id, estado, codigo`,
      [t.id, telefono()]);
    assert.equal(s.estado, 'borrador');
    assert.match(s.codigo, /^RK-[A-Z2-9]{4}$/);
    await falla(db, `UPDATE solicitud_inscripcion SET estado = 'pagada' WHERE id = $1`, [s.id], /Transición no permitida.*borrador → pagada/);
    await falla(db, `UPDATE ronda SET estado = 'programada' WHERE temporada_id = $1 AND numero = 1`, [t.id], /Transición no permitida.*celebrada → programada/);
  }],

  ['2. Un pago no se puede aplicar por encima de su importe', async (db) => {
    const b = await base(db);
    const p = await pago(db, b, 3000);
    await falla(db, 'INSERT INTO aplicacion_pago (pago_id, inscripcion_id, importe_cent) VALUES ($1, $2, 3001)',
      [p, b.inscripcion], /supera su importe menos lo reembolsado/);
    const grande = await pago(db, b, 20000);
    await falla(db, 'INSERT INTO aplicacion_pago (pago_id, inscripcion_id, importe_cent) VALUES ($1, $2, 9901)',
      [grande, b.inscripcion], /supera su precio/);
  }],

  ['3. Una inscripción pasa sola de pendiente_pago a reservada (30 €) y a pagada (99 €)', async (db) => {
    const b = await base(db);
    assert.equal(await estado(db, 'inscripcion', b.inscripcion), 'pendiente_pago');
    await aplicar(db, await pago(db, b, 3000, 'confirmado', 'stripe_tarjeta'), b.inscripcion, 3000);
    assert.equal(await estado(db, 'inscripcion', b.inscripcion), 'reservada');
    assert.equal(await estado(db, 'pedido', b.pedido), 'pagado_parcial');
    await aplicar(db, await pago(db, b, 6900), b.inscripcion, 6900);
    assert.equal(await estado(db, 'inscripcion', b.inscripcion), 'pagada');
    assert.equal(await estado(db, 'pedido', b.pedido), 'pagado');
    assert.equal((await uno(db, 'SELECT inscripcion_saldo_cent($1) AS s', [b.inscripcion])).s, 0);
  }],

  ['4. Un reembolso parcial devuelve una inscripción pagada a reservada', async (db) => {
    const b = await base(db);
    await aplicar(db, await pago(db, b, 3000), b.inscripcion, 3000);
    const p2 = await pago(db, b, 6900);
    await aplicar(db, p2, b.inscripcion, 6900);
    assert.equal(await estado(db, 'inscripcion', b.inscripcion), 'pagada');
    // Sin reducir antes lo aplicado, el reembolso se rechaza.
    await falla(db, `INSERT INTO reembolso (pago_id, importe_cent, estado, motivo) VALUES ($1, 3000, 'emitido', 'prueba')`,
      [p2], /reduce lo aplicado/);
    await db.query('UPDATE aplicacion_pago SET importe_cent = 3900 WHERE pago_id = $1 AND inscripcion_id = $2', [p2, b.inscripcion]);
    await db.query(`INSERT INTO reembolso (pago_id, importe_cent, estado, motivo) VALUES ($1, 3000, 'emitido', 'prueba')`, [p2]);
    assert.equal(await estado(db, 'inscripcion', b.inscripcion), 'reservada');
    assert.equal(await estado(db, 'pago', p2), 'reembolsado_parcial');
    assert.equal((await uno(db, 'SELECT inscripcion_saldo_cent($1) AS s', [b.inscripcion])).s, 3000);
  }],

  ['5. El saldo de créditos no baja de cero', async (db) => {
    const b = await base(db);
    await db.query(`INSERT INTO movimiento_credito (persona_id, importe_cent, tipo, motivo) VALUES ($1, 1000, 'ajuste', 'prueba')`, [b.persona]);
    await falla(db, `INSERT INTO movimiento_credito (persona_id, importe_cent, tipo, inscripcion_id) VALUES ($1, -1500, 'canje', $2)`,
      [b.persona, b.inscripcion], /por debajo de cero/);
    // Un canje dentro del saldo sí cuenta para la inscripción.
    await db.query(`INSERT INTO movimiento_credito (persona_id, importe_cent, tipo, inscripcion_id) VALUES ($1, -1000, 'canje', $2)`,
      [b.persona, b.inscripcion]);
    assert.equal(await estado(db, 'inscripcion', b.inscripcion), 'reservada');
    assert.equal((await uno(db, 'SELECT credito_saldo_cent($1) AS s', [b.persona])).s, 0);
  }],

  ['6. Nadie puede tener dos inscripciones activas en la misma ronda y categoría', async (db) => {
    const b = await base(db);
    await falla(db, `INSERT INTO inscripcion (pedido_id, piloto_persona_id, ronda_id, producto_id, precio_cent, categoria_id, categoria_origen)
      VALUES ($1, $2, $3, $4, 9900, $5, 'por_peso')`, [b.pedido, b.persona, b.ronda, b.producto, b.lig], /inscripcion_activa_categoria/);
    // En otra categoría sí (la franja la regula la configuración, no el esquema).
    await db.query(`INSERT INTO inscripcion (pedido_id, piloto_persona_id, ronda_id, producto_id, precio_cent, categoria_id, categoria_origen)
      VALUES ($1, $2, $3, $4, 9900, $5, 'eleccion_franja')`, [b.pedido, b.persona, b.ronda, b.producto, b.pes]);
  }],

  ['7. Con la categoría nula, tampoco dos en la misma ronda', async (db) => {
    const b = await base(db, { categoria: null });
    await falla(db, `INSERT INTO inscripcion (pedido_id, piloto_persona_id, ronda_id, producto_id, precio_cent)
      VALUES ($1, $2, $3, $4, 9900)`, [b.pedido, b.persona, b.ronda, b.producto], /inscripcion_activa_sin_categoria/);
  }],

  ['8. rukc_app no puede borrar ni modificar evento', async (db) => {
    const b = await base(db);
    const e = await uno(db, `SELECT id FROM evento WHERE entidad = 'inscripcion' AND entidad_id = $1 LIMIT 1`, [b.inscripcion]);
    assert.ok(e, 'La inscripción nueva tenía que dejar rastro en evento');
    await falla(db, 'DELETE FROM evento WHERE id = $1', [e.id], /permission denied/);
    await falla(db, `UPDATE evento SET actor = 'otro' WHERE id = $1`, [e.id], /permission denied/);
  }],

  ['9. Una aceptación no se puede editar', async (db) => {
    const b = await base(db);
    // Tipo sin versión vigente en desarrollo (las de prueba del onboarding ocupan reglamento, imagen, riesgos y peso).
    const d = await uno(db, `INSERT INTO documento_legal (tipo, version, titulo, contenido_md, revocable, revisado_abogado_en, vigente_desde)
      VALUES ('privacidad', 'prueba-esquema', 'Prueba', 'Texto de prueba', true, current_date, now() - interval '1 minute') RETURNING id, hash_sha256`);
    assert.match(d.hash_sha256, /^[0-9a-f]{64}$/);
    const a = await uno(db, `INSERT INTO aceptacion (persona_id, firmante_persona_id, documento_legal_id, aceptado, contexto)
      VALUES ($1, $1, $2, true, 'onboarding') RETURNING id, documento_hash`, [b.persona, d.id]);
    assert.equal(a.documento_hash, d.hash_sha256);
    await falla(db, 'UPDATE aceptacion SET aceptado = false WHERE id = $1', [a.id], /permission denied/);
    await falla(db, 'DELETE FROM aceptacion WHERE id = $1', [a.id], /permission denied/);
    await db.query('UPDATE aceptacion SET revocada_en = now() WHERE id = $1', [a.id]);
    await falla(db, 'UPDATE aceptacion SET revocada_en = NULL WHERE id = $1', [a.id], /no se deshace/);
    // Un documento en borrador (sin fecha del abogado) no se puede aceptar ni activar.
    const borrador = await uno(db, `SELECT id FROM documento_legal WHERE tipo = 'reglamento' AND version = 'borrador-1'`);
    await falla(db, `INSERT INTO aceptacion (persona_id, firmante_persona_id, documento_legal_id, aceptado, contexto)
      VALUES ($1, $1, $2, true, 'onboarding')`, [b.persona, borrador.id], /versión vigente/);
    await falla(db, 'UPDATE documento_legal SET vigente_desde = now() WHERE id = $1', [borrador.id], /documento_activacion/);
  }],

  ['10. Los estados de cobro no se ponen a mano', async (db) => {
    const b = await base(db);
    await falla(db, `UPDATE inscripcion SET estado = 'pagada' WHERE id = $1`, [b.inscripcion], /se calculan a partir de los pagos/);
    await falla(db, `INSERT INTO inscripcion (pedido_id, piloto_persona_id, ronda_id, producto_id, precio_cent, estado)
      VALUES ($1, $2, $3, $4, 9900, 'reservada')`, [b.pedido, b.persona, b.ronda3, b.producto], /empieza en pendiente_pago/);
    await falla(db, `UPDATE pedido SET estado = 'pagado' WHERE id = $1`, [b.pedido], /se calcula solo/);
  }],

  ['11. Un Bizum pendiente no cuenta hasta que se confirma', async (db) => {
    const b = await base(db);
    const bizum = await pago(db, b, 3000, 'pendiente_verificacion', 'bizum_manual');
    await aplicar(db, bizum, b.inscripcion, 3000);
    assert.equal(await estado(db, 'inscripcion', b.inscripcion), 'pendiente_pago');
    await db.query(`UPDATE pago SET estado = 'confirmado' WHERE id = $1`, [bizum]);
    assert.equal(await estado(db, 'inscripcion', b.inscripcion), 'reservada');
  }],

  ['12. Cancelar una ronda cancela sus inscripciones activas, con motivo y resolución pendiente', async (db) => {
    const b = await base(db);
    await db.query(`UPDATE ronda SET estado = 'cancelada' WHERE id = $1`, [b.ronda]);
    const i = await uno(db, 'SELECT estado, resolucion, motivo FROM inscripcion WHERE id = $1', [b.inscripcion]);
    assert.deepEqual(i, { estado: 'cancelada', resolucion: 'pendiente', motivo: 'Ronda cancelada' });
    await db.query(`UPDATE inscripcion SET resolucion = 'credito' WHERE id = $1`, [b.inscripcion]);
    await falla(db, `UPDATE inscripcion SET resolucion = 'reembolso' WHERE id = $1`, [b.inscripcion], /Resolución no permitida/);
  }],

  ['13. Marcar asistió sin onboarding exige motivo', async (db) => {
    const b = await base(db);
    await aplicar(db, await pago(db, b, 3000), b.inscripcion, 3000);
    await falla(db, `UPDATE inscripcion SET estado = 'asistio' WHERE id = $1`, [b.inscripcion], /indica el motivo/);
    await db.query(`UPDATE inscripcion SET estado = 'asistio', motivo = 'Firmó en papel en el circuito' WHERE id = $1`, [b.inscripcion]);
    assert.equal(await estado(db, 'inscripcion', b.inscripcion), 'asistio');
  }],

  ['14. Cada cambio de estado y de dinero deja rastro en evento, sin datos personales', async (db) => {
    const b = await base(db);
    await db.query(`SELECT set_config('rukc.actor', 'admin:00000000-0000-4000-8000-000000000001', true)`);
    await aplicar(db, await pago(db, b, 3000), b.inscripcion, 3000);
    const ev = (await db.query(`SELECT entidad, accion, actor, antes, despues FROM evento
      WHERE entidad IN ('inscripcion', 'pago', 'aplicacion_pago', 'pedido')
        AND (entidad_id = $1 OR entidad_id LIKE '%' || $1 OR entidad_id = $2) ORDER BY id`, [b.inscripcion, b.pedido])).rows;
    const cambio = ev.find((e) => e.entidad === 'inscripcion' && e.accion === 'estado');
    assert.ok(cambio, 'Falta el cambio de estado de la inscripción');
    assert.deepEqual([cambio.antes.estado, cambio.despues.estado], ['pendiente_pago', 'reservada']);
    assert.equal(cambio.actor, 'admin:00000000-0000-4000-8000-000000000001');
    assert.ok(ev.some((e) => e.entidad === 'aplicacion_pago' && e.accion === 'alta'), 'Falta la aplicación del pago');
    const persona = (await db.query(`SELECT count(*)::int AS n FROM evento WHERE entidad = 'persona' AND entidad_id = $1
      AND (despues ? 'telefono' OR despues ? 'nombre')`, [b.persona])).rows[0].n;
    assert.equal(persona, 0, 'evento no debe copiar datos personales');
  }],

  ['15. Traslado: fuera de plazo exige motivo y mueve la inscripción', async (db) => {
    const b = await base(db);
    const destino = (await uno(db, `INSERT INTO inscripcion (pedido_id, piloto_persona_id, ronda_id, producto_id, precio_cent, categoria_id, categoria_origen)
      VALUES ($1, $2, $3, $4, 9900, $5, 'por_peso') RETURNING id`, [b.pedido, b.persona, b.ronda3, b.producto, b.lig])).id;
    // Aviso un día antes de la R2: fuera de plazo (14 días).
    await falla(db, `INSERT INTO traslado (inscripcion_origen_id, inscripcion_destino_id, solicitado_en)
      VALUES ($1, $2, '2026-11-20 10:00+01')`, [b.inscripcion, destino], /traslado_motivo/);
    await falla(db, `UPDATE inscripcion SET estado = 'trasladada' WHERE id = $1`, [b.inscripcion], /registra el traslado/);
    const t = await uno(db, `INSERT INTO traslado (inscripcion_origen_id, inscripcion_destino_id, solicitado_en, motivo_excepcion)
      VALUES ($1, $2, '2026-11-20 10:00+01', 'Lesión') RETURNING dias_antelacion, fuera_de_plazo`, [b.inscripcion, destino]);
    assert.deepEqual(t, { dias_antelacion: 1, fuera_de_plazo: true });
    await db.query(`UPDATE inscripcion SET estado = 'trasladada' WHERE id = $1`, [b.inscripcion]);
  }],
];
