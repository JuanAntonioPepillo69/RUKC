// Ayuda para los tests del panel: crea un administrador de prueba con segundo factor activado y devuelve un
// "navegador" con su sesión iniciada para llamar a /api/admin/* como lo haría el panel.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const { GET: authGet, POST: authPost } = await import('../../api/auth.js');
const { GET: adminGet, POST: adminPost } = await import('../../api/admin.js');
const BASE = process.env.BETTER_AUTH_URL;

/** Código TOTP (RFC 6238, SHA-1, 6 dígitos, 30 s) a partir del secreto en base32. */
export function totp(base32, ahora = Date.now()) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of base32.replace(/=+$/, '').toUpperCase()) bits += abc.indexOf(ch).toString(2).padStart(5, '0');
  const clave = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(ahora / 1000 / 30)));
  const h = crypto.createHmac('sha1', clave).update(contador).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

export function navegador() {
  const tarro = new Map();
  const guardar = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [par] = c.split(';');
      const [k, ...v] = par.split('=');
      if (/max-age=0/i.test(c) || v.join('=') === '') tarro.delete(k.trim()); else tarro.set(k.trim(), v.join('='));
    }
    return res;
  };
  const req = (metodo, ruta, cuerpo) => new Request(`${BASE}${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', origin: BASE, cookie: [...tarro].map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': '10.8.8.8' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const llamar = (get, post, prefijo) => async (ruta, cuerpo) => guardar(await (cuerpo === undefined ? get : post)(req(cuerpo === undefined ? 'GET' : 'POST', `${prefijo}${ruta}`, cuerpo)));
  return { auth: llamar(authGet, authPost, '/api/auth/'), panel: llamar(adminGet, adminPost, '/api/admin/'), tarro };
}

/** Crea un administrador con TOTP activado y devuelve { email, panel(ruta, cuerpo) → datos JSON, crudo(...) → Response }. */
export async function adminConSesion() {
  const email = `prueba-panel-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.com`;
  const pass = `Prueba-${crypto.randomBytes(9).toString('base64url')}`;
  execFileSync(process.execPath, ['db/crear-admin.mjs', '--email', email, '--nombre', 'Prueba Panel'], { env: { ...process.env, RUKC_ADMIN_PASSWORD: pass }, stdio: 'pipe' });
  const n = navegador();
  await n.auth('sign-in/email', { email, password: pass });
  const alta = await (await n.auth('two-factor/enable', { password: pass })).json();
  const r = await n.auth('two-factor/verify-totp', { code: totp(new URL(alta.totpURI).searchParams.get('secret')) });
  if (r.status !== 200) throw new Error(`No se pudo activar el TOTP: ${await r.text()}`);
  const panel = async (ruta, cuerpo) => {
    const res = await n.panel(ruta, cuerpo);
    const datos = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.arrayBuffer();
    if (!res.ok) throw Object.assign(new Error(datos.error || `HTTP ${res.status}`), { status: res.status, datos });
    return datos;
  };
  return { email, panel, crudo: n.panel };
}
