// Ventas y pagos del panel (F4), confirmación de Bizum (F2 paso 3), facturas y cobro en el circuito.
import { ErrorPanel } from '../admin.js';
import { asegurarOnboarding, buscarOCrearPersona, convertirSolicitud, ganarOportunidad } from '../flujos.js';
import * as V from '../validacion/panel.js';

const val = (esquema, datos) => V.validar(esquema, datos, ErrorPanel);
const uno = async (c, t, p) => (await c.query(t, p)).rows[0];
const filas = async (c, t, p) => (await c.query(t, p)).rows;

async function temporadaVigente(c) {
  const t = await uno(c, `SELECT id, codigo, importe_reserva_cent FROM temporada WHERE estado IN ('abierta', 'en_curso') ORDER BY inicio DESC NULLS LAST LIMIT 1`);
  if (!t) throw new ErrorPanel(409, 'No hay ninguna temporada abierta.');
  return t;
}
const rondasPendientes = (c, temporadaId) => filas(c,
  `SELECT id, numero, fecha::text AS fecha FROM ronda WHERE temporada_id = $1 AND estado IN ('programada', 'aplazada')
   AND fecha >= (now() AT TIME ZONE 'Europe/Madrid')::date ORDER BY fecha`, [temporadaId]);

async function personaDe(c, ref, actor) {
  if (ref.persona_id) {
    const p = await uno(c, `SELECT id FROM persona WHERE id = $1 AND estado = 'activa'`, [ref.persona_id]);
    if (!p) throw new ErrorPanel(404, 'No existe esa persona.');
    return p.id;
  }
  return (await buscarOCrearPersona(c, { nombreCompleto: ref.nombre, telefono: ref.telefono, email: ref.email, origen: 'alta_manual', creadoPor: actor })).id;
}

/** Reparte `total` entre n partes; la última absorbe el redondeo. */
export const repartir = (total, n) => Array.from({ length: n }, (_, i) => (i < n - 1 ? Math.floor(total / n) : total - Math.floor(total / n) * (n - 1)));

/** Aplica un pago a las inscripciones dadas (ya ordenadas por fecha de ronda) hasta cubrir su hueco. Devuelve lo aplicado. */
async function aplicarPago(c, pagoId, importe, inscripciones, actor) {
  let queda = importe;
  for (const id of inscripciones) {
    if (queda <= 0) break;
    const { hueco } = await uno(c, 'SELECT precio_cent - inscripcion_comprometido_cent(id) AS hueco FROM inscripcion WHERE id = $1', [id]);
    const parte = Math.min(queda, hueco);
    if (parte > 0) {
      await c.query('INSERT INTO aplicacion_pago (pago_id, inscripcion_id, importe_cent, creado_por) VALUES ($1, $2, $3, $4)', [pagoId, id, parte, actor]);
      queda -= parte;
    }
  }
  return importe - queda;
}

async function insertarPago(c, { pagador, entidad, p, actor, referencia, rondaId = null }) {
  return (await uno(c,
    `INSERT INTO pago (pagador_persona_id, entidad_cobradora_id, metodo, importe_cent, estado, recibido_en, confirmado_por, cobrado_por,
       referencia_externa, ronda_id, creado_por)
     VALUES ($1, $2, $3, $4, $5, coalesce(($6::date + time '12:00') AT TIME ZONE 'Europe/Madrid', now()), $7, $8, $9, $10, $11) RETURNING id, codigo`,
    [pagador, entidad, p.metodo, p.importe_cent, p.verificado ? 'confirmado' : 'pendiente_verificacion', p.fecha ?? null,
      p.verificado ? actor : null, p.cobrado_por ?? null, p.referencia ?? referencia, rondaId, actor]));
}

