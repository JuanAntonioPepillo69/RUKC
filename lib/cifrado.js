// Cifrado del número de documento (DNI, NIE o pasaporte) con AES-256-GCM. Clave: RUKC_DATA_KEY (32 bytes en base64).
// Formato guardado (bytea): versión (1 byte) | IV (12) | etiqueta (16) | texto cifrado.
// Si se pierde la clave, los documentos cifrados no se pueden recuperar.
import crypto from 'node:crypto';

const VERSION = 1;

function clave() {
  const k = Buffer.from(process.env.RUKC_DATA_KEY || '', 'base64');
  if (k.length !== 32) throw new Error('RUKC_DATA_KEY no está configurada (32 bytes en base64).');
  return k;
}

/** Normaliza un documento: sin espacios ni guiones, en mayúsculas. */
export const normalizarDocumento = (d) => String(d || '').toUpperCase().replace(/[\s.-]/g, '');

export function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', clave(), iv);
  const cifrado = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), cifrado]);
}

export function descifrar(buf) {
  const b = Buffer.from(buf);
  if (b[0] !== VERSION) throw new Error('Formato de cifrado desconocido');
  const d = crypto.createDecipheriv('aes-256-gcm', clave(), b.subarray(1, 13));
  d.setAuthTag(b.subarray(13, 29));
  return Buffer.concat([d.update(b.subarray(29)), d.final()]).toString('utf8');
}

/** DNI (8 cifras + letra), NIE (X/Y/Z + 7 cifras + letra) o pasaporte (6-12 letras y cifras). Devuelve el tipo o null. */
export function tipoDocumento(doc) {
  const d = normalizarDocumento(doc);
  const letra = (n) => 'TRWAGMYFPDXBNJZSQVHLCKE'[n % 23];
  if (/^\d{8}[A-Z]$/.test(d)) return letra(Number(d.slice(0, 8))) === d[8] ? 'dni' : null;
  if (/^[XYZ]\d{7}[A-Z]$/.test(d)) return letra(Number('XYZ'.indexOf(d[0]) + d.slice(1, 8))) === d[8] ? 'nie' : null;
  if (/^[A-Z0-9]{6,12}$/.test(d)) return 'pasaporte';
  return null;
}
