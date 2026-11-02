// Login del panel de administración con Better Auth (en el propio repo, tablas en Neon).
// - Email + contraseña (sin registro público: los administradores se crean con db/crear-admin.mjs).
// - Segundo factor TOTP obligatorio: sin él, el panel no deja entrar (lo comprueba lib/admin.js).
// - Cookie de sesión HttpOnly, Secure, SameSite=Strict, 12 h.
// - Bloqueo tras 5 intentos fallidos en 15 min por email (contraseña) y por IP (código TOTP), con limite_peticion.
// Variables: DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL.
// Diseño: "Seguridad" → login del panel.
import { Pool } from '@neondatabase/serverless';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { hashIp, ipCliente } from './http.js';
import { hashToken } from './tokens.js';

const DOCE_HORAS = 60 * 60 * 12;
const MAX_FALLOS = 5;
const VENTANA_MIN = 15;

let _pool;
const pool = () => (_pool ??= new Pool({ connectionString: process.env.DATABASE_URL }));

/** Clave de bloqueo de un intento: por email en la contraseña, por IP en el código TOTP. */
function claveBloqueo(ctx) {
  if (ctx.path === '/sign-in/email') {
    const email = String(ctx.body?.email || '').trim().toLowerCase();
    return email ? `login:${hashToken(email)}` : null;
  }
  if (ctx.path === '/two-factor/verify-totp' || ctx.path === '/two-factor/verify-backup-code') {
    const ip = ctx.request ? ipCliente(ctx.request) : null;
    return `totp:${hashIp(ip) ?? 'sin-ip'}`;
  }
  return null;
}

async function fallosRecientes(clave) {
  const { rows } = await pool().query(
    `SELECT coalesce(sum(contador), 0)::int AS n FROM limite_peticion
     WHERE clave = $1 AND ventana_inicio > now() - make_interval(mins => $2)`, [clave, VENTANA_MIN]);
  return rows[0].n;
}

async function anotarFallo(clave) {
  await pool().query(
    `INSERT INTO limite_peticion (clave, ventana_inicio, contador) VALUES ($1, date_trunc('minute', now()), 1)
     ON CONFLICT (clave, ventana_inicio) DO UPDATE SET contador = limite_peticion.contador + 1`, [clave]);
}

export const opcionesAuth = () => ({
  appName: 'RUKC',
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET,
  database: pool(),
  trustedOrigins: [process.env.BETTER_AUTH_URL, 'https://raceupkc.com', 'https://rukc-pruebas.vercel.app'].filter(Boolean),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128 },
  session: { expiresIn: DOCE_HORAS, updateAge: DOCE_HORAS, modelName: 'auth_sesion' },
  user: { modelName: 'auth_usuario' },
  account: { modelName: 'auth_cuenta' },
  verification: { modelName: 'auth_verificacion' },
  rateLimit: { enabled: false },   // el bloqueo propio de abajo funciona entre funciones sin servidor
  advanced: {
    cookiePrefix: 'rukc',
    useSecureCookies: String(process.env.BETTER_AUTH_URL || '').startsWith('https://'),
    defaultCookieAttributes: { sameSite: 'strict', httpOnly: true },
  },
  plugins: [twoFactor({ issuer: 'RUKC', schema: { twoFactor: { modelName: 'auth_dos_factores' } } })],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const clave = claveBloqueo(ctx);
      if (clave && (await fallosRecientes(clave)) >= MAX_FALLOS) {
        throw new APIError('TOO_MANY_REQUESTS', { message: 'Demasiados intentos fallidos. Espera 15 minutos.' });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      const clave = claveBloqueo(ctx);
      if (clave && ctx.context.returned instanceof APIError) await anotarFallo(clave);
    }),
  },
});

let _auth;
/** Instancia de Better Auth (una por función). */
export const auth = () => (_auth ??= betterAuth(opcionesAuth()));