/** Tras un cobro confirmado: oportunidad del pagador ganada y onboarding pendiente para cada piloto con algo pagado. */
async function trasCobro(c, pagadorId, temporadaId) {
  await ganarOportunidad(c, pagadorId, temporadaId, 'alta_manual');
  const pilotos = await filas(c, `SELECT DISTINCT i.piloto_persona_id FROM inscripcion i JOIN pedido pe ON pe.id = i.pedido_id
    WHERE pe.pagador_persona_id = $1 AND pe.temporada_id = $2 AND i.estado IN ('reservada', 'pagada')`, [pagadorId, temporadaId]);
  for (const { piloto_persona_id } of pilotos) await asegurarOnboarding(c, piloto_persona_id, temporadaId);
}

const resumenPedido = (c, pedidoId) => filas(c,
  `SELECT vi.id, vi.codigo, vi.piloto, vi.ronda, vi.categoria, vi.precio_cent, vi.pagado_cent, vi.saldo_cent, vi.estado
   FROM v_inscripciones vi JOIN inscripcion i ON i.id = vi.id WHERE i.pedido_id = $1 ORDER BY vi.ronda_fecha`, [pedidoId]);

/** Datos para el formulario de nueva venta. */
export async function catalogoVenta({ tx }) {
  return tx(async (c) => {
    const t = await temporadaVigente(c);
    return {
      temporada: t.codigo,
      productos: await filas(c, `SELECT codigo, rondas_incluidas, precio_vigente_cent(id) AS precio_cent FROM producto WHERE temporada_id = $1 AND activo ORDER BY codigo`, [t.id]),
      rondas: (await rondasPendientes(c, t.id)).map((r) => ({ ...r })),
      categorias: await filas(c, 'SELECT codigo, nombre FROM categoria WHERE temporada_id = $1 ORDER BY orden', [t.id]),
    };
  });
}

/**
 * F4 · Nueva venta: pagador (existente o nuevo), líneas piloto × producto, descuento opcional y pagos.
 * Carrera suelta pide la ronda; temporada crea una inscripción por cada ronda pendiente con el precio repartido.
 * Los pagos se aplican solos por orden de fecha de ronda. Efectivo y transferencia vista: confirmado; Bizum o
 * transferencia sin ver: pendiente de verificación (cuando se confirme, las inscripciones cambian de estado solas).
 */
