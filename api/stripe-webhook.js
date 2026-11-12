// Avisos de Stripe. Firma verificada e idempotencia con stripe_evento: cada evento se procesa una sola vez.
// - checkout.session.completed (pagado) y checkout.session.async_payment_succeeded: en una sola transacción, la
//   solicitud se convierte en persona(s), oportunidad ganada, pedido, inscripción, pago confirmado con su aplicación,
//   onboarding pendiente y solicitud pagada (F1 paso 6). Después, fuera de la transacción, Purchase a Meta con
//   event_id = id del pago.
//   Por último, la confirmación de plaza por WhatsApp (B1, plantillas de YCloud); si falla, no afecta al pago.
// - checkout.session.expired: la solicitud pasa a pago_abandonado (si esa sesión era la vigente).
// - checkout.session.async_payment_failed: pago fallido y solicitud a pago_abandonado.
// Eventos en Stripe > Developers > Webhooks: los cuatro de arriba. Variable: STRIPE_WEBHOOK_SECRET.
import { enviarEvento, userData } from './_meta.js';
import { conTransaccion } from '../lib/db.js';
import { convertirSolicitud, registrarPagoFallido } from '../lib/flujos.js';
import { firmaValida, stripe } from '../lib/stripe.js';
import { enviarConfirmacionesPedido } from '../lib/whatsapp/confirmacion.js';

const PAGADO = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
const MANEJADOS = [...PAGADO, 'checkout.session.expired', 'checkout.session.async_payment_failed'];

// Reexportado para los tests y para quien ya lo importaba desde aquí.
export { firmaValida };

/** Método del pago: tipo real del cobro si se puede leer; si no, stripe_tarjeta / stripe_otro según la sesión. */
async function metodoPago(sesion) {
  const tipo = (t) => (t === 'card' ? 'stripe_tarjeta' : t === 'bizum' ? 'stripe_bizum' : 'stripe_otro');
  if (sesion.payment_intent) {
    try {
      const pi = await stripe(`payment_intents/${sesion.payment_intent}?expand[]=latest_charge`);
      const t = pi.latest_charge?.payment_method_details?.type;
      if (t) return tipo(t);
    } catch { /* clave sin permiso de lectura: se usa lo que diga la sesión */ }
  }
  const tipos = sesion.payment_method_types ?? [];
  return tipos.length === 1 ? tipo(tipos[0]) : 'stripe_tarjeta';
}

/** Evento Purchase para Meta a partir de la solicitud pagada. Null si no hay consentimiento de medición. */
export function eventoCompra({ pagoId, importeCent, solicitud, creadoEn }) {
  if (!solicitud?.consentimiento_medicion) return null;
  return {
    event_name: 'Purchase',
    event_time: creadoEn || Math.floor(Date.now() / 1000),
    event_id: pagoId,
    action_source: 'website',
    event_source_url: 'https://raceupkc.com/inscripcion',
    user_data: userData({ email: solicitud.pagador_email, telefono: solicitud.pagador_telefono, fbp: solicitud.fbp, fbc: solicitud.fbc }),
    custom_data: { currency: 'EUR', value: importeCent / 100, content_name: 'Reserva de plaza T2' },
  };
}

