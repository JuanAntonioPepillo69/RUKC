// Operaciones de dinero de la fase 6: traslados (F7), cancelaciones y su resolución (F8), reembolsos y créditos.
// Las reglas duras están en la base de datos (traslado fuera de plazo exige motivo, lo aplicado no supera lo cobrado
// menos lo reembolsado, el saldo de créditos no baja de cero...). Aquí se encadenan los pasos en el orden correcto.
// Todas reciben un cliente `c` dentro de una transacción, salvo los reembolsos de Stripe, que se hacen en dos
// transacciones con la llamada a Stripe en medio (ver reembolsarPago).
import { stripe } from './stripe.js';

const uno = async (c, t, p) => (await c.query(t, p)).rows[0];
const filas = async (c, t, p) => (await c.query(t, p)).rows;
const err = (status, mensaje, extra = {}) => Object.assign(new Error(mensaje), { status, ...extra });
const ACTIVAS = ['pendiente_pago', 'reservada', 'pagada'];

// ---------- Traslados (F7) ----------

/**
 * Mueve una inscripción a otra ronda de la misma temporada: crea la inscripción destino (mismo piloto, pedido,
 * producto, precio y categoría), registra el traslado (días de antelación y si va fuera de plazo; fuera de plazo
 * exige motivo), mueve los pagos aplicados y los canjes de crédito, y deja la origen en "trasladada".
 * Una inscripción cancelada (ronda cancelada) también se puede trasladar: queda cancelada con resolución "traslado".
 * `aviso`: cuándo avisó el piloto (por defecto, ahora).
 */
export async function trasladar(c, inscripcionId, { rondaDestinoId, aviso = null, motivo = null, creadoPor = 'sistema' }) {
  const o = await uno(c, `SELECT i.*, r.temporada_id, r.fecha AS fecha_origen FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id WHERE i.id = $1 FOR UPDATE OF i`, [inscripcionId]);
  if (!o) throw err(404, 'No existe esa inscripción.');
  const cancelada = o.estado === 'cancelada';
  if (!ACTIVAS.includes(o.estado) && !(cancelada && o.resolucion === 'pendiente')) {
    throw err(400, `Una inscripción ${o.estado.replace('_', ' ')} no se puede trasladar.`);
  }
  const d = await uno(c, 'SELECT id, temporada_id, estado, numero FROM ronda WHERE id = $1', [rondaDestinoId]);
  if (!d || d.temporada_id !== o.temporada_id) throw err(400, 'La ronda destino tiene que ser de la misma temporada.');
  if (d.id === o.ronda_id) throw err(400, 'Elige otra ronda.');
  if (!['programada', 'aplazada'].includes(d.estado)) throw err(400, `La R${d.numero} no admite inscripciones (está ${d.estado}).`);

  const destino = await uno(c, `INSERT INTO inscripcion (pedido_id, piloto_persona_id, ronda_id, producto_id, precio_cent, categoria_id, categoria_origen, creado_por)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, codigo, sobrecupo`,
  [o.pedido_id, o.piloto_persona_id, d.id, o.producto_id, o.precio_cent, o.categoria_id, o.categoria_origen, creadoPor]);
  const t = await uno(c, `INSERT INTO traslado (inscripcion_origen_id, inscripcion_destino_id, solicitado_en, motivo_excepcion, creado_por)
    VALUES ($1, $2, coalesce($3::timestamptz, now()), $4, $5) RETURNING dias_antelacion, fuera_de_plazo`,
  [o.id, destino.id, aviso, motivo || (cancelada ? 'Ronda cancelada' : null), creadoPor]).catch((e) => {
    if (e.constraint === 'traslado_motivo') throw err(400, 'Avisó con menos días de los que pide la temporada: indica el motivo de la excepción.', { necesita_motivo: true });
    throw e;
  });
  await c.query('UPDATE aplicacion_pago SET inscripcion_id = $2 WHERE inscripcion_id = $1', [o.id, destino.id]);
  await c.query(`UPDATE movimiento_credito SET inscripcion_id = $2 WHERE inscripcion_id = $1 AND tipo = 'canje'`, [o.id, destino.id]);
  if (cancelada) await c.query(`UPDATE inscripcion SET resolucion = 'traslado' WHERE id = $1`, [o.id]);
  else await c.query(`UPDATE inscripcion SET estado = 'trasladada', motivo = coalesce($2, motivo) WHERE id = $1`, [o.id, motivo]);
  const fin = await uno(c, 'SELECT estado FROM inscripcion WHERE id = $1', [destino.id]);
  return { destino: { id: destino.id, codigo: destino.codigo, estado: fin.estado, sobrecupo: destino.sobrecupo }, ...t };
}

