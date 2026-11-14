// Meta Conversions API (CAPI): reenvía a Meta el evento Lead del formulario de la landing, con email y teléfono cifrados (SHA-256).
// Variables de entorno en Vercel: META_CAPI_TOKEN (obligatoria) y META_PIXEL_ID (opcional).
// La web actual ya no la llama (el Lead sale de /api/checkout); queda por si algún formulario antiguo la usa. Como
// cualquiera podría mandar Leads inventados a nuestro píxel y estropear la optimización de las campañas: solo desde
// nuestra web (Origin obligatorio), con límite por IP (5 cada 10 min) y global (100 cada hora), campos acotados y sin
// devolver la respuesta de Meta.
import { enviarEvento, urlOrigen, userData } from './_meta.js';
import { consulta } from '../lib/db.js';
import { dentroDelLimite, dentroDelLimiteGlobal, ORIGENES_WEB } from '../lib/http.js';

const db = { query: async (texto, params) => ({ rows: await consulta(texto, params) }) };
const corto = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  if (!process.env.META_CAPI_TOKEN) {
    res.status(500).json({ error: 'server_not_configured' });
    return;
  }

  const origin = req.headers?.origin;
  if (!origin || !ORIGENES_WEB.test(origin)) {
    res.status(403).json({ error: 'origin_not_allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const email = corto(body.email, 254);
    const telefono = corto(body.telefono, 30);
    if ((!email || !EMAIL.test(email)) && !(telefono && /^[+\d\s().-]{6,30}$/.test(telefono))) {
      res.status(400).json({ error: 'missing_contact_data' });
      return;
    }

    const forwardedFor = req.headers['x-forwarded-for'];
    const clientIp = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || '').split(',')[0].trim() || req.socket?.remoteAddress;
    const peticion = { headers: { get: (k) => (k === 'x-forwarded-for' ? clientIp ?? '' : null) } };
    if (!(await dentroDelLimite(db, peticion, 'lead', 5, 10)) || !(await dentroDelLimiteGlobal(db, 'lead', 100, 60))) {
      res.status(429).json({ error: 'too_many_requests' });
      return;
    }

    const meta = await enviarEvento({
      event_name: 'Lead',
      event_time: Math.floor(Date.now() / 1000),
      event_id: corto(body.event_id, 100),
      action_source: 'website',
      event_source_url: urlOrigen(body.url),
      user_data: userData({ email: email && EMAIL.test(email) ? email : undefined, telefono, ip: clientIp,
        ua: corto(req.headers['user-agent'], 400), fbp: corto(body.fbp, 200), fbc: corto(body.fbc, 500) }),
      custom_data: {
        content_name: 'Solicitud T2',
        nivel: corto(body.nivel, 40),
      },
    });

    if (!meta.ok) {
      console.error('lead Meta', meta.status);
      res.status(502).json({ error: 'meta_error' });
      return;
    }

    res.status(200).json({ ok: true, events_received: meta.json.events_received });
  } catch (e) {
    console.error('lead', e.message);
    res.status(500).json({ error: 'server_error' });
  }
}
