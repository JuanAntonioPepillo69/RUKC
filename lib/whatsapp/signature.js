// Firma de los avisos (webhooks) de YCloud.
// Cabecera YCloud-Signature: "t=<unix segundos>,s=<hex>". s = HMAC-SHA256(secreto, `${t}.${cuerpo en bruto}`).
// Se valida sobre el cuerpo tal cual llega, antes de leerlo como JSON. Se rechaza si t se aleja más de 5 minutos.
// Documentación: https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/implement-a-webhook-receiver.md
import crypto from 'node:crypto';

export const TOLERANCIA_S = 300;

/** Devuelve { t, s } o null si la cabecera no tiene el formato esperado. */
export function leerCabecera(cabecera) {
  if (!cabecera) return null;
  const partes = Object.fromEntries(String(cabecera).split(',').map((p) => {
    const i = p.indexOf('=');
    return i < 0 ? [p.trim(), ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }));
  if (!/^\d+$/.test(partes.t || '') || !/^[0-9a-f]+$/i.test(partes.s || '')) return null;
  return { t: Number(partes.t), s: partes.s.toLowerCase() };
}

/** Firma que YCloud pondría para este cuerpo y este instante (sirve también para los tests). */
export function firmar(cuerpo, secreto, t = Math.floor(Date.now() / 1000)) {
  const s = crypto.createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex');
  return `t=${t},s=${s}`;
}

/** true si la firma es válida y reciente. `ahora` en segundos (para tests). */
export function firmaValida(cuerpo, cabecera, secreto, ahora = Math.floor(Date.now() / 1000)) {
  if (!secreto) return false;
  const f = leerCabecera(cabecera);
  if (!f || Math.abs(ahora - f.t) > TOLERANCIA_S) return false;
  const esperada = crypto.createHmac('sha256', secreto).update(`${f.t}.${cuerpo}`).digest('hex');
  const a = Buffer.from(esperada, 'hex');
  const b = Buffer.from(f.s, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
