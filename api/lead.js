// Meta Conversions API (CAPI): reenvía a Meta el evento Lead del formulario de la landing, con email y teléfono cifrados (SHA-256).
// Variables de entorno en Vercel: META_CAPI_TOKEN (obligatoria) y META_PIXEL_ID (opcional).
const crypto = require('crypto');

function hash(value) {
  if (!value) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return undefined;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const token = process.env.META_CAPI_TOKEN;
  const pixelId = process.env.META_PIXEL_ID || '1960101698031451';

  if (!token) {
    res.status(500).json({ error: 'server_not_configured' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { nombre, email, telefono, nivel, event_id, fbp, fbc, url } = body;
    // Solo se acepta como origen del evento una URL de nuestro dominio
    const sourceUrl = typeof url === 'string' && /^https://(www.)?raceupkc.com//.test(url) ? url : 'https://raceupkc.com/';

    if (!email && !telefono) {
      res.status(400).json({ error: 'missing_contact_data' });
      return;
    }

    const forwardedFor = req.headers['x-forwarded-for'];
    const clientIp = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || '').split(',')[0].trim() || req.socket?.remoteAddress;

    const user_data = {
      em: hash(email),
      ph: hash(String(telefono || '').replace(/\D/g, '')),
      client_ip_address: clientIp || undefined,
      client_user_agent: req.headers['user-agent'] || undefined,
      fbp: fbp || undefined,
      fbc: fbc || undefined,
    };
    Object.keys(user_data).forEach((k) => user_data[k] === undefined && delete user_data[k]);

    const payload = {
      data: [{
        event_name: 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        event_id: event_id || undefined,
        action_source: 'website',
        event_source_url: sourceUrl,
        user_data,
        custom_data: {
          content_name: 'Solicitud T2',
          nivel: nivel || undefined,
        },
      }],
    };

    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    const metaJson = await metaRes.json();

    if (!metaRes.ok) {
      res.status(502).json({ error: 'meta_error', detail: metaJson });
      return;
    }

    res.status(200).json({ ok: true, events_received: metaJson.events_received });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
};
