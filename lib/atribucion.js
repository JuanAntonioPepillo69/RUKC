// Atribución: de lo que guarda el navegador (rukc_origen) a filas de la tabla atribucion.
// Decisión D1: UTM, fbclid, página de llegada y referrer. fbc y fbp solo con consentimiento de medición.

const corto = (v, n = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

/** Canal a partir de los datos de llegada. */
export function canal(o) {
  const src = (o.utm_source || '').toLowerCase();
  const med = (o.utm_medium || '').toLowerCase();
  const ref = (o.referrer || '').toLowerCase();
  const pagado = /(cpc|ppc|paid|ads?|pago)/.test(med);
  if (o.fbclid || (/(facebook|fb|meta|ig|instagram)/.test(src) && pagado) || /^\/acceso-/.test(o.landing_path || '')) return 'meta_ads';
  if (/(instagram|ig)/.test(src) || ref.includes('instagram.com')) return 'instagram';
  if (src.includes('whatsapp') || ref.includes('wa.me') || ref.includes('whatsapp')) return 'whatsapp';
  if (/(referido|amigo|referral)/.test(src + med)) return 'referido';
  if (/(circuito|qr|flyer)/.test(src + med)) return 'circuito';
  if (src || ref) return 'otro';
  return 'web_directa';
}

/** Limpia un objeto de origen recibido del navegador. Devuelve null si no hay nada útil. */
export function limpiarOrigen(o, { consentimiento = false, fbc = null, fbp = null } = {}) {
  if (!o || typeof o !== 'object') return null;
  const fila = {
    utm_source: corto(o.utm_source, 100),
    utm_medium: corto(o.utm_medium, 100),
    utm_campaign: corto(o.utm_campaign, 200),
    utm_content: corto(o.utm_content, 200),
    utm_term: corto(o.utm_term, 200),
    fbclid: corto(o.fbclid, 500),
    landing_path: corto(o.landing_path, 300),
    referrer: corto(o.referrer, 300),
    fbc: consentimiento ? corto(fbc, 500) : null,
    fbp: consentimiento ? corto(fbp, 200) : null,
  };
  const fecha = Date.parse(o.capturada_en);
  fila.capturada_en = Number.isFinite(fecha) && fecha <= Date.now() + 60_000 ? new Date(fecha).toISOString() : new Date().toISOString();
  fila.canal = canal(fila);
  return fila;
}

/** Inserta las filas de atribución (primera y última llegada, sin repetir) de una solicitud. */
export async function guardarAtribucion(db, solicitudId, origenes) {
  const vistas = new Set();
  for (const o of origenes) {
    if (!o) continue;
    const clave = JSON.stringify({ ...o, capturada_en: undefined, fbc: undefined, fbp: undefined });
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    await db.query(
      `INSERT INTO atribucion (solicitud_id, canal, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
         fbclid, fbc, fbp, landing_path, referrer, capturada_en, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'publico')`,
      [solicitudId, o.canal, o.utm_source, o.utm_medium, o.utm_campaign, o.utm_content, o.utm_term,
        o.fbclid, o.fbc, o.fbp, o.landing_path, o.referrer, o.capturada_en]);
  }
}
