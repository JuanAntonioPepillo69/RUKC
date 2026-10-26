// Aviso de Stripe cuando una reserva se ha pagado: envía el evento Purchase a Meta (API de conversiones).
// En Stripe > Developers > Webhooks, endpoint https://raceupkc.com/api/stripe-webhook con los eventos
// checkout.session.completed y checkout.session.async_payment_succeeded.
// Variable de entorno en Vercel: STRIPE_WEBHOOK_SECRET (whsec_..., la da Stripe al crear el endpoint).
import crypto from 'node:crypto';
import { RESERVA } from '../src/config/reserva.js';
import { enviarEvento, userData } from './_meta.js';

const EVENTOS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];

/** Comprueba la cabecera Stripe-Signature (t=...,v1=...) contra el cuerpo tal cual llegó. */
export function firmaValida(payload, cabecera, secreto, ahora = Date.now() / 1000, tolerancia = 300) {
  if (!cabecera || !secreto) return false;
  const partes = cabecera.split(',').map((p) => p.split('='));
  const t = partes.find(([k]) => k === 't')?.[1];
  const firmas = partes.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !firmas.length || Math.abs(ahora - Number(t)) > tolerancia) return false;
  const esperada = crypto.createHmac('sha256', secreto).update(`${t}.${payload}`).digest('hex');
  return firmas.some((f) => f.length === esperada.length && crypto.timingSafeEqual(Buffer.from(f), Buffer.from(esperada)));
}

/** Evento Purchase para Meta a partir de la sesión de Checkout pagada. Null si no hay que enviarlo. */
export function eventoCompra(sesion) {
  const m = sesion.metadata || {};
  if (m.producto !== RESERVA.id || m.meta !== 'si') return null;
  return {
    event_name: 'Purchase',
    event_time: sesion.created || Math.floor(Date.now() / 1000),
    event_id: sesion.id,
    action_source: 'website',
    event_source_url: 'https://raceupkc.com/inscripcion',
    user_data: userData({ email: sesion.customer_details?.email || sesion.customer_email, telefono: m.telefono, ip: m.ip, ua: m.ua, fbp: m.fbp, fbc: m.fbc }),
    custom_data: { currency: 'EUR', value: sesion.amount_total / 100, content_name: RESERVA.concepto, ronda: m.ronda, origen: m.origen },
  };
}

export async function POST(request) {
  const secreto = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secreto) return new Response('webhook not configured', { status: 503 });

  const payload = await request.text();
  if (!firmaValida(payload, request.headers.get('stripe-signature'), secreto)) return new Response('bad signature', { status: 400 });

  const evento = JSON.parse(payload);
  const sesion = evento.data?.object;
  if (!EVENTOS.includes(evento.type) || sesion?.payment_status !== 'paid') return Response.json({ received: true });

  const compra = eventoCompra(sesion);
  if (compra && process.env.META_CAPI_TOKEN) {
    const meta = await enviarEvento(compra);
    // Si Meta falla, Stripe reintenta el aviso; Meta descarta duplicados por event_id
    if (!meta.ok) return Response.json({ error: 'meta_error', detail: meta.json }, { status: 500 });
  }
  return Response.json({ received: true });
}
