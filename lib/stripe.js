// Llamadas a la API REST de Stripe sin librería (como el resto del proyecto).
// Variable de entorno: STRIPE_SECRET_KEY (sk_test_ en desarrollo y Preview; clave restringida en producción).
import crypto from 'node:crypto';

/**
 * POST/GET a la API de Stripe. Lanza un Error con el mensaje de Stripe si falla.
 * `idempotencia`: clave Idempotency-Key, para que repetir la misma petición (un reembolso) no la haga dos veces.
 */
export async function stripe(ruta, params = null, metodo = params ? 'POST' : 'GET', { idempotencia } = {}) {
  const clave = process.env.STRIPE_SECRET_KEY;
  if (!clave) throw Object.assign(new Error('Falta STRIPE_SECRET_KEY'), { codigo: 'sin_configurar' });
  const res = await fetch(`https://api.stripe.com/v1/${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/x-www-form-urlencoded', ...(idempotencia ? { 'Idempotency-Key': idempotencia } : {}) },
    body: metodo === 'GET' ? undefined : new URLSearchParams(params ?? {}),
  });
  const cuerpo = await res.json();
  if (!res.ok) throw Object.assign(new Error(`Stripe ${res.status}: ${cuerpo?.error?.message ?? 'error'}`), { status: res.status, stripe: cuerpo?.error });
  return cuerpo;
}

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
