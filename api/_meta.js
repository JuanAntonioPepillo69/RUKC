// Meta Conversions API (CAPI): utilidades compartidas por api/lead.js y api/stripe-webhook.js.
// Los archivos de api/ que empiezan por "_" no se publican como funciones.
// Variables de entorno en Vercel: META_CAPI_TOKEN (obligatoria) y META_PIXEL_ID (opcional).
import crypto from 'node:crypto';

export const PIXEL_ID_POR_DEFECTO = '1960101698031451';

export function hash(value) {
  if (!value) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return undefined;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/** Datos del usuario para Meta: email y teléfono cifrados; IP, navegador y cookies del píxel tal cual. */
export function userData({ email, telefono, ip, ua, fbp, fbc }) {
  const user_data = {
    em: hash(email),
    ph: hash(String(telefono || '').replace(/\D/g, '')),
    client_ip_address: ip || undefined,
    client_user_agent: ua || undefined,
    fbp: fbp || undefined,
    fbc: fbc || undefined,
  };
  Object.keys(user_data).forEach((k) => user_data[k] === undefined && delete user_data[k]);
  return user_data;
}

/** Solo se acepta como origen del evento una URL de nuestro dominio. */
export function urlOrigen(url) {
  return typeof url === 'string' && /^https:\/\/(www\.)?raceupkc\.com\//.test(url) ? url : 'https://raceupkc.com/';
}

/** Envía un evento a Meta. Devuelve { ok, status, json } o { ok: false, status: 0 } si falta el token. */
export async function enviarEvento(evento) {
  const token = process.env.META_CAPI_TOKEN;
  const pixelId = process.env.META_PIXEL_ID || PIXEL_ID_POR_DEFECTO;
  if (!token) return { ok: false, status: 0, json: { error: 'server_not_configured' } };
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [evento] }),
    }
  );
  return { ok: res.ok, status: res.status, json: await res.json() };
}
