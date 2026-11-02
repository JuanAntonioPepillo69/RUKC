// Tokens de enlaces personales y de borradores: 32 bytes aleatorios; en la base de datos solo su hash SHA-256.
import crypto from 'node:crypto';

export const nuevoToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** Token de la cabecera Authorization: Bearer <token> (o null). */
export function tokenDeCabecera(request) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer\s+([\w-]{20,100})$/);
  return m ? m[1] : null;
}
