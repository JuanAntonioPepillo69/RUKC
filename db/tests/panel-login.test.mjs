// Login del panel contra Neon desarrollo: contraseña + TOTP obligatorio, bloqueo tras 5 fallos y 401 sin sesión.
// Crea un administrador de prueba y lo borra al terminar. Necesita DATABASE_URL, BETTER_AUTH_SECRET y BETTER_AUTH_URL.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Pool } from '@neondatabase/serverless';

for (const v of ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL']) if (!process.env[v]) throw new Error(`Falta ${v}`);
const { GET: authGet, POST: authPost } = await import('../../api/auth.js');
const { GET: adminGet, POST: adminPost } = await import('../../api/admin.js');

const BASE = process.env.BETTER_AUTH_URL;
const EMAIL = `prueba-panel-${Date.now()}@example.com`;
const PASS = `Prueba-${crypto.randomBytes(9).toString('base64url')}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = async (t, p) => (await pool.query(t, p)).rows;

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

/** Navegador mínimo: guarda las cookies entre peticiones. */
function navegador() {
  const tarro = new Map();
  const cookie = () => [...tarro].map(([k, v]) => `${k}=${v}`).join('; ');
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
    headers: { 'content-type': 'application/json', origin: BASE, cookie: cookie(), 'x-forwarded-for': '10.9.9.9' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return {
    auth: async (ruta, cuerpo) => guardar(await (cuerpo === undefined ? authGet : authPost)(req(cuerpo === undefined ? 'GET' : 'POST', `/api/auth/${ruta}`, cuerpo))),
    panel: async (ruta, cuerpo) => guardar(await (cuerpo === undefined ? adminGet : adminPost)(req(cuerpo === undefined ? 'GET' : 'POST', `/api/admin/${ruta}`, cuerpo))),
    tarro,
  };
}

let secreto;

before(() => {
  execFileSync(process.execPath, ['db/crear-admin.mjs', '--email', EMAIL, '--nombre', 'Prueba Panel'], {
    env: { ...process.env, RUKC_ADMIN_PASSWORD: PASS }, stdio: 'pipe' });
});

after(async () => {
  const [u] = await q('SELECT id FROM auth_usuario WHERE email = $1', [EMAIL]);
  if (u) await q('DELETE FROM auth_usuario WHERE id = $1', [u.id]);
  await q('UPDATE admin SET activo = false WHERE email = $1', [EMAIL]);
  await q(`DELETE FROM limite_peticion WHERE clave LIKE 'login:%' OR clave LIKE 'totp:%'`);
  await pool.end();
});

test('sin sesión, cualquier /api/admin/* responde 401', async () => {
  const n = navegador();
  assert.equal((await n.panel('hoy')).status, 401);
  assert.equal((await n.panel('lista/leads')).status, 401);
});

test('con contraseña pero sin segundo factor no se entra al panel; al activarlo, sí', async () => {
  const n = navegador();
  const r = await n.auth('sign-in/email', { email: EMAIL, password: PASS });
  assert.equal(r.status, 200, await r.clone().text());
  const sinTotp = await n.panel('hoy');
  assert.equal(sinTotp.status, 403);
  assert.equal((await sinTotp.json()).necesita_2fa, true);

  const alta = await (await n.auth('two-factor/enable', { password: PASS })).json();
  secreto = new URL(alta.totpURI).searchParams.get('secret');
  assert.ok(secreto, 'El alta devuelve el secreto TOTP');
  const v = await n.auth('two-factor/verify-totp', { code: totp(secreto) });
  assert.equal(v.status, 200, await v.clone().text());
  assert.equal((await n.panel('hoy')).status, 200);
});

test('con el segundo factor activado, la contraseña sola no basta: hace falta el código', async () => {
  const n = navegador();
  const r = await (await n.auth('sign-in/email', { email: EMAIL, password: PASS })).json();
  assert.equal(r.twoFactorRedirect, true);
  assert.equal((await n.panel('hoy')).status, 401);
  const mal = await n.auth('two-factor/verify-totp', { code: '000000' });
  assert.notEqual(mal.status, 200);
  const bien = await n.auth('two-factor/verify-totp', { code: totp(secreto) });
  assert.equal(bien.status, 200, await bien.clone().text());
  assert.equal((await n.panel('hoy')).status, 200);
  const cookie = [...n.tarro.keys()].find((k) => k.includes('session_token'));
  assert.ok(cookie, 'Hay cookie de sesión');
});

test('cookie de sesión HttpOnly y SameSite=Strict, 12 h', async () => {
  const n = navegador();
  await n.auth('sign-in/email', { email: EMAIL, password: PASS });
  const res = await n.auth('two-factor/verify-totp', { code: totp(secreto) });
  const c = res.headers.getSetCookie().find((x) => x.includes('session_token'));
  assert.match(c, /HttpOnly/i);
  assert.match(c, /SameSite=Strict/i);
  assert.match(c, /Max-Age=43200/i);
});

test('cinco contraseñas mal en 15 min bloquean el acceso, incluso con la buena', async () => {
  const n = navegador();
  for (let i = 0; i < 5; i++) assert.equal((await n.auth('sign-in/email', { email: EMAIL, password: 'mal-mal-mal-mal' })).status, 401);
  const bloqueado = await n.auth('sign-in/email', { email: EMAIL, password: PASS });
  assert.equal(bloqueado.status, 429);
  assert.match((await bloqueado.json()).message, /15 minutos/);
});

test('una petición del panel que cambia datos sin Origin de la web se rechaza', async () => {
  const res = await adminPost(new Request(`${BASE}/api/admin/vistas`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }));
  assert.equal(res.status, 403);
});
