// Crea (o reactiva) un administrador del panel: usuario de Better Auth con contraseña + fila en la tabla admin.
// La contraseña se pide por la terminal sin mostrarse y no se guarda en ningún archivo. El segundo factor (TOTP)
// se activa en el primer acceso al panel (/admin/seguridad).
// Uso: npm run db:crear-admin -- --email raceupkc@gmail.com --nombre "John" [--rol propietario|operador]
// Necesita DATABASE_URL, BETTER_AUTH_SECRET y BETTER_AUTH_URL (las del entorno donde se crea: desarrollo o producción).
import { Pool } from '@neondatabase/serverless';
import { hashPassword } from 'better-auth/crypto';
import crypto from 'node:crypto';
import readline from 'node:readline';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const email = String(arg('email') || '').trim().toLowerCase();
const nombre = String(arg('nombre') || '').trim();
const rol = arg('rol') || 'propietario';
if (!email || !nombre || !['propietario', 'operador'].includes(rol)) {
  console.error('Uso: npm run db:crear-admin -- --email <email> --nombre "<nombre>" [--rol propietario|operador]');
  process.exit(1);
}

/** Lee la contraseña sin mostrarla en pantalla (o de RUKC_ADMIN_PASSWORD, solo para pruebas automáticas). */
function pedirContrasena(pregunta) {
  if (process.env.RUKC_ADMIN_PASSWORD) return Promise.resolve(process.env.RUKC_ADMIN_PASSWORD);
  return new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(pregunta)) rl.output.write(s); };
    rl.question(pregunta, (r) => { rl.close(); process.stdout.write('\n'); ok(r); });
  });
}

const pass = await pedirContrasena('Contraseña (mínimo 12 caracteres): ');
if (pass.length < 12) { console.error('La contraseña tiene que tener al menos 12 caracteres.'); process.exit(1); }
if (!process.env.RUKC_ADMIN_PASSWORD && (await pedirContrasena('Repite la contraseña: ')) !== pass) {
  console.error('Las contraseñas no coinciden.'); process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();
try {
  await c.query('BEGIN');
  await c.query("SELECT set_config('rukc.actor', 'sistema', true)");
  const hash = await hashPassword(pass);
  const { rows: [u] } = await c.query('SELECT id FROM auth_usuario WHERE email = $1', [email]);
  let userId = u?.id;
  if (!userId) {
    userId = crypto.randomUUID();
    await c.query(`INSERT INTO auth_usuario (id, name, email, "emailVerified", "twoFactorEnabled", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, true, false, now(), now())`, [userId, nombre, email]);
    await c.query(`INSERT INTO auth_cuenta (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      VALUES ($1, $2, 'credential', $2, $3, now(), now())`, [crypto.randomUUID(), userId, hash]);
  } else {
    await c.query(`UPDATE auth_cuenta SET password = $2, "updatedAt" = now() WHERE "userId" = $1 AND "providerId" = 'credential'`, [userId, hash]);
  }
  await c.query(`INSERT INTO admin (email, nombre, rol, activo) VALUES ($1, $2, $3, true)
    ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, rol = EXCLUDED.rol, activo = true`, [email, nombre, rol]);
  await c.query('COMMIT');
  console.log(`${u ? 'Contraseña actualizada' : 'Administrador creado'}: ${email} (${rol}). Al entrar en /admin te pedirá activar el segundo factor.`);
} catch (e) {
  await c.query('ROLLBACK').catch(() => {});
  console.error(e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
