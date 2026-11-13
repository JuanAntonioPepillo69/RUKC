// Fase 4 · Comercial (especificación 3a, C1 y C2).
// Regla legal (LSSI, art. 21): sin consentimiento comercial vigente en wa_consents (el último registro del contacto
// para el tipo comercial es "otorga") no sale nada comercial. Se comprueba justo antes de cada envío, aquí y en
// client.js para las plantillas de categoría marketing. Una baja (comercial o total) también lo corta.
//
// C1 · Reserva abandonada: quien envió el formulario eligiendo tarjeta y no llegó a pagar (estado enviada o
// pago_abandonado) recibe un seguimiento a las 2 h y, si no ha contestado, otro y último a las 48 h. Solo con la
// inscripción de esa ronda abierta y sin otra reserva suya en la ronda. Con su ventana de 24 h abierta, texto libre;
// cerrada, la plantilla rukc_seguimiento_reserva. Los de Bizum no entran: para ellos está B4.
// Una sola vez por ronda, teléfono y paso (idempotency_key C1:R<n>:<teléfono>:<1|2>). De 9:30 a 21:30.
import { consulta } from '../db.js';
import { martesAnterior } from '../bot/datos.js';
import { construirPlantilla } from './templates.js';

const uno = async (t, p) => (await consulta(t, p))[0] ?? null;
const pila = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const fechaLarga = (iso) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' })
  .format(new Date(`${iso}T12:00:00Z`));

export const C1_PRIMERO_H = 2;
export const C1_SEGUNDO_H = 48;
const C1_MAX_DIAS = 7;   // pasado este tiempo, un abandono ya no se sigue

/** ¿Tiene el contacto consentimiento comercial vigente (último registro = otorga)? */
export async function consentimientoComercial(contactId) {
  const c = await uno(
    `SELECT accion FROM wa_consents WHERE contact_id = $1 AND tipo = 'comercial' ORDER BY created_at DESC, id DESC LIMIT 1`, [contactId]);
  return c?.accion === 'otorga';
}

/** ¿Se le puede mandar algo comercial? Consentimiento vigente, sin baja y que no sea el admin. */
export async function puedeRecibirComercial(contacto) {
  if (!contacto || contacto.baja !== 'ninguna' || contacto.rol === 'admin') return false;
  return consentimientoComercial(contacto.id);
}

/** ¿Tiene ya ese teléfono plaza (o un Bizum en curso) en la ronda? */
export async function tienePlazaEnRonda(telefono, rondaId) {
  return Boolean(await uno(
    `SELECT 1 FROM inscripcion i JOIN persona pil ON pil.id = i.piloto_persona_id
       JOIN pedido pe ON pe.id = i.pedido_id JOIN persona pag ON pag.id = pe.pagador_persona_id
     WHERE i.ronda_id = $1 AND i.estado IN ('reservada', 'pagada', 'asistio') AND $2 IN (pil.telefono, pag.telefono)
     UNION ALL
     SELECT 1 FROM solicitud_inscripcion s
     WHERE s.ronda_id = $1 AND $2 IN (s.pagador_telefono, s.piloto_telefono)
       AND (s.estado = 'pagada' OR (s.estado = 'enviada' AND s.metodo_elegido = 'bizum'))
     LIMIT 1`, [rondaId, telefono]));
}

const textoC1 = (v, numero) => [
  `Qué tal, ${v[0]}. Vimos que empezaste la reserva para la ${v[1]} de RUKC (${v[2]}, ${v[3]}) y no llegó a completarse.`,
  `¿Te surgió alguna duda? Responde por aquí y te ayudamos, o termina la reserva cuando quieras: https://raceupkc.com/inscripcion?ronda=${numero}`,
  'Responde BAJA si no quieres más avisos.',
].join('\n');

