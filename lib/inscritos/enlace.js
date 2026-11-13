// Enlaces firmados a la imagen de inscritos. YCloud (WhatsApp) descarga la imagen desde una URL pública, así que la URL
// lleva una firma HMAC con caducidad en vez del secreto: /api/inscritos/imagen?ronda=<uuid>&categoria=LIG&exp=<s>&firma=<hex>.
// La clave se deriva de CRON_SECRET, que nunca sale en la URL.
import crypto from 'node:crypto';

export const VIGENCIA_MAX_S = 8 * 24 * 3600;   // un enlace vale como mucho 8 días
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clave() {
  const s = process.env.CRON_SECRET;
  if (!s) throw Object.assign(new Error('Falta CRON_SECRET'), { codigo: 'sin_configurar' });
  return crypto.createHmac('sha256', s).update('rukc:inscritos:imagen').digest();
}
const firmar = (ronda, categoria, exp) => crypto.createHmac('sha256', clave()).update(`${ronda}:${categoria}:${exp}`).digest('hex');

/** URL firmada de la imagen. vigenciaS: segundos de validez (por defecto 7 días). */
export function enlaceImagen(origen, rondaId, categoria, { vigenciaS = 7 * 24 * 3600, ahora = Date.now() } = {}) {
  const exp = Math.floor(ahora / 1000) + Math.min(vigenciaS, VIGENCIA_MAX_S);
  const q = new URLSearchParams({ ronda: rondaId, categoria, exp: String(exp), firma: firmar(rondaId, categoria, exp) });
  return `${origen}/api/inscritos/imagen?${q}`;
}

/** Comprueba la firma de una petición. Devuelve true solo si es válida y no ha caducado. */
export function firmaValida({ ronda, categoria, exp, firma }, ahora = Date.now()) {
  if (!UUID.test(ronda ?? '') || !/^(LIG|PES)$/.test(categoria ?? '') || !/^\d{9,11}$/.test(exp ?? '') || !/^[0-9a-f]{64}$/.test(firma ?? '')) return false;
  const e = Number(exp), s = Math.floor(ahora / 1000);
  if (e < s || e > s + VIGENCIA_MAX_S) return false;
  const esperada = Buffer.from(firmar(ronda, categoria, e), 'hex');
  return crypto.timingSafeEqual(esperada, Buffer.from(firma, 'hex'));
}

/** Authorization: Bearer <CRON_SECRET>, comparado en tiempo constante. */
export function bearerValido(request) {
  const secreto = process.env.CRON_SECRET;
  const dado = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return Boolean(secreto) && dado.length === secreto.length && crypto.timingSafeEqual(Buffer.from(dado), Buffer.from(secreto));
}
