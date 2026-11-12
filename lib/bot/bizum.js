// Bizum por WhatsApp (fase 2; especificación 3a, B2 a B4).
// - B2: llega una imagen o un PDF de un contacto con una reserva por Bizum pendiente → se le contesta "Recibido" y a
//   John le llega el aviso con el código para confirmarlo (propuesta confirmar_bizum en admin_actions).
// - B3: John responde CONFIRMO <código> → la solicitud se convierte en reserva (como al confirmar el Bizum en el panel)
//   y sale la confirmación de plaza por WhatsApp (B1).
// - B4: 24 h después de elegir Bizum sin que se haya confirmado, recordatorio rukc_bizum_pendiente, una sola vez,
//   de 9:30 a 21:30 y solo si la inscripción de esa ronda sigue abierta.
import { conTransaccion, consulta } from '../db.js';
import { convertirSolicitud } from '../flujos.js';
import { martesAnterior } from './datos.js';

const uno = async (t, p) => (await consulta(t, p))[0] ?? null;
const pila = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const fechaLarga = (iso) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' })
  .format(new Date(`${iso}T12:00:00Z`));
const euros = (cent) => { const v = Number(cent) / 100; return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ','); };

export const ACUSE_JUSTIFICANTE = 'Recibido, gracias. El equipo comprueba el Bizum y en cuanto llegue te confirmamos la plaza por aquí.';

const CONSULTA_PENDIENTES = `
  SELECT s.id, s.codigo, s.enviada_en, s.pagador_nombre, s.pagador_telefono, s.piloto_nombre, s.piloto_telefono, s.piloto_es_pagador,
         r.numero, r.fecha::text AS fecha, c.nombre AS circuito, t.importe_reserva_cent
  FROM solicitud_inscripcion s
  JOIN ronda r ON r.id = s.ronda_id JOIN circuito c ON c.id = r.circuito_id JOIN temporada t ON t.id = s.temporada_id
  WHERE s.estado = 'enviada' AND s.metodo_elegido = 'bizum'`;

/** Reservas por Bizum sin confirmar de un teléfono (como pagador o como piloto), la más reciente primero. */
export async function bizumPendientesDe(telefono) {
  return consulta(`${CONSULTA_PENDIENTES} AND (s.pagador_telefono = $1 OR s.piloto_telefono = $1) ORDER BY s.enviada_en DESC`, [telefono]);
}

/** Todas las pendientes, o las que casen con un código, nombre o teléfono. */
export async function buscarBizumPendientes(texto = null) {
  const t = String(texto ?? '').trim();
  if (!t) return consulta(`${CONSULTA_PENDIENTES} ORDER BY s.enviada_en DESC LIMIT 20`);
  const digitos = t.replace(/\D/g, '');
  return consulta(
    `${CONSULTA_PENDIENTES} AND (s.codigo ILIKE $1 OR s.pagador_nombre ILIKE $2 OR s.piloto_nombre ILIKE $2
       OR ($3 <> '' AND (s.pagador_telefono LIKE '%' || $3 || '%' OR s.piloto_telefono LIKE '%' || $3 || '%')))
     ORDER BY s.enviada_en DESC LIMIT 20`, [t, `%${t}%`, digitos.length >= 4 ? digitos : '']);
}

/** Parámetros de la propuesta confirmar_bizum a partir de una solicitud pendiente. */
export function parametrosBizum(s) {
  return {
    solicitud_id: s.id, codigo_reserva: s.codigo, nombre: s.pagador_nombre, telefono: s.pagador_telefono,
    piloto: s.piloto_es_pagador ? null : s.piloto_nombre, ronda: `R${s.numero}`, fecha: fechaLarga(s.fecha), circuito: s.circuito,
    importe_cent: s.importe_reserva_cent,
  };
}

export function resumenBizum(p) {
  return [
    `Confirmar el Bizum de ${p.nombre || p.telefono} (${p.telefono})${p.piloto ? `, plaza de ${p.piloto}` : ''}:`,
    `${p.ronda}, ${p.fecha} en ${p.circuito} · ${euros(p.importe_cent)} € · reserva ${p.codigo_reserva}.`,
    'Comprueba en el banco que ha llegado antes de confirmar.',
  ].join('\n');
}

/** ¿Hay ya una propuesta viva para esa solicitud? (para no repetir aviso si mandan varias fotos) */
export async function propuestaViva(solicitudId) {
  return uno(
    `SELECT codigo FROM admin_actions WHERE tipo = 'confirmar_bizum' AND estado = 'propuesta' AND caduca_at > now()
       AND parametros->>'solicitud_id' = $1`, [solicitudId]);
}