// ---------- Cancelaciones (F8) ----------

/** Cancela una ronda (con motivo): sus inscripciones activas pasan a cancelada con resolución pendiente (trigger). */
export async function cancelarRonda(c, rondaId, motivo) {
  const r = await uno(c, 'SELECT estado, notas FROM ronda WHERE id = $1 FOR UPDATE', [rondaId]);
  if (!r) throw err(404, 'No existe esa ronda.');
  await c.query(`UPDATE ronda SET estado = 'cancelada', notas = btrim(coalesce(notas || ' · ', '') || $2) WHERE id = $1`, [rondaId, `Cancelada: ${motivo}`]);
  const n = await uno(c, `SELECT count(*)::int AS n FROM inscripcion WHERE ronda_id = $1 AND estado = 'cancelada' AND resolucion = 'pendiente'`, [rondaId]);
  return { canceladas: n.n };
}

/** Cancela una inscripción suelta (el piloto se da de baja), con motivo; queda con resolución pendiente. */
export async function cancelarInscripcion(c, inscripcionId, motivo) {
  const i = await uno(c, 'SELECT estado FROM inscripcion WHERE id = $1 FOR UPDATE', [inscripcionId]);
  if (!i) throw err(404, 'No existe esa inscripción.');
  if (!ACTIVAS.includes(i.estado)) throw err(400, `Una inscripción ${i.estado.replace('_', ' ')} no se cancela.`);
  await c.query(`UPDATE inscripcion SET estado = 'cancelada', motivo = $2 WHERE id = $1`, [inscripcionId, motivo]);
}

/** Lo cobrado de una inscripción, por pago (los pagos confirmados o reembolsados en parte que tiene aplicados). */
export const pagosDe = (c, inscripcionId) => filas(c, `SELECT p.id, p.codigo, p.metodo, p.stripe_payment_intent_id, p.pagador_persona_id, a.importe_cent
  FROM aplicacion_pago a JOIN pago p ON p.id = a.pago_id
  WHERE a.inscripcion_id = $1 AND p.estado IN ('confirmado', 'reembolsado_parcial') ORDER BY p.creado_en`, [inscripcionId]);

async function inscripcionPendiente(c, inscripcionId) {
  const i = await uno(c, 'SELECT id, estado, resolucion, codigo, pedido_id FROM inscripcion WHERE id = $1 FOR UPDATE', [inscripcionId]);
  if (!i) throw err(404, 'No existe esa inscripción.');
  if (i.estado !== 'cancelada' || i.resolucion !== 'pendiente') throw err(400, 'Solo se resuelven inscripciones canceladas con resolución pendiente.');
  return i;
}

/**
 * Resolución con crédito: lo pagado por la inscripción se abona como crédito a quien lo pagó
 * (movimiento compensacion_cancelacion). Los pagos siguen aplicados a la inscripción cancelada: el dinero se cobró.
 */
export async function resolverConCredito(c, inscripcionId, { caducaEn = null, creadoPor = 'sistema' } = {}) {
  const i = await inscripcionPendiente(c, inscripcionId);
  const pagos = await pagosDe(c, i.id);
  const porPagador = new Map();
  for (const p of pagos) porPagador.set(p.pagador_persona_id, (porPagador.get(p.pagador_persona_id) ?? 0) + p.importe_cent);
  const credito = await uno(c, 'SELECT coalesce(-sum(importe_cent), 0)::int AS n FROM movimiento_credito WHERE inscripcion_id = $1 AND tipo = $2', [i.id, 'canje']);
  if (credito.n) {
    const piloto = await uno(c, 'SELECT persona_id FROM movimiento_credito WHERE inscripcion_id = $1 AND tipo = $2 LIMIT 1', [i.id, 'canje']);
    porPagador.set(piloto.persona_id, (porPagador.get(piloto.persona_id) ?? 0) + credito.n);
  }
  for (const [persona, importe] of porPagador) {
    await c.query(`INSERT INTO movimiento_credito (persona_id, importe_cent, tipo, inscripcion_id, caduca_en, motivo, creado_por)
      VALUES ($1, $2, 'compensacion_cancelacion', $3, $4, $5, $6)`, [persona, importe, i.id, caducaEn, `Cancelación de ${i.codigo}`, creadoPor]);
  }
  await c.query(`UPDATE inscripcion SET resolucion = 'credito' WHERE id = $1`, [i.id]);
  return { abonado_cent: [...porPagador.values()].reduce((a, b) => a + b, 0) };
}

