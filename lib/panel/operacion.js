// Panel de la fase 6: traslados (F7), cancelación de una ronda o de una inscripción y su resolución (F8),
// reembolsos (Stripe por la API; el resto, registro manual) y créditos (abonos y canjes desde la ficha).
import { ErrorPanel } from '../admin.js';
import * as D from '../dinero.js';
import * as V from '../validacion/panel.js';

const val = (esquema, datos) => V.validar(esquema, datos, ErrorPanel);
const uno = async (c, t, p) => (await c.query(t, p)).rows[0];
const filas = async (c, t, p) => (await c.query(t, p)).rows;
const euros = (cent) => `${(cent / 100).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

/** Rondas a las que se puede trasladar una inscripción (misma temporada, programadas o aplazadas, distinta ronda). */
export async function destinos({ params, tx }) {
  return tx(async (c) => ({
    rondas: await filas(c, `SELECT r.id, r.numero, r.fecha::text AS fecha, ci.nombre AS circuito FROM inscripcion i
      JOIN ronda o ON o.id = i.ronda_id JOIN ronda r ON r.temporada_id = o.temporada_id AND r.id <> o.id AND r.estado IN ('programada', 'aplazada')
      JOIN circuito ci ON ci.id = r.circuito_id WHERE i.id = $1 ORDER BY r.fecha`, [params.id]),
    aviso_dias: (await uno(c, `SELECT t.dias_aviso_traslado AS d FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id JOIN temporada t ON t.id = r.temporada_id WHERE i.id = $1`, [params.id]))?.d ?? null,
  }));
}

export async function trasladar({ params, body, tx, actor }) {
  const d = val(V.trasladar, body);
  const r = await tx((c) => D.trasladar(c, params.id, { rondaDestinoId: d.ronda_id, aviso: d.aviso ? `${d.aviso}T12:00:00+01:00` : null, motivo: d.motivo, creadoPor: actor }));
  return { ...r, aviso: r.destino.sobrecupo ? 'La categoría de la ronda destino estaba llena: la inscripción queda en sobrecupo.' : null };
}

export async function cancelarInscripcion({ params, body, tx }) {
  const { motivo } = val(V.motivoCancelar, body);
  await tx((c) => D.cancelarInscripcion(c, params.id, motivo));
  return { ok: true };
}

export async function cancelarRonda({ params, body, tx }) {
  const { motivo } = val(V.motivoCancelar, body);
  return tx((c) => D.cancelarRonda(c, params.id, motivo));
}

/** Inscripciones canceladas de una ronda, con lo que pagó cada una y por qué vía, para resolverlas una a una. */
export async function canceladas({ params, tx }) {
  return tx(async (c) => {
    const lista = await filas(c, `SELECT i.id, i.codigo, i.resolucion, i.motivo, btrim(p.nombre || ' ' || coalesce(p.apellidos, '')) AS piloto, p.telefono,
        inscripcion_pagado_cent(i.id) AS pagado_cent, inscripcion_credito_cent(i.id) AS credito_cent
      FROM inscripcion i JOIN persona p ON p.id = i.piloto_persona_id WHERE i.ronda_id = $1 AND i.estado = 'cancelada' ORDER BY i.resolucion = 'pendiente' DESC, piloto`, [params.id]);
    for (const i of lista) i.pagos = (await D.pagosDe(c, i.id)).map((p) => ({ codigo: p.codigo, metodo: p.metodo, importe_cent: p.importe_cent, stripe: Boolean(p.stripe_payment_intent_id) }));
    return { inscripciones: lista };
  });
}

/** F8: reembolso, crédito, traslado o sin devolución para una inscripción cancelada. */
export async function resolver({ params, body, tx, actor }) {
  const d = val(V.resolver, body);
  switch (d.resolucion) {
    case 'reembolso': {
      const r = await D.resolverConReembolso(tx, params.id, { motivo: d.motivo || 'Cancelación', creadoPor: actor });
      if (!r.resuelta) throw new ErrorPanel(502, `No se ha podido devolver todo: ${r.resultados.filter((x) => x.estado !== 'emitido').map((x) => `${x.pago} (${x.error})`).join('; ')}. La resolución sigue pendiente.`, { resultados: r.resultados });
      return r;
    }
    case 'credito': return tx((c) => D.resolverConCredito(c, params.id, { caducaEn: d.caduca_en ?? null, creadoPor: actor }));
    case 'traslado':
      if (!d.ronda_id) throw new ErrorPanel(400, 'Elige la ronda destino.');
      return tx((c) => D.trasladar(c, params.id, { rondaDestinoId: d.ronda_id, motivo: d.motivo, creadoPor: actor }));
    default: await tx((c) => D.resolverSinDevolucion(c, params.id)); return { ok: true };
  }
}

/** Reembolso de un pago (Ventas y pagos): primero libera lo aplicado y luego devuelve (Stripe o manual). */
export async function reembolsarPago({ params, body, tx, actor }) {
  const d = val(V.reembolsar, body);
  const r = await D.reembolsarPago(tx, params.id, { importe: d.importe_cent, motivo: d.motivo, creadoPor: actor });
  if (r.estado !== 'emitido') throw new ErrorPanel(502, `Stripe no ha hecho el reembolso: ${r.error}. Lo aplicado se ha liberado; puedes volver a intentarlo.`);
  return { ...r, aviso: r.metodo === 'manual' ? `Registrado. Recuerda devolver ${euros(d.importe_cent)} por el mismo medio por el que pagó.` : null };
}

export async function creditos({ params, tx }) {
  return tx(async (c) => ({
    saldo_cent: (await uno(c, 'SELECT credito_saldo_cent($1) AS s', [params.id])).s,
    movimientos: await filas(c, `SELECT m.id, m.creado_en, m.tipo, m.importe_cent, m.motivo, m.caduca_en, i.codigo AS inscripcion
      FROM movimiento_credito m LEFT JOIN inscripcion i ON i.id = m.inscripcion_id WHERE m.persona_id = $1 ORDER BY m.creado_en DESC`, [params.id]),
    // Donde puede canjear: inscripciones activas suyas (como piloto o como pagador) con saldo pendiente.
    canjeables: await filas(c, `SELECT DISTINCT i.id, i.codigo, inscripcion_saldo_cent(i.id) AS saldo_cent FROM inscripcion i JOIN pedido pe ON pe.id = i.pedido_id
      WHERE (i.piloto_persona_id = $1 OR pe.pagador_persona_id = $1) AND i.estado IN ('pendiente_pago', 'reservada', 'pagada') AND inscripcion_saldo_cent(i.id) > 0`, [params.id]),
  }));
}

export async function abonar({ params, body, tx, actor }) {
  const d = val(V.abono, body);
  if (d.tipo !== 'ajuste' && d.importe_cent < 0) throw new ErrorPanel(400, 'Un abono es positivo; para restar usa un ajuste con motivo.');
  if (d.tipo === 'ajuste' && !d.motivo) throw new ErrorPanel(400, 'Un ajuste necesita motivo.');
  return tx((c) => D.abonarCredito(c, params.id, { tipo: d.tipo, importe: d.importe_cent, motivo: d.motivo, caducaEn: d.caduca_en ?? null, creadoPor: actor }));
}

export async function canjear({ params, body, tx, actor }) {
  const d = val(V.canje, body);
  return tx((c) => D.canjearCredito(c, params.id, d.inscripcion_id, d.importe_cent, actor));
}