/** B3: convierte la solicitud en reserva confirmada y manda la confirmación de plaza (B1). */
export async function ejecutarConfirmacionBizum(p, d = {}) {
  const propietario = await uno(`SELECT id FROM admin WHERE rol = 'propietario' AND activo ORDER BY creado_en LIMIT 1`);
  if (!propietario) return { ok: false, texto: 'No hay ningún administrador propietario en el panel para firmar el pago.' };
  const actor = `admin:${propietario.id}`;
  let r;
  try {
    r = await conTransaccion((c) => convertirSolicitud(c, p.solicitud_id, {
      metodo: 'bizum_manual', importe_cent: p.importe_cent, confirmado_por: actor, referencia_externa: p.codigo_reserva,
    }), { actor });
  } catch (e) {
    return { ok: false, texto: `No se ha podido confirmar: ${e.message}` };
  }
  if (r.yaPagada) return { ok: true, texto: `La reserva ${p.codigo_reserva} ya estaba confirmada.` };
  const { enviarConfirmacionesPedido } = await import('../whatsapp/confirmacion.js');
  const envios = await enviarConfirmacionesPedido(r.pedidoId, d);
  const enviados = envios.flatMap((x) => x.resultados ?? []).filter((x) => x.ok).length;
  return {
    ok: true, pedidoId: r.pedidoId, envios,
    texto: `Bizum confirmado: plaza reservada para la ${p.ronda} (${p.codigo_reserva}). ${enviados ? 'Le ha llegado la confirmación por WhatsApp.' : 'No se ha podido mandar la confirmación por WhatsApp; míralo en el panel.'}`,
  };
}

// --- B4 -------------------------------------------------------------------------------------------------------------------
function dentroDeHorario(ahora, inicio = '09:30', fin = '21:30') {
  const hm = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ahora);
  return hm >= inicio && hm <= fin;
}

/**
 * B4: recordatorio de Bizum a las 24 h. d: { enviar, ahora } (para los tests). Nunca lanza.
 * Devuelve { enviados, revisados } o { nota } si está fuera de horario.
 */
export async function recordatoriosBizum(d = {}) {
  try {
    const ahora = d.ahora ?? new Date();
    const horario = await consulta(`SELECT clave, valor FROM bot_settings WHERE clave IN ('horario_inicio', 'horario_fin')`);
    const h = Object.fromEntries(horario.map((x) => [x.clave, x.valor]));
    if (!dentroDeHorario(ahora, h.horario_inicio || '09:30', h.horario_fin || '21:30')) return { nota: 'fuera de horario' };
    const hoy = ahora.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    const candidatas = await consulta(
      `${CONSULTA_PENDIENTES} AND s.enviada_en <= $1::timestamptz - interval '24 hours' AND s.enviada_en > $1::timestamptz - interval '7 days'
         AND s.pagador_telefono IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM wa_outbox o WHERE o.idempotency_key = 'B4:' || s.id::text)
       ORDER BY s.enviada_en LIMIT 50`, [ahora.toISOString()]);
    const { asegurarContacto, conversacionActual } = await import('../whatsapp/entrante.js');
    const { enviar: enviarYcloud } = await import('../whatsapp/client.js');
    const { construirPlantilla } = await import('../whatsapp/templates.js');
    const enviar = d.enviar ?? enviarYcloud;
    let enviados = 0;
    for (const s of candidatas) {
      if (s.fecha < hoy || martesAnterior(s.fecha) < hoy) continue; // la inscripción de esa ronda ya está cerrada
      const contacto = await asegurarContacto(s.pagador_telefono, s.pagador_nombre ?? null, false);
      if (contacto.baja === 'total') continue;
      const variables = [pila(s.pagador_nombre) || 'hola', `R${s.numero}`, `https://raceupkc.com/inscripcion?ronda=${s.numero}`];
      const fila = await uno(
        `INSERT INTO wa_outbox (contact_id, automatizacion, plantilla, variables, enviar_at, estado, idempotency_key)
         VALUES ($1, 'B4', 'rukc_bizum_pendiente', $2, now(), 'enviando', $3)
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [contacto.id, JSON.stringify({ variables, solicitud: s.codigo }), `B4:${s.id}`]);
      if (!fila) continue;
      const conv = await conversacionActual(contacto.id);
      const envio = await enviar({ contacto, conversacionId: conv.id, autor: 'sistema', plantilla: construirPlantilla('rukc_bizum_pendiente', variables) });
      await consulta(`UPDATE wa_outbox SET estado = $2, intentos = intentos + 1, message_id = $3, ultimo_error = $4 WHERE id = $1`,
        [fila.id, envio.ok ? 'enviado' : 'fallido', envio.id ?? null, envio.ok ? null : String(envio.error ?? 'error').slice(0, 300)]);
      if (envio.ok) enviados += 1;
    }
    return { revisados: candidatas.length, enviados };
  } catch (e) {
    console.error('B4', e.message);
    return { error: e.message };
  }
}