/** Resolución sin devolución (el piloto renuncia o no corresponde devolver). */
export async function resolverSinDevolucion(c, inscripcionId) {
  const i = await inscripcionPendiente(c, inscripcionId);
  await c.query(`UPDATE inscripcion SET resolucion = 'sin_devolucion' WHERE id = $1`, [i.id]);
}

// ---------- Reembolsos ----------

const ES_STRIPE = (p) => p.metodo.startsWith('stripe_') && p.stripe_payment_intent_id;

/**
 * Paso 1 de un reembolso (dentro de una transacción): deja libre la parte del pago que se devuelve y crea el
 * reembolso. Primero quita lo aplicado a `inscripcionId` (si se da); si no basta, usa lo que el pago tenga sin
 * aplicar y, al final, lo aplicado a sus inscripciones de la ronda más lejana a la más cercana.
 * Un pago manual (Bizum, transferencia, efectivo) se marca emitido aquí mismo: el administrador ya devolvió el dinero.
 * Un pago de Stripe queda "pendiente" hasta que Stripe responde (paso 2).
 */
export async function prepararReembolso(c, pagoId, { importe, motivo, inscripcionId = null, creadoPor = 'sistema' }) {
  const p = await uno(c, `SELECT p.*, (SELECT coalesce(sum(importe_cent), 0)::int FROM reembolso WHERE pago_id = p.id AND estado IN ('emitido', 'pendiente')) AS reembolsado,
      (SELECT coalesce(sum(importe_cent), 0)::int FROM aplicacion_pago WHERE pago_id = p.id) AS aplicado
    FROM pago p WHERE p.id = $1 FOR UPDATE OF p`, [pagoId]);
  if (!p) throw err(404, 'No existe ese pago.');
  if (!['confirmado', 'reembolsado_parcial'].includes(p.estado)) throw err(400, `Solo se reembolsan pagos confirmados (${p.codigo} está ${p.estado.replace('_', ' ')}).`);
  if (!Number.isInteger(importe) || importe <= 0) throw err(400, 'Indica el importe a devolver.');
  if (importe > p.importe_cent - p.reembolsado) throw err(400, `Como mucho se pueden devolver ${(p.importe_cent - p.reembolsado) / 100} € de ${p.codigo}.`);

  const sinAplicar = Math.max(0, p.importe_cent - p.reembolsado - p.aplicado);
  const quitar = async (inscripcion, cuanto) => {
    const a = await uno(c, 'SELECT importe_cent FROM aplicacion_pago WHERE pago_id = $1 AND inscripcion_id = $2', [p.id, inscripcion]);
    if (!a || cuanto <= 0) return 0;
    const q = Math.min(a.importe_cent, cuanto);
    if (q === a.importe_cent) await c.query('DELETE FROM aplicacion_pago WHERE pago_id = $1 AND inscripcion_id = $2', [p.id, inscripcion]);
    else await c.query('UPDATE aplicacion_pago SET importe_cent = importe_cent - $3 WHERE pago_id = $1 AND inscripcion_id = $2', [p.id, inscripcion, q]);
    return q;
  };
  // Lo de la inscripción indicada sale primero, aunque el pago tenga una parte sin aplicar.
  const restante = importe - (inscripcionId ? await quitar(inscripcionId, importe) : 0);
  let falta = restante - sinAplicar;
  if (falta > 0) {
    const otras = await filas(c, `SELECT a.inscripcion_id FROM aplicacion_pago a JOIN inscripcion i ON i.id = a.inscripcion_id JOIN ronda r ON r.id = i.ronda_id
      WHERE a.pago_id = $1 ORDER BY r.fecha DESC`, [p.id]);
    for (const o of otras) { if (falta <= 0) break; falta -= await quitar(o.inscripcion_id, falta); }
  }
  const manual = !ES_STRIPE(p);
  const r = await uno(c, `INSERT INTO reembolso (pago_id, importe_cent, estado, motivo, creado_por) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [p.id, importe, manual ? 'emitido' : 'pendiente', motivo, creadoPor]);
  return { reembolso_id: r.id, stripe: manual ? null : { payment_intent: p.stripe_payment_intent_id }, codigo: p.codigo };
}

/**
 * Paso 2 de un reembolso de Stripe (fuera de la transacción del paso 1): pide el reembolso con la clave de
 * idempotencia del propio reembolso (repetirlo no devuelve dos veces) y devuelve el resultado para guardarlo.
 * Sin datos personales en los metadatos: solo el identificador del reembolso.
 */
export async function pedirReembolsoStripe(reembolsoId, paymentIntent, importe) {
  try {
    const r = await stripe('refunds', { payment_intent: paymentIntent, amount: String(importe), 'metadata[reembolso_id]': reembolsoId }, 'POST', { idempotencia: `reembolso-${reembolsoId}` });
    return r.status === 'failed' || r.status === 'canceled' ? { ok: false, error: `Stripe: reembolso ${r.status}` } : { ok: true, id: r.id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Paso 3: guarda lo que dijo Stripe. Si falló, el reembolso queda "fallido" y el pago tal cual (sin la parte que se liberó). */
export async function cerrarReembolsoStripe(c, reembolsoId, resultado) {
  if (resultado.ok) await c.query(`UPDATE reembolso SET estado = 'emitido', stripe_refund_id = $2 WHERE id = $1 AND estado = 'pendiente'`, [reembolsoId, resultado.id]);
  else await c.query(`UPDATE reembolso SET estado = 'fallido', motivo = motivo || $2 WHERE id = $1 AND estado = 'pendiente'`, [reembolsoId, ` · ${resultado.error}`.slice(0, 300)]);
}

/**
 * Reembolso completo de un pago con transacciones `tx(fn)`: prepara, llama a Stripe si toca y cierra.
 * Devuelve { estado: 'emitido' | 'fallido', error? }.
 */
export async function reembolsarPago(tx, pagoId, opciones) {
  const prep = await tx((c) => prepararReembolso(c, pagoId, opciones));
  if (!prep.stripe) return { estado: 'emitido', reembolso_id: prep.reembolso_id, metodo: 'manual' };
  const res = await pedirReembolsoStripe(prep.reembolso_id, prep.stripe.payment_intent, opciones.importe);
  await tx((c) => cerrarReembolsoStripe(c, prep.reembolso_id, res));
  return { estado: res.ok ? 'emitido' : 'fallido', reembolso_id: prep.reembolso_id, metodo: 'stripe', error: res.ok ? undefined : res.error };
}

/**
 * Resolución con reembolso de una inscripción cancelada: devuelve cada pago aplicado a ella (Stripe por la API,
 * manuales como registro). Si todos salen bien, la resolución pasa a "reembolso"; si alguno falla, sigue pendiente.
 */
export async function resolverConReembolso(tx, inscripcionId, { motivo, creadoPor = 'sistema' }) {
  const pagos = await tx(async (c) => { await inscripcionPendiente(c, inscripcionId); return pagosDe(c, inscripcionId); });
  if (!pagos.length) throw err(400, 'No tiene pagos que devolver: resuélvela sin devolución.');
  const resultados = [];
  for (const p of pagos) {
    resultados.push({ pago: p.codigo, importe_cent: p.importe_cent, ...(await reembolsarPago(tx, p.id, { importe: p.importe_cent, motivo, inscripcionId, creadoPor })) });
  }
  const todos = resultados.every((r) => r.estado === 'emitido');
  if (todos) await tx((c) => c.query(`UPDATE inscripcion SET resolucion = 'reembolso' WHERE id = $1`, [inscripcionId]));
  return { resuelta: todos, resultados };
}

// ---------- Créditos ----------

/** Abono manual (fidelidad, compensación o ajuste) en el libro de créditos de una persona. */
export async function abonarCredito(c, personaId, { tipo, importe, motivo = null, caducaEn = null, creadoPor = 'sistema' }) {
  await c.query(`INSERT INTO movimiento_credito (persona_id, importe_cent, tipo, caduca_en, motivo, creado_por) VALUES ($1, $2, $3, $4, $5, $6)`,
    [personaId, importe, tipo, caducaEn, motivo, creadoPor]);
  return { saldo_cent: (await uno(c, 'SELECT credito_saldo_cent($1) AS s', [personaId])).s };
}

/** Canje: usa crédito de una persona para pagar parte de una inscripción (cuenta para su saldo). */
export async function canjearCredito(c, personaId, inscripcionId, importe, creadoPor = 'sistema') {
  const i = await uno(c, 'SELECT estado FROM inscripcion WHERE id = $1', [inscripcionId]);
  if (!i) throw err(404, 'No existe esa inscripción.');
  if (!ACTIVAS.includes(i.estado)) throw err(400, 'El crédito solo se canjea en inscripciones activas.');
  await c.query(`INSERT INTO movimiento_credito (persona_id, importe_cent, tipo, inscripcion_id, motivo, creado_por) VALUES ($1, $2, 'canje', $3, 'Canje', $4)`,
    [personaId, -importe, inscripcionId, creadoPor]);
  return { saldo_cent: (await uno(c, 'SELECT credito_saldo_cent($1) AS s', [personaId])).s };
}