export async function nuevaVenta({ body, tx, admin, actor }) {
  const d = val(V.nuevaVenta, body);
  return tx(async (c) => {
    const t = await temporadaVigente(c);
    const pagador = await personaDe(c, d.pagador, actor);
    const productos = Object.fromEntries((await filas(c, 'SELECT id, codigo, precio_vigente_cent(id) AS precio FROM producto WHERE temporada_id = $1 AND activo', [t.id]))
      .map((p) => [p.codigo, p]));
    const pendientes = await rondasPendientes(c, t.id);
    const cats = Object.fromEntries((await filas(c, 'SELECT id, codigo FROM categoria WHERE temporada_id = $1', [t.id])).map((x) => [x.codigo, x.id]));

    const items = [];
    for (const l of d.lineas) {
      const prod = productos[l.producto];
      if (!prod?.precio) throw new ErrorPanel(400, `El producto ${l.producto} no tiene precio vigente.`);
      const piloto = l.piloto === 'pagador' ? pagador : await personaDe(c, l.piloto, actor);
      let rondas;
      if (l.producto === 'carrera_suelta') {
        const r = pendientes.find((x) => x.id === l.ronda_id);
        if (!r) throw new ErrorPanel(400, 'Elige una ronda por celebrar para la carrera suelta.');
        rondas = [r];
      } else {
        if (!pendientes.length) throw new ErrorPanel(400, 'No quedan rondas por celebrar.');
        rondas = pendientes;
      }
      const precios = repartir(prod.precio, rondas.length);
      rondas.forEach((r, i) => items.push({ piloto, producto: prod.id, ronda: r, precio: precios[i], categoria: l.categoria ? cats[l.categoria] : null }));
    }
    const subtotal = items.reduce((s, x) => s + x.precio, 0);

    let descuento = 0, codigoId = null;
    if (d.descuento?.tipo === 'codigo') {
      const cd = await uno(c, `SELECT * FROM codigo_descuento WHERE codigo = upper($1) AND activo
        AND (valido_desde IS NULL OR valido_desde <= now()) AND (valido_hasta IS NULL OR valido_hasta > now())`, [d.descuento.codigo]);
      if (!cd) throw new ErrorPanel(400, 'Ese código de descuento no existe o no está vigente.');
      if (cd.productos && d.lineas.some((l) => !cd.productos.includes(l.producto))) throw new ErrorPanel(400, 'El código no vale para alguno de los productos.');
      if (cd.usos_maximos && (await uno(c, 'SELECT count(*)::int AS n FROM pedido WHERE codigo_descuento_id = $1', [cd.id])).n >= cd.usos_maximos) {
        throw new ErrorPanel(400, 'El código ya se ha usado todas las veces permitidas.');
      }
      descuento = cd.tipo === 'porcentaje' ? Math.round((subtotal * cd.valor) / 100) : Math.min(cd.valor, subtotal);
      codigoId = cd.id;
    } else if (d.descuento?.tipo === 'manual') {
      descuento = Math.min(d.descuento.importe_cent, subtotal);
      await c.query(`INSERT INTO interaccion (persona_id, tipo, resumen, ocurrida_en, admin_id, creado_por) VALUES ($1, 'nota', $2, now(), $3, $4)`,
        [pagador, `Descuento manual de ${(descuento / 100).toFixed(2)} € en una venta: ${d.descuento.motivo}`, admin.id, actor]);
    }
    // El descuento se reparte entre las inscripciones en proporción a su precio (la última absorbe el redondeo).
    let repartido = 0;
    items.forEach((x, i) => {
      const parte = i < items.length - 1 ? Math.floor((descuento * x.precio) / subtotal) : descuento - repartido;
      repartido += parte;
      x.precio -= parte;
    });

    const pedido = await uno(c, `INSERT INTO pedido (temporada_id, pagador_persona_id, origen, codigo_descuento_id, subtotal_cent, descuento_cent, total_cent, creado_por)
      VALUES ($1, $2, 'manual', $3, $4, $5, $6, $7) RETURNING id, codigo`, [t.id, pagador, codigoId, subtotal, descuento, subtotal - descuento, actor]);
    const inscripciones = [];
    for (const x of items.sort((a, b) => a.ronda.fecha.localeCompare(b.ronda.fecha))) {
      inscripciones.push((await uno(c, `INSERT INTO inscripcion (pedido_id, piloto_persona_id, ronda_id, producto_id, precio_cent, categoria_id, categoria_origen, creado_por)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [pedido.id, x.piloto, x.ronda.id, x.producto, x.precio, x.categoria, x.categoria ? 'por_peso' : 'pendiente', actor])).id);
    }

    const entidad = (await uno(c, 'SELECT id FROM entidad_cobradora WHERE activa_hasta IS NULL'))?.id;
    if (d.pagos.length && !entidad) throw new ErrorPanel(409, 'No hay entidad cobradora activa (Ajustes).');
    let confirmado = false;
    // El dinero confirmado cubre primero las rondas más próximas; lo pendiente de verificar va detrás.
    for (const p of [...d.pagos].sort((a, b) => Number(b.verificado) - Number(a.verificado))) {
      const pg = await insertarPago(c, { pagador, entidad, p, actor, referencia: pedido.codigo });
      await aplicarPago(c, pg.id, p.importe_cent, inscripciones, actor);
      confirmado ||= p.verificado;
    }
    if (confirmado) await trasCobro(c, pagador, t.id);
    return { pedido_id: pedido.id, codigo: pedido.codigo, total_cent: subtotal - descuento, inscripciones: await resumenPedido(c, pedido.id) };
  });
}

/** Pedidos de una persona (como pagadora) con lo que queda por pagar, para registrar un pago más. */
export async function pedidosDe({ url, tx }) {
  const persona = url.searchParams.get('persona');
  if (!/^[0-9a-f-]{36}$/.test(persona || '')) throw new ErrorPanel(400, 'Falta la persona.');
  return tx(async (c) => ({ pedidos: await filas(c,
    `SELECT pe.id, pe.codigo, pe.estado, pe.total_cent,
       (SELECT coalesce(sum(inscripcion_saldo_cent(i.id)), 0)::int FROM inscripcion i WHERE i.pedido_id = pe.id AND i.estado IN ('pendiente_pago', 'reservada')) AS saldo_cent,
       (SELECT string_agg(i.codigo, ', ' ORDER BY i.codigo) FROM inscripcion i WHERE i.pedido_id = pe.id) AS inscripciones
     FROM pedido pe WHERE pe.pagador_persona_id = $1 ORDER BY pe.creado_en DESC`, [persona]) }));
}

/** Registrar un pago más de un pedido existente; se aplica por orden de fecha de ronda. */
export async function registrarPago({ body, tx, actor }) {
  const d = val(V.registrarPago, body);
  return tx(async (c) => {
    const pedido = await uno(c, 'SELECT id, codigo, pagador_persona_id, temporada_id FROM pedido WHERE id = $1', [d.pedido_id]);
    if (!pedido) throw new ErrorPanel(404, 'No existe ese pedido.');
    const entidad = (await uno(c, 'SELECT id FROM entidad_cobradora WHERE activa_hasta IS NULL'))?.id;
    const insc = (await filas(c, `SELECT i.id FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id WHERE i.pedido_id = $1
      AND i.estado IN ('pendiente_pago', 'reservada', 'pagada') ORDER BY r.fecha`, [pedido.id])).map((x) => x.id);
    const pg = await insertarPago(c, { pagador: pedido.pagador_persona_id, entidad, p: d, actor, referencia: pedido.codigo });
    const aplicado = await aplicarPago(c, pg.id, d.importe_cent, insc, actor);
    if (d.verificado) await trasCobro(c, pedido.pagador_persona_id, pedido.temporada_id);
    return { pago: pg.codigo, aplicado_cent: aplicado, sin_aplicar_cent: d.importe_cent - aplicado, inscripciones: await resumenPedido(c, pedido.id) };
  });
}

/** El dinero de un Bizum o transferencia ha llegado: el pago pasa a confirmado y sus inscripciones se recalculan solas. */
export async function confirmarPago({ params, tx, actor }) {
  return tx(async (c) => {
    const p = await uno(c, `UPDATE pago SET estado = 'confirmado', confirmado_por = $2 WHERE id = $1 AND estado = 'pendiente_verificacion'
      RETURNING pagador_persona_id`, [params.id, actor]);
    if (!p) throw new ErrorPanel(409, 'Ese pago no está pendiente de verificar.');
    const temporadas = await filas(c, `SELECT DISTINCT r.temporada_id FROM aplicacion_pago a JOIN inscripcion i ON i.id = a.inscripcion_id
      JOIN ronda r ON r.id = i.ronda_id WHERE a.pago_id = $1`, [params.id]);
    for (const { temporada_id } of temporadas) await trasCobro(c, p.pagador_persona_id, temporada_id);
    return { ok: true };
  });
}

/** El dinero no llegó: el pago pasa a fallido (deja de contar) y queda una nota con el motivo. */
export async function rechazarPago({ params, body, tx, admin, actor }) {
  const d = val(V.rechazar, body);
  return tx(async (c) => {
    const p = await uno(c, `UPDATE pago SET estado = 'fallido' WHERE id = $1 AND estado = 'pendiente_verificacion' RETURNING pagador_persona_id, codigo`, [params.id]);
    if (!p) throw new ErrorPanel(409, 'Ese pago no está pendiente de verificar.');
    await c.query(`INSERT INTO interaccion (persona_id, tipo, resumen, ocurrida_en, admin_id, creado_por) VALUES ($1, 'nota', $2, now(), $3, $4)`,
      [p.pagador_persona_id, `Pago ${p.codigo} rechazado: ${d.motivo ?? 'no llegó el dinero'}`, admin.id, actor]);
    return { ok: true };
  });
}

export async function anotarFactura({ params, body, tx }) {
  const d = val(V.factura, body);
  const r = await tx((c) => c.query('UPDATE pago SET factura_ref = $2 WHERE id = $1', [params.id, d.factura_ref]));
  if (!r.rowCount) throw new ErrorPanel(404, 'No existe ese pago.');
  return { ok: true };
}

/** F2 paso 3: Bizum de la web comprobado en el banco → misma conversión que el webhook de Stripe, con pago bizum_manual. */
export async function confirmarBizumWeb({ params, tx, actor }) {
  return tx(async (c) => {
    const s = await uno(c, `SELECT s.codigo, s.estado, s.metodo_elegido, t.importe_reserva_cent FROM solicitud_inscripcion s
      JOIN temporada t ON t.id = s.temporada_id WHERE s.id = $1`, [params.id]);
    if (!s) throw new ErrorPanel(404, 'No existe esa solicitud.');
    if (!['enviada', 'pago_abandonado'].includes(s.estado)) throw new ErrorPanel(409, `La solicitud está ${s.estado}.`);
    const r = await convertirSolicitud(c, params.id, { metodo: 'bizum_manual', importe_cent: s.importe_reserva_cent, confirmado_por: actor, referencia_externa: s.codigo });
    return { ok: true, ...r, inscripciones: await resumenPedido(c, r.pedidoId) };
  });
}

export async function rechazarBizumWeb({ params, tx }) {
  const r = await tx((c) => c.query(`UPDATE solicitud_inscripcion SET estado = 'pago_abandonado' WHERE id = $1 AND estado = 'enviada'`, [params.id]));
  if (!r.rowCount) throw new ErrorPanel(409, 'Esa solicitud no está esperando un Bizum.');
  return { ok: true };
}

/** Inscritos de una ronda con saldo pendiente (para cobrar en el circuito). */
export async function pendientesDeCobro({ params, tx }) {
  return tx(async (c) => ({ inscripciones: await filas(c,
    `SELECT vi.id, vi.codigo, vi.piloto, vi.dorsal, vi.categoria, vi.precio_cent, vi.pagado_cent, vi.saldo_cent, vi.estado
     FROM v_inscripciones vi JOIN inscripcion i ON i.id = vi.id
     WHERE i.ronda_id = $1 AND vi.saldo_cent > 0 AND vi.estado IN ('pendiente_pago', 'reservada') ORDER BY vi.categoria, vi.piloto`, [params.id]) }));
}

/** Cobro en el circuito en un toque: por defecto, el saldo entero en efectivo, cobrado por quien usa el panel. */
export async function cobroEnCircuito({ params, body, tx, admin, actor }) {
  const d = val(V.cobro, body);
  return tx(async (c) => {
    const i = await uno(c, `SELECT i.id, i.piloto_persona_id, r.temporada_id, inscripcion_saldo_cent(i.id) AS saldo
      FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id WHERE i.id = $1 AND i.ronda_id = $2 AND i.estado IN ('pendiente_pago', 'reservada')`,
      [d.inscripcion_id, params.id]);
    if (!i) throw new ErrorPanel(404, 'Esa inscripción no tiene nada pendiente en esta ronda.');
    const importe = d.importe_cent ?? i.saldo;
    if (importe <= 0 || importe > i.saldo) throw new ErrorPanel(400, `El importe tiene que estar entre 0,01 y ${(i.saldo / 100).toFixed(2)} €.`);
    const entidad = (await uno(c, 'SELECT id FROM entidad_cobradora WHERE activa_hasta IS NULL'))?.id;
    const pg = await insertarPago(c, { pagador: i.piloto_persona_id, entidad, actor, rondaId: params.id,
      p: { metodo: d.metodo, importe_cent: importe, verificado: true, cobrado_por: admin.nombre, referencia: 'Cobro en circuito' } });
    await aplicarPago(c, pg.id, importe, [i.id], actor);
    await trasCobro(c, i.piloto_persona_id, i.temporada_id);
    return { ok: true, pago: pg.codigo, inscripcion: (await uno(c, 'SELECT estado, saldo_cent FROM v_inscripciones WHERE id = $1', [i.id])) };
  });
}
