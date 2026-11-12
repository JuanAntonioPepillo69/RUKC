// Flujos de negocio que escriben en varias tablas a la vez. Todos reciben un cliente `c` dentro de una transacción
// (lib/db.js → conTransaccion) y no la abren ni la cierran.
// Diseño: docs/base-datos/diseno-v1.0.md, "Flujos" (F1 paso 6, F2 paso 3).
import { hashToken, nuevoToken } from './tokens.js';

const uno = async (c, texto, params) => (await c.query(texto, params)).rows[0];

/** "Carlos Martín Pérez" → { nombre: 'Carlos', apellidos: 'Martín Pérez' } */
export function partirNombre(completo) {
  const partes = String(completo || '').trim().split(/\s+/).filter(Boolean);
  return { nombre: partes[0] || 'Sin nombre', apellidos: partes.slice(1).join(' ') || null };
}

const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Busca una persona por teléfono y, si no, por email. Si no existe, la crea. Nunca sobrescribe datos de una
 * persona existente: si el nombre no coincide, deja una nota "Revisar posible duplicado" en su línea de tiempo.
 */
export async function buscarOCrearPersona(c, { nombreCompleto, telefono = null, email = null, origen = 'formulario_web', creadoPor = 'publico' }) {
  let p = telefono ? await uno(c, 'SELECT id, nombre, apellidos FROM persona WHERE telefono = $1', [telefono]) : null;
  if (!p && email) p = await uno(c, 'SELECT id, nombre, apellidos FROM persona WHERE email = $1', [email]);
  if (p) {
    const { nombre } = partirNombre(nombreCompleto);
    if (nombreCompleto && normal(p.nombre) !== normal(nombre)) {
      await c.query(
        `INSERT INTO interaccion (persona_id, tipo, resumen, ocurrida_en, creado_por)
         VALUES ($1, 'nota', $2, now(), 'sistema')`,
        [p.id, `Revisar posible duplicado: en el formulario escribió el nombre «${String(nombreCompleto).slice(0, 80)}».`]);
    }
    return { id: p.id, nueva: false };
  }
  const { nombre, apellidos } = partirNombre(nombreCompleto);
  const nueva = await uno(c,
    `INSERT INTO persona (nombre, apellidos, telefono, email, origen_alta, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [nombre, apellidos, telefono, email, origen, creadoPor]);
  return { id: nueva.id, nueva: true };
}

/** Lleva la oportunidad de la persona en la temporada a "ganada" (creándola si no existe). */
export async function ganarOportunidad(c, personaId, temporadaId, origen = 'formulario_web') {
  const o = await uno(c, 'SELECT id, etapa FROM oportunidad WHERE persona_id = $1 AND temporada_id = $2 FOR UPDATE', [personaId, temporadaId]);
  if (!o) {
    const nueva = await uno(c, `INSERT INTO oportunidad (persona_id, temporada_id, origen, creado_por)
      VALUES ($1, $2, $3, 'sistema') RETURNING id`, [personaId, temporadaId, origen]);
    await c.query(`UPDATE oportunidad SET etapa = 'ganada' WHERE id = $1`, [nueva.id]);
    return;
  }
  if (o.etapa === 'ganada') return;
  if (o.etapa === 'perdida' || o.etapa === 'sin_respuesta') {
    await c.query(`UPDATE oportunidad SET etapa = 'contactada', motivo_perdida = NULL WHERE id = $1`, [o.id]);
  }
  await c.query(`UPDATE oportunidad SET etapa = 'ganada' WHERE id = $1`, [o.id]);
}

/** Crea el onboarding pendiente del piloto en la temporada si aún no lo tiene (token nuevo; solo se guarda su hash). */
export async function asegurarOnboarding(c, personaId, temporadaId) {
  const existe = await uno(c, 'SELECT id FROM onboarding WHERE persona_id = $1 AND temporada_id = $2', [personaId, temporadaId]);
  if (existe) return existe.id;
  const o = await uno(c,
    `INSERT INTO onboarding (persona_id, temporada_id, token_hash, token_expira_en)
     SELECT $1, t.id, $3, coalesce((t.fin + 1)::timestamp AT TIME ZONE 'Europe/Madrid', now() + interval '1 year')
     FROM temporada t WHERE t.id = $2
     RETURNING id`,
    [personaId, temporadaId, hashToken(nuevoToken())]);
  return o.id;
}

/**
 * F1 paso 6 (y F2 paso 3): una solicitud del formulario ya cobrada se convierte en persona(s), oportunidad ganada,
 * pedido, inscripción, pago confirmado con su aplicación, onboarding pendiente y solicitud pagada.
 * `pago`: { metodo, importe_cent, stripe_payment_intent_id?, stripe_checkout_session_id?, referencia_externa?,
 *           confirmado_por ('stripe' | 'admin:<id>'), recibido_en? }
 * Devuelve { pagoId, inscripcionId, pedidoId, pagadorId, pilotoId, yaPagada }.
 */
export async function convertirSolicitud(c, solicitudId, pago) {
  const s = await uno(c, 'SELECT * FROM solicitud_inscripcion WHERE id = $1 FOR UPDATE', [solicitudId]);
  if (!s) throw new Error(`No existe la solicitud ${solicitudId}`);
  if (s.estado === 'pagada') return { yaPagada: true, pedidoId: s.pedido_id, pagadorId: s.persona_id };
  if (!['enviada', 'pago_abandonado'].includes(s.estado)) {
    throw new Error(`La solicitud ${s.codigo} está en ${s.estado}; no se puede marcar como pagada`);
  }

  const pagador = await buscarOCrearPersona(c, { nombreCompleto: s.pagador_nombre, telefono: s.pagador_telefono, email: s.pagador_email });
  const piloto = s.piloto_es_pagador ? pagador
    : await buscarOCrearPersona(c, { nombreCompleto: s.piloto_nombre, telefono: s.piloto_telefono });

  await c.query('UPDATE atribucion SET persona_id = $1 WHERE solicitud_id = $2 AND persona_id IS NULL', [pagador.id, s.id]);
  await ganarOportunidad(c, pagador.id, s.temporada_id);

  const producto = await uno(c,
    `SELECT id, precio_vigente_cent(id) AS precio FROM producto
     WHERE temporada_id = $1 AND codigo = 'carrera_suelta' AND activo`, [s.temporada_id]);
  if (!producto?.precio) throw new Error('No hay precio vigente de carrera suelta');
  const categoria = ['LIG', 'PES'].includes(s.categoria_elegida)
    ? await uno(c, 'SELECT id FROM categoria WHERE temporada_id = $1 AND codigo = $2', [s.temporada_id, s.categoria_elegida])
    : null;

  // Si el piloto ya tiene una inscripción activa en esa ronda y categoría, el pago va a ella (no se duplica).
  let insc = await uno(c,
    `SELECT id, pedido_id FROM inscripcion
     WHERE piloto_persona_id = $1 AND ronda_id = $2 AND categoria_id IS NOT DISTINCT FROM $3
       AND estado NOT IN ('trasladada', 'cancelada') LIMIT 1`, [piloto.id, s.ronda_id, categoria?.id ?? null]);
  let pedidoId;
  if (insc) {
    pedidoId = insc.pedido_id;
    await c.query(`INSERT INTO interaccion (persona_id, tipo, resumen, ocurrida_en, creado_por)
      VALUES ($1, 'nota', $2, now(), 'sistema')`,
      [pagador.id, `La solicitud ${s.codigo} se ha pagado sobre una inscripción que ya existía: revisar si es un pago repetido.`]);
  } else {
    pedidoId = (await uno(c,
      `INSERT INTO pedido (temporada_id, pagador_persona_id, origen, solicitud_id, subtotal_cent, total_cent, creado_por)
       VALUES ($1, $2, 'web', $3, $4, $4, 'publico') RETURNING id`,
      [s.temporada_id, pagador.id, s.id, producto.precio])).id;
    insc = await uno(c,
      `INSERT INTO inscripcion (pedido_id, piloto_persona_id, ronda_id, producto_id, precio_cent, categoria_id, categoria_origen, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'publico') RETURNING id`,
      [pedidoId, piloto.id, s.ronda_id, producto.id, producto.precio, categoria?.id ?? null, categoria ? 'por_peso' : 'pendiente']);
  }

  const entidad = await uno(c, 'SELECT id FROM entidad_cobradora WHERE activa_hasta IS NULL');
  if (!entidad) throw new Error('No hay entidad cobradora activa');
  const p = await uno(c,
    `INSERT INTO pago (pagador_persona_id, entidad_cobradora_id, metodo, importe_cent, estado, recibido_en, confirmado_en,
       confirmado_por, stripe_payment_intent_id, stripe_checkout_session_id, referencia_externa, creado_por)
     VALUES ($1, $2, $3, $4, 'confirmado', coalesce($5::timestamptz, now()), now(), $6, $7, $8, $9, 'sistema') RETURNING id`,
    [pagador.id, entidad.id, pago.metodo, pago.importe_cent, pago.recibido_en ?? null, pago.confirmado_por,
      pago.stripe_payment_intent_id ?? null, pago.stripe_checkout_session_id ?? null, pago.referencia_externa ?? s.codigo]);

  const hueco = (await uno(c, 'SELECT precio_cent - inscripcion_comprometido_cent(id) AS hueco FROM inscripcion WHERE id = $1', [insc.id])).hueco;
  const aplicar = Math.min(pago.importe_cent, Math.max(0, hueco));
  if (aplicar > 0) {
    await c.query(`INSERT INTO aplicacion_pago (pago_id, inscripcion_id, importe_cent, creado_por) VALUES ($1, $2, $3, 'sistema')`,
      [p.id, insc.id, aplicar]);
  }

  // Formulario v2: si el piloto es menor, la inscripción lo indica y queda registrada la tutela con su tutor, que es
  // quien recibe los mensajes (confirmación de plaza, recordatorios).
  if (s.piloto_menor && s.tutor_telefono) {
    await c.query('UPDATE inscripcion SET es_menor = true, tutor_nombre = $2 WHERE id = $1', [insc.id, s.tutor_nombre ?? null]);
    const tutor = s.tutor_telefono === s.pagador_telefono ? pagador
      : await buscarOCrearPersona(c, { nombreCompleto: s.tutor_nombre, telefono: s.tutor_telefono });
    if (tutor.id !== piloto.id) {
      await c.query(
        `INSERT INTO tutela (menor_persona_id, tutor_persona_id, relacion, creado_por) VALUES ($1, $2, $3, 'publico')
         ON CONFLICT (menor_persona_id, tutor_persona_id) DO NOTHING`, [piloto.id, tutor.id, s.tutor_relacion ?? 'tutor_legal']);
    }
  }

  await asegurarOnboarding(c, piloto.id, s.temporada_id);

  if (s.acepta_comunicaciones) {
    await c.query(`INSERT INTO consentimiento (persona_id, finalidad, otorgado, origen) VALUES ($1, 'comunicaciones_comerciales', true, 'formulario_web')`, [pagador.id]);
  }
  if (s.consentimiento_medicion) {
    await c.query(`INSERT INTO consentimiento (persona_id, finalidad, otorgado, origen) VALUES ($1, 'medicion_anuncios', true, 'formulario_web')`, [pagador.id]);
  }

  await c.query(`UPDATE solicitud_inscripcion SET estado = 'pagada', persona_id = $2, pedido_id = $3 WHERE id = $1`,
    [s.id, pagador.id, pedidoId]);

  return { yaPagada: false, pagoId: p.id, inscripcionId: insc.id, pedidoId, pagadorId: pagador.id, pilotoId: piloto.id, sinAplicar: pago.importe_cent - aplicar };
}

/** Pago asíncrono de Stripe rechazado: registra el pago fallido y la solicitud pasa a pago_abandonado. */
export async function registrarPagoFallido(c, solicitudId, pago) {
  const s = await uno(c, 'SELECT * FROM solicitud_inscripcion WHERE id = $1 FOR UPDATE', [solicitudId]);
  if (!s || s.estado === 'pagada') return null;
  const pagador = await buscarOCrearPersona(c, { nombreCompleto: s.pagador_nombre, telefono: s.pagador_telefono, email: s.pagador_email });
  const entidad = await uno(c, 'SELECT id FROM entidad_cobradora WHERE activa_hasta IS NULL');
  const p = await uno(c,
    `INSERT INTO pago (pagador_persona_id, entidad_cobradora_id, metodo, importe_cent, estado, recibido_en,
       stripe_payment_intent_id, stripe_checkout_session_id, referencia_externa, creado_por)
     VALUES ($1, $2, $3, $4, 'fallido', now(), $5, $6, $7, 'sistema')
     ON CONFLICT (stripe_payment_intent_id) DO NOTHING RETURNING id`,
    [pagador.id, entidad.id, pago.metodo, pago.importe_cent, pago.stripe_payment_intent_id ?? null,
      pago.stripe_checkout_session_id ?? null, s.codigo]);
  if (s.estado === 'enviada') {
    await c.query(`UPDATE solicitud_inscripcion SET estado = 'pago_abandonado', persona_id = coalesce(persona_id, $2) WHERE id = $1`, [s.id, pagador.id]);
  }
  return p?.id ?? null;
}