async function procesar(evento) {
  const sesion = evento.data?.object ?? {};
  const solicitudId = sesion.metadata?.solicitud_id || sesion.client_reference_id;
  // Sesiones antiguas (antes de la base de datos) no traen solicitud_id: se registran y no se tocan.
  if (!solicitudId || !/^[0-9a-f-]{36}$/.test(solicitudId)) return { nota: 'sin solicitud_id' };

  if (PAGADO.includes(evento.type)) {
    if (sesion.payment_status !== 'paid') return { nota: `payment_status ${sesion.payment_status}` };
    const metodo = await metodoPago(sesion);
    const r = await conTransaccion((c) => convertirSolicitud(c, solicitudId, {
      metodo,
      importe_cent: sesion.amount_total,
      stripe_payment_intent_id: sesion.payment_intent ?? null,
      stripe_checkout_session_id: sesion.id,
      confirmado_por: 'stripe',
      recibido_en: sesion.created ? new Date(sesion.created * 1000).toISOString() : null,
    }), { actor: 'stripe' });
    return { compra: r };
  }

  if (evento.type === 'checkout.session.expired') {
    await conTransaccion((c) => c.query(
      `UPDATE solicitud_inscripcion SET estado = 'pago_abandonado'
       WHERE id = $1 AND estado = 'enviada' AND stripe_checkout_session_id = $2`, [solicitudId, sesion.id]), { actor: 'stripe' });
    return {};
  }

  if (evento.type === 'checkout.session.async_payment_failed') {
    const metodo = await metodoPago(sesion);
    await conTransaccion((c) => registrarPagoFallido(c, solicitudId, {
      metodo, importe_cent: sesion.amount_total, stripe_payment_intent_id: sesion.payment_intent ?? null,
      stripe_checkout_session_id: sesion.id,
    }), { actor: 'stripe' });
    return {};
  }
  return {};
}

export async function POST(request) {
  const secreto = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secreto) return new Response('webhook not configured', { status: 503 });

  const payload = await request.text();
  if (!firmaValida(payload, request.headers.get('stripe-signature'), secreto)) return new Response('bad signature', { status: 400 });
  const evento = JSON.parse(payload);
  if (!MANEJADOS.includes(evento.type)) return Response.json({ received: true });

  // Idempotencia: el evento se registra una vez; si ya se procesó, se responde 200 sin repetir nada.
  const { rows: [ya] } = await conTransaccion((c) => c.query(
    `INSERT INTO stripe_evento (stripe_event_id, tipo) VALUES ($1, $2)
     ON CONFLICT (stripe_event_id) DO UPDATE SET tipo = EXCLUDED.tipo
     RETURNING procesado_en`, [evento.id, evento.type]), { actor: 'stripe' });
  if (ya?.procesado_en) return Response.json({ received: true, duplicado: true });

  let resultado;
  try {
    resultado = await procesar(evento);
  } catch (e) {
    console.error('stripe-webhook', evento.type, e.message);
    await conTransaccion((c) => c.query('UPDATE stripe_evento SET error = $2 WHERE stripe_event_id = $1',
      [evento.id, e.message.slice(0, 1000)]), { actor: 'stripe' }).catch(() => {});
    // 500: Stripe lo reintenta. El evento no queda como procesado.
    return Response.json({ error: 'procesar' }, { status: 500 });
  }
  await conTransaccion((c) => c.query(
    'UPDATE stripe_evento SET procesado_en = now(), error = $2 WHERE stripe_event_id = $1',
    [evento.id, resultado?.nota ?? null]), { actor: 'stripe' });

  // Purchase a Meta, fuera de la transacción: si falla no se deshace la venta.
  const compra = resultado?.compra;
  if (compra && !compra.yaPagada && process.env.META_CAPI_TOKEN) {
    try {
      const { rows: [s] } = await conTransaccion((c) => c.query(
        `SELECT s.consentimiento_medicion, s.pagador_email, s.pagador_telefono,
           (SELECT fbc FROM atribucion WHERE solicitud_id = s.id AND fbc IS NOT NULL ORDER BY capturada_en DESC LIMIT 1) AS fbc,
           (SELECT fbp FROM atribucion WHERE solicitud_id = s.id AND fbp IS NOT NULL ORDER BY capturada_en DESC LIMIT 1) AS fbp
         FROM solicitud_inscripcion s WHERE s.pedido_id = $1`, [compra.pedidoId]));
      const ev = eventoCompra({ pagoId: compra.pagoId, importeCent: evento.data.object.amount_total, solicitud: s, creadoEn: evento.created });
      if (ev) await enviarEvento(ev);
    } catch (e) {
      console.error('Purchase Meta', e.message);
    }
  }
  // Confirmación de plaza por WhatsApp (B1). Nunca lanza; cada inscripción y teléfono se envía una sola vez.
  if (compra && !compra.yaPagada && compra.pedidoId) await enviarConfirmacionesPedido(compra.pedidoId);
  return Response.json({ received: true });
}
