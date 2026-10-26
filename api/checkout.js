// Crea el pago de la reserva en Stripe Checkout y devuelve la URL de la pantalla de pago de Stripe.
// Los métodos (tarjeta, Bizum, Apple Pay, Google Pay) son los que estén activados en Stripe > Settings > Payment methods.
// Variable de entorno en Vercel: STRIPE_SECRET_KEY (sk_test_... para pruebas, sk_live_... para cobrar de verdad).
import { CATEGORIAS_RESERVA, RESERVA } from '../src/config/reserva.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORIGENES = /^https:\/\/((www\.)?raceupkc\.com|[\w-]+\.vercel\.app)$|^http:\/\/localhost(:\d+)?$/;
const corta = (v, n = 200) => String(v ?? '').trim().slice(0, n);

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Comprueba los datos del formulario. Devuelve { error } o { datos }. */
export function validarReserva(body) {
  const datos = {
    nombre: corta(body?.nombre, 80),
    email: corta(body?.email, 120).toLowerCase(),
    telefono: corta(body?.telefono, 30),
    categoria: corta(body?.categoria, 20),
    ronda: corta(body?.ronda, 80),
    origen: body?.origen === 'landing' ? 'landing' : 'web',
    meta: body?.meta === 'si' ? 'si' : 'no',
    fbp: corta(body?.fbp, 200),
    fbc: corta(body?.fbc, 400),
  };
  if (!/^R\d+\b/.test(datos.ronda)) return { error: 'Elige la ronda que quieres reservar.' };
  if (datos.nombre.length < 2) return { error: 'Escribe tu nombre y apellidos.' };
  if (!EMAIL.test(datos.email)) return { error: 'Revisa tu correo.' };
  if (datos.telefono.replace(/\D/g, '').length < 9) return { error: 'Revisa tu número de WhatsApp.' };
  if (!CATEGORIAS_RESERVA.includes(datos.categoria)) return { error: 'Elige tu categoría.' };
  if (body?.acepta !== true) return { error: 'Tienes que aceptar las condiciones de la reserva.' };
  return { datos };
}

/** Parámetros de la sesión de Checkout (formato de formulario que pide la API de Stripe). */
export function parametrosCheckout(datos, origen, cliente = {}) {
  const p = new URLSearchParams({
    mode: 'payment',
    locale: 'es',
    customer_email: datos.email,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(RESERVA.importe * 100),
    'line_items[0][price_data][product_data][name]': `${RESERVA.concepto} · ${datos.ronda}`,
    'line_items[0][price_data][product_data][description]': 'Reserva no reembolsable. Condiciones en raceupkc.com/condiciones-reserva',
    'payment_intent_data[description]': `${RESERVA.concepto} · ${datos.ronda.split(' ·')[0]} · ${datos.nombre}`,
    'payment_intent_data[receipt_email]': datos.email,
    success_url: `${origen}/inscripcion/confirmada?pago={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origen}/inscripcion?cancelado=1`,
  });
  const metadata = {
    producto: RESERVA.id,
    nombre: datos.nombre,
    telefono: datos.telefono,
    categoria: datos.categoria,
    ronda: datos.ronda,
    origen: datos.origen,
    meta: datos.meta,
    // Solo para medir la compra en Meta si el piloto no ha rechazado las cookies de la landing
    ...(datos.meta === 'si' ? { fbp: datos.fbp, fbc: datos.fbc, ip: corta(cliente.ip, 64), ua: corta(cliente.ua, 400) } : {}),
  };
  for (const [k, v] of Object.entries(metadata)) {
    if (!v) continue;
    p.set(`metadata[${k}]`, v);
    p.set(`payment_intent_data[metadata][${k}]`, v);
  }
  return p;
}

export async function POST(request) {
  const clave = process.env.STRIPE_SECRET_KEY;
  if (!clave) return json({ error: 'El pago online todavía no está activo. Escríbenos por WhatsApp y te reservamos la plaza.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Datos no válidos.' }, 400); }
  const { error, datos } = validarReserva(body);
  if (error) return json({ error }, 400);

  const u = new URL(request.url);
  const origen = ORIGENES.test(u.origin) ? u.origin : 'https://raceupkc.com';
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const params = parametrosCheckout(datos, origen, { ip, ua: request.headers.get('user-agent') });

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const sesion = await res.json();
    if (!res.ok || !sesion.url) {
      console.error('Stripe', res.status, sesion?.error?.message);
      return json({ error: 'No se ha podido abrir el pago. Inténtalo de nuevo en un momento o escríbenos por WhatsApp.' }, 502);
    }
    return json({ url: sesion.url });
  } catch (e) {
    console.error('Stripe', e);
    return json({ error: 'No se ha podido abrir el pago. Inténtalo de nuevo en un momento o escríbenos por WhatsApp.' }, 502);
  }
}
