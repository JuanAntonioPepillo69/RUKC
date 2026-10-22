// Meta Conversions API (CAPI): reenvía a Meta el evento Lead del formulario de la landing, con email y teléfono cifrados (SHA-256).
// Variables de entorno en Vercel: META_CAPI_TOKEN (obligatoria) y META_PIXEL_ID (opcional).
import { enviarEvento, urlOrigen, userData } from './_meta.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  if (!process.env.META_CAPI_TOKEN) {
    res.status(500).json({ error: 'server_not_configured' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { email, telefono, nivel, event_id, fbp, fbc, url } = body;

    if (!email && !telefono) {
      res.status(400).json({ error: 'missing_contact_data' });
      return;
    }

    const forwardedFor = req.headers['x-forwarded-for'];
    const clientIp = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || '').split(',')[0].trim() || req.socket?.remoteAddress;

    const meta = await enviarEvento({
      event_name: 'Lead',
      event_time: Math.floor(Date.now() / 1000),
      event_id: event_id || undefined,
      action_source: 'website',
      event_source_url: urlOrigen(url),
      user_data: userData({ email, telefono, ip: clientIp, ua: req.headers['user-agent'], fbp, fbc }),
      custom_data: {
        content_name: 'Solicitud T2',
        nivel: nivel || undefined,
      },
    });

    if (!meta.ok) {
      res.status(502).json({ error: 'meta_error', detail: meta.json });
      return;
    }

    res.status(200).json({ ok: true, events_received: meta.json.events_received });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
}
