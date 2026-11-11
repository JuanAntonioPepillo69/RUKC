// PIN de 6 cifras del canal admin para envíos a más de 20 personas (especificación 3f, punto 5).
// Se guarda solo su hash en la variable ADMIN_PIN_HASH, con el formato scrypt$<sal base64>$<hash base64>.
// El comando para crearlo es db/pin-hash.mjs; la comprobación la usa el canal admin (fase 2).
import crypto from 'node:crypto';

const OPCIONES = { N: 16384, r: 8, p: 1 };

export function hashPin(pin) {
  if (!/^\d{6}$/.test(String(pin))) throw new Error('El PIN son 6 cifras.');
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), sal, 32, OPCIONES);
  return `scrypt$${sal.toString('base64')}$${hash.toString('base64')}`;
}

export function pinValido(pin, guardado = process.env.ADMIN_PIN_HASH) {
  const [tipo, sal, hash] = String(guardado || '').split('$');
  if (tipo !== 'scrypt' || !sal || !hash || !/^\d{6}$/.test(String(pin))) return false;
  const esperado = Buffer.from(hash, 'base64');
  const dado = crypto.scryptSync(String(pin), Buffer.from(sal, 'base64'), esperado.length, OPCIONES);
  return crypto.timingSafeEqual(dado, esperado);
}
