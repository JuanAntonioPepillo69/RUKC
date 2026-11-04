// Comprobación previa del paso a producción (fase 7). Solo lee: no escribe en la base de datos, ni en Stripe, ni en
// Blob, y nunca imprime valores secretos (solo si están, su formato y lo que responden los servicios).
// Uso: npm run db:comprobar        (lee .env.produccion; ese archivo no se sube nunca, .gitignore cubre .env*)
// Cada línea sale como OK, FALTA o REVISAR. Termina con código 1 si hay alguna FALTA.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = process.env;
const filas = [];
const apunta = (estado, que, detalle = '') => filas.push({ estado, que, detalle });
const ok = (que, detalle) => apunta('OK', que, detalle);
const falta = (que, detalle) => apunta('FALTA', que, detalle);
const revisar = (que, detalle) => apunta('REVISAR', que, detalle);

// 1 · Variables (las mismas que tiene que tener Vercel en Production).
const clave32 = (v) => Buffer.from(v || '', 'base64').length === 32;
const VARIABLES = [
  ['DATABASE_URL', (v) => /^postgres(ql)?:\/\/rukc_app:/.test(v) && v.includes('-pooler'), 'rol rukc_app, con -pooler'],
  ['DATABASE_URL_MIGRACIONES', (v) => /^postgres(ql)?:\/\/rukc_migraciones:/.test(v) && !v.includes('-pooler'), 'rol rukc_migraciones, sin -pooler (solo en local, no en Vercel)'],
  ['STRIPE_SECRET_KEY', (v) => /^(sk|rk)_live_/.test(v), 'clave live (mejor restringida: rk_live_)'],
  ['STRIPE_WEBHOOK_SECRET', (v) => /^whsec_/.test(v), 'whsec_ del endpoint de producción'],
  ['BETTER_AUTH_SECRET', (v) => (v || '').length >= 32, '32 caracteres o más, distinto del de desarrollo'],
  ['BETTER_AUTH_URL', (v) => v === 'https://raceupkc.com', 'https://raceupkc.com'],
  ['RUKC_DATA_KEY', clave32, '32 bytes en base64, nueva para producción'],
  ['RUKC_BACKUP_KEY', clave32, '32 bytes en base64, distinta de RUKC_DATA_KEY'],
  ['CRON_SECRET', (v) => (v || '').length >= 32, '32 caracteres o más'],
  ['NEON_API_KEY', (v) => (v || '').length > 20, 'clave de proyecto de Neon'],
  ['NEON_PROJECT_ID', (v) => /^[a-z]+-[a-z]+-\d+$/.test(v || ''), 'id del proyecto (no el de la organización org-…)'],
  ['META_CAPI_TOKEN', (v) => (v || '').length > 20, 'token de la API de conversiones'],
  ['RUKC_SHEET_ID', (v) => (v || '').length > 20, 'hoja de la temporada'],
];
for (const [nombre, valida, pista] of VARIABLES) {
  if (!env[nombre]) falta(`Variable ${nombre}`, pista);
  else if (!valida(env[nombre])) revisar(`Variable ${nombre}`, `formato inesperado: ${pista}`);
  else ok(`Variable ${nombre}`);
}
if (env.RUKC_DATA_KEY && env.RUKC_DATA_KEY === env.RUKC_BACKUP_KEY) revisar('RUKC_DATA_KEY y RUKC_BACKUP_KEY', 'son iguales; tienen que ser distintas');
for (const v of ['RUKC_ENTORNO', 'RUKC_BLOB_LOCAL_DIR']) if (env[v]) revisar(`Variable ${v}`, 'es solo de desarrollo; no la pongas en producción');
// Si está .env (desarrollo), las claves de producción no pueden repetirse.
try {
  const dev = Object.fromEntries(fs.readFileSync(path.join(raiz, '.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=./.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]));
  for (const v of ['RUKC_DATA_KEY', 'RUKC_BACKUP_KEY', 'BETTER_AUTH_SECRET', 'CRON_SECRET', 'DATABASE_URL'])
    if (env[v] && dev[v] === env[v]) revisar(`Variable ${v}`, 'es la misma que en desarrollo');
} catch { /* sin .env de desarrollo */ }

// 2 · Neon: la rama tiene que ser la principal (production), con los dos roles y todo migrado.
const neon = async (ruta) => {
  const r = await fetch(`https://console.neon.tech/api/v2/projects/${env.NEON_PROJECT_ID}${ruta}`, { headers: { Authorization: `Bearer ${env.NEON_API_KEY}`, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Neon ${r.status}`);
  return r.json();
};
async function comprobarNeon() {
  if (!env.NEON_API_KEY || !env.NEON_PROJECT_ID) return;
  try {
    const { project } = await neon('');
    ok('Neon: proyecto', `${project.name} · ${project.region_id} · ${Math.round(project.compute_time_seconds / 360) / 10} CU-horas este mes`);
    if (!/eu-central-1/.test(project.region_id)) revisar('Neon: región', `${project.region_id}; el diseño pide Fráncfort`);
    const { branches } = await neon('/branches');
    const { endpoints } = await neon('/endpoints');
    for (const v of ['DATABASE_URL', 'DATABASE_URL_MIGRACIONES']) {
      if (!env[v]) continue;
      const host = new URL(env[v]).host.split('.')[0].replace(/-pooler$/, '');
      const rama = branches.find((b) => b.id === endpoints.find((e) => e.host.startsWith(host))?.branch_id);
      if (!rama) revisar(`Neon: rama de ${v}`, 'el host no es de este proyecto');
      else if (!rama.default) falta(`Neon: rama de ${v}`, `apunta a "${rama.name}", no a la rama principal`);
      else ok(`Neon: rama de ${v}`, `"${rama.name}" (principal)`);
    }
    const principal = branches.find((b) => b.default);
    const { roles } = await neon(`/branches/${principal.id}/roles`);
    const nombres = roles.map((r) => r.name);
    for (const r of ['rukc_app', 'rukc_migraciones']) (nombres.includes(r) ? ok : falta)(`Neon: rol ${r} en la rama principal`);
  } catch (e) { revisar('Neon: API', e.message); }
}

async function comprobarBase() {
  if (!env.DATABASE_URL_MIGRACIONES) return;
  const pool = new Pool({ connectionString: env.DATABASE_URL_MIGRACIONES });
  try {
    const q = async (t, p) => (await pool.query(t, p)).rows;
    const archivos = fs.readdirSync(path.join(raiz, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    const hay = (await q(`SELECT to_regclass('public._migraciones') IS NOT NULL AS hay`))[0].hay;
    const aplicadas = hay ? (await q('SELECT nombre FROM _migraciones')).map((r) => r.nombre) : [];
    const pendientes = archivos.filter((f) => !aplicadas.includes(f));
    if (pendientes.length) { falta('Migraciones', `${pendientes.length} pendientes: ${pendientes[0]} … ${pendientes.at(-1)} (npm run db:migrar)`); return; }
    ok('Migraciones', `${archivos.length} aplicadas`);
    const docs = await q(`SELECT tipo, version, revisado_abogado_en::text AS revisado FROM documento_legal WHERE vigente_desde <= now() AND (vigente_hasta IS NULL OR vigente_hasta > now())`);
    for (const t of ['reglamento', 'asuncion_riesgos', 'cesion_imagen', 'consentimiento_peso']) {
      const d = docs.find((x) => x.tipo === t);
      if (!d) falta(`Documento vigente: ${t}`, 'npm run db:documentos');
      else if (/prueba/i.test(d.version)) falta(`Documento vigente: ${t}`, `la versión vigente es de prueba (${d.version})`);
      else ok(`Documento vigente: ${t}`, `${d.version}, revisado por el abogado el ${d.revisado}`);
    }
    const temporadas = await q(`SELECT t.codigo, t.estado, count(r.*)::int AS rondas FROM temporada t LEFT JOIN ronda r ON r.temporada_id = t.id GROUP BY t.id`);
    if (!temporadas.length) falta('Temporada', 'sin datos de la T2 (npm run db:sembrar)');
    else for (const t of temporadas) ok(`Temporada ${t.codigo}`, `${t.estado}, ${t.rondas} rondas`);
    const admins = await q(`SELECT a.rol, u."twoFactorEnabled" AS totp FROM admin a LEFT JOIN auth_usuario u ON lower(u.email) = lower(a.email::text) WHERE a.activo`);
    if (!admins.some((a) => a.rol === 'propietario')) falta('Administrador propietario', 'npm run db:crear-admin (lo haces tú: la contraseña no pasa por el chat)');
    else ok('Administradores', `${admins.length} activos, ${admins.filter((a) => a.totp).length} con TOTP${admins.some((a) => !a.totp) ? ' (el TOTP se activa en el primer acceso)' : ''}`);
    const [{ n: pruebas }] = await q(`SELECT count(*)::int AS n FROM persona WHERE nombre ILIKE '%prueba%' OR apellidos ILIKE '%prueba%' OR email::text ILIKE '%@example.com'`);
    if (pruebas) revisar('Datos de prueba', `${pruebas} personas con pinta de prueba en producción`);
    const [{ n: personas }] = await q('SELECT count(*)::int AS n FROM persona');
    ok('Personas', `${personas} en la base de datos`);
  } catch (e) { revisar('Base de datos', e.message.split('\n')[0]); }
  finally { await pool.end(); }
  if (env.DATABASE_URL) {
    const app = new Pool({ connectionString: env.DATABASE_URL });
    try {
      const [{ usuario }] = (await app.query('SELECT current_user AS usuario')).rows;
      (usuario === 'rukc_app' ? ok : falta)('DATABASE_URL entra como rukc_app', usuario);
    } catch (e) { revisar('DATABASE_URL', e.message.split('\n')[0]); }
    finally { await app.end(); }
  }
}

// 3 · Stripe: permisos de la clave y eventos del webhook de producción (todo lecturas).
async function comprobarStripe() {
  if (!env.STRIPE_SECRET_KEY) return;
  const get = (ruta) => fetch(`https://api.stripe.com/v1/${ruta}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  for (const [ruta, que] of [['checkout/sessions?limit=1', 'Checkout Sessions'], ['payment_intents?limit=1', 'PaymentIntents'], ['charges?limit=1', 'Charges'], ['refunds?limit=1', 'Refunds']]) {
    const r = await get(ruta);
    (r.ok ? ok : falta)(`Stripe: permiso de lectura de ${que}`, r.ok ? '' : `HTTP ${r.status}`);
  }
  revisar('Stripe: permisos de escritura', 'en la clave restringida: Checkout Sessions y Refunds en "Write" (no se pueden probar sin escribir)');
  const r = await get('webhook_endpoints?limit=100');
  if (!r.ok) { revisar('Stripe: webhook', `la clave no puede leer los endpoints (HTTP ${r.status}); compruébalo en el panel de Stripe`); return; }
  const { data } = await r.json();
  const ep = data.find((e) => /^https:\/\/(www\.)?raceupkc\.com\/api\/stripe-webhook$/.test(e.url));
  if (!ep) { falta('Stripe: webhook', 'no hay endpoint https://raceupkc.com/api/stripe-webhook'); return; }
  if (ep.status !== 'enabled') revisar('Stripe: webhook', `estado ${ep.status}`);
  const necesarios = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'];
  const faltan = ep.enabled_events.includes('*') ? [] : necesarios.filter((e) => !ep.enabled_events.includes(e));
  (faltan.length ? falta : ok)('Stripe: eventos del webhook', faltan.length ? `faltan ${faltan.join(', ')}` : necesarios.join(', '));
}

// 4 · Blob privado (solo lectura de la lista de copias).
async function comprobarBlob() {
  if (!env.BLOB_READ_WRITE_TOKEN) { revisar('Blob', 'sin BLOB_READ_WRITE_TOKEN en local: se comprueba después del despliegue con la copia de la tarea diaria'); return; }
  try {
    const { list } = await import('@vercel/blob');
    const r = await list({ prefix: 'copias/', limit: 5 });
    ok('Blob: almacén accesible', `${r.blobs.length} copias listadas`);
  } catch (e) { falta('Blob', e.message.split('\n')[0]); }
}

await comprobarNeon();
await comprobarBase();
await comprobarStripe();
await comprobarBlob();

const ancho = Math.max(...filas.map((f) => f.que.length));
for (const f of filas) console.log(`${f.estado.padEnd(8)} ${f.que.padEnd(ancho)}  ${f.detalle}`);
const n = (e) => filas.filter((f) => f.estado === e).length;
console.log(`\n${n('OK')} OK · ${n('FALTA')} FALTA · ${n('REVISAR')} REVISAR`);
process.exitCode = n('FALTA') ? 1 : 0;