/** C1: seguimientos de reservas abandonadas que ya tocan. d: { ahora, enviar }. Nunca lanza. */
export async function seguimientosReserva(d = {}) {
  try {
    const ahora = d.ahora ?? new Date();
    const { madrid } = await import('./programador.js');
    const { fecha: hoy, hora } = madrid(ahora);
    const h = Object.fromEntries((await consulta(`SELECT clave, valor FROM bot_settings WHERE clave IN ('horario_inicio', 'horario_fin')`))
      .map((x) => [x.clave, x.valor]));
    if (hora < (h.horario_inicio || '09:30') || hora > (h.horario_fin || '21:30')) return { nota: 'fuera de horario' };

    const candidatas = await consulta(
      `SELECT s.id, s.enviada_en, s.pagador_nombre, s.pagador_telefono, r.id AS ronda_id, r.numero, r.fecha::text AS fecha, c.nombre AS circuito
       FROM solicitud_inscripcion s JOIN ronda r ON r.id = s.ronda_id JOIN circuito c ON c.id = r.circuito_id
       WHERE s.metodo_elegido = 'tarjeta' AND s.estado IN ('enviada', 'pago_abandonado') AND s.pagador_telefono IS NOT NULL
         AND s.enviada_en <= $1::timestamptz - make_interval(hours => $2) AND s.enviada_en > $1::timestamptz - make_interval(days => $3)
         AND r.estado IN ('programada', 'aplazada') AND r.fecha >= $4::date
         AND EXISTS (SELECT 1 FROM cupo_ronda cr WHERE cr.ronda_id = r.id AND cr.estado_inscripcion = 'abierta')
       ORDER BY s.enviada_en LIMIT 50`, [ahora.toISOString(), C1_PRIMERO_H, C1_MAX_DIAS, hoy]);

    const { asegurarContacto, conversacionActual } = await import('./entrante.js');
    const { enviar: enviarYcloud } = await import('./client.js');
    const enviar = d.enviar ?? enviarYcloud;
    const vistos = new Set();
    const salida = { enviados: 0, revisados: candidatas.length };
    for (const s of candidatas) {
      const clave = `C1:R${s.numero}:${s.pagador_telefono}`;
      if (vistos.has(clave)) continue;   // varias solicitudes del mismo teléfono y ronda: un solo seguimiento
      vistos.add(clave);
      if (martesAnterior(s.fecha) < hoy) continue;   // la inscripción de esa ronda ya está cerrada
      if (await tienePlazaEnRonda(s.pagador_telefono, s.ronda_id)) continue;
      const contacto = await asegurarContacto(s.pagador_telefono, s.pagador_nombre ?? null, false);
      if (!(await puedeRecibirComercial(contacto))) continue;
      // Lo lleva John (modo humano vigente) o está pausado: se espera.
      if (contacto.modo === 'pausado' || (contacto.modo === 'humano' && (!contacto.modo_hasta || new Date(contacto.modo_hasta) > ahora))) continue;

      // ¿Qué paso toca? El primero a las 2 h; el segundo a las 48 h si no ha escrito desde el primero.
      const primero = await uno(`SELECT estado, created_at FROM wa_outbox WHERE idempotency_key = $1`, [`${clave}:1`]);
      let paso = 1;
      if (primero) {
        if (primero.estado !== 'enviado') continue;
        if (new Date(s.enviada_en).getTime() + C1_SEGUNDO_H * 3.6e6 > ahora.getTime()) continue;
        if (contacto.last_inbound_at && new Date(contacto.last_inbound_at) > new Date(primero.created_at)) continue;   // contestó
        paso = 2;
      }
      const variables = [pila(s.pagador_nombre) || 'piloto', `R${s.numero}`, s.circuito, fechaLarga(s.fecha)];
      const ventanaAbierta = contacto.last_inbound_at && ahora.getTime() - new Date(contacto.last_inbound_at).getTime() < 24 * 3.6e6;
      const fila = await uno(
        `INSERT INTO wa_outbox (contact_id, automatizacion, ronda_id, plantilla, variables, enviar_at, estado, idempotency_key, intentos)
         VALUES ($1, 'C1', $2, $3, $4, $5, 'enviando', $6, 1) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [contacto.id, s.ronda_id, ventanaAbierta ? null : 'rukc_seguimiento_reserva', JSON.stringify({ variables, solicitud: s.id, paso }),
          ahora.toISOString(), `${clave}:${paso}`]);
      if (!fila) continue;
      const conv = await conversacionActual(contacto.id);
      const envio = ventanaAbierta
        ? await enviar({ contacto, conversacionId: conv.id, autor: 'sistema', texto: textoC1(variables, s.numero) })
        : await enviar({ contacto, conversacionId: conv.id, autor: 'sistema',
          plantilla: construirPlantilla('rukc_seguimiento_reserva', variables, { sufijoBoton: String(s.numero) }) });
      // Sin reintentos: si Meta rechaza la plantilla, no se manda nada más y queda registrado.
      await consulta(`UPDATE wa_outbox SET estado = $2, message_id = $3, ultimo_error = $4 WHERE id = $1`,
        [fila.id, envio.ok ? 'enviado' : 'fallido', envio.id ?? null, envio.ok ? null : String(envio.error ?? 'error').slice(0, 300)]);
      if (envio.ok) salida.enviados += 1;
    }
    return salida;
  } catch (e) {
    console.error('C1', e.message);
    return { error: e.message };
  }
}
