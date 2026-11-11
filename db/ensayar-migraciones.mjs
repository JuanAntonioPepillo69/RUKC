// Ensayo de migraciones sobre una copia de producción, sin tocar producción.
// 1. Crea una rama temporal de Neon a partir de la rama principal (copia exacta de los datos de ese momento).
// 2. Cuenta las filas de todas las tablas existentes.
// 3. Aplica las migraciones pendientes con db/migrar.mjs (rol rukc_migraciones) en esa rama.
// 4. Vuelve a contar y comprueba que ninguna tabla existente ha cambiado de filas, que existen las tablas nuevas
//    y que rukc_app tiene los permisos esperados.
// 5. Borra la rama temporal (también si algo falla).
// Uso: node --env-file=.env.produccion db/ensayar-migraciones.mjs
// Necesita NEON_API_KEY, NEON_PROJECT_ID y DATABASE_URL_MIGRACIONES (de producción: solo se usa su usuario y clave).
import { Pool } from '@neondatabase/serverless';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { NEON_API_KEY, NEON_PROJECT_ID, DATABASE_URL_MIGRACIONES } = process.env;
if (!NEON_API_KEY || !NEON_PROJECT_ID || !DATABASE_URL_MIGRACIONES) {
  console.error('Faltan NEON_API_KEY, NEON_PROJECT_ID o DATABASE_URL_MIGRACIONES.');
  process.exit(1);
}

// Tablas nuevas que deben existir después de migrar, y las que rukc_app no puede modificar.
const NUEVAS = ['wa_contacts', 'wa_consents', 'wa_conversations', 'wa_messages', 'wa_outbox', 'wa_batches',
  'wa_webhook_events', 'kb_documents', 'kb_document_versions', 'admin_actions', 'bot_settings'];
const SOLO_AÑADIR = ['wa_consents', 'kb_document_versions'];

const neon = async (ruta, init = {}) => {
  const r = await fetch(`https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}${ruta}`, {
    ...init,
    headers: { Authorization: `Bearer ${NEON_API_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' },
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Neon ${init.method || 'GET'} ${ruta}: ${r.status} ${cuerpo.message || ''}`);
  return cuerpo;
};
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function contar(pool) {
  const { rows: tablas } = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
  const filas = {};
  for (const { tablename } of tablas) {
    const { rows: [r] } = await pool.query(`SELECT count(*)::bigint AS n FROM "${tablename}"`);
    filas[tablename] = Number(r.n);
  }
  return filas;
}

let ramaId;
let codigo = 0;
try {
  const { branches } = await neon('/branches');
  const principal = branches.find((b) => b.default);
  if (!principal) throw new Error('No encuentro la rama principal.');
  const nombre = `ensayo-migraciones-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
  const creada = await neon('/branches', {
    method: 'POST',
    body: JSON.stringify({ branch: { parent_id: principal.id, name: nombre }, endpoints: [{ type: 'read_write' }] }),
  });
  ramaId = creada.branch.id;
  const host = creada.endpoints[0].host;
  console.log(`Rama temporal ${nombre} creada desde ${principal.name}.`);

  // Esperar a que terminen las operaciones de creación.
  for (let i = 0; i < 60; i++) {
    const { operations } = await neon(`/branches/${ramaId}/operations`).catch(() => ({ operations: [] }));
    if (operations.every((o) => ['finished', 'skipped'].includes(o.status))) break;
    await espera(2000);
  }

  const url = new URL(DATABASE_URL_MIGRACIONES);
  url.hostname = host;
  const pool = new Pool({ connectionString: url.toString() });
  const antes = await contar(pool);
  console.log(`Antes: ${Object.keys(antes).length} tablas.`);

  const migrar = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrar.mjs');
  const r = spawnSync(process.execPath, [migrar], { env: { ...process.env, DATABASE_URL_MIGRACIONES: url.toString() }, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('db/migrar.mjs falló en la rama temporal.');

  const despues = await contar(pool);
  const cambiadas = Object.keys(antes).filter((t) => t !== '_migraciones' && antes[t] !== despues[t]);
  const faltan = NUEVAS.filter((t) => !(t in despues));
  const { rows: permisos } = await pool.query(
    `SELECT t, has_table_privilege('rukc_app', t, 'INSERT') AS ins, has_table_privilege('rukc_app', t, 'UPDATE') AS upd,
            has_table_privilege('rukc_app', t, 'DELETE') AS del
     FROM unnest($1::text[]) AS t WHERE to_regclass(t) IS NOT NULL`, [NUEVAS]);
  const malPermiso = permisos.filter((p) => !p.ins || (SOLO_AÑADIR.includes(p.t) ? (p.upd || p.del) : !p.upd));
  await pool.end();

  console.log(`Después: ${Object.keys(despues).length} tablas.`);
  console.log(cambiadas.length ? `FALLO · filas cambiadas en: ${cambiadas.map((t) => `${t} ${antes[t]}→${despues[t]}`).join(', ')}`
    : 'OK · ninguna tabla existente ha cambiado de número de filas.');
  console.log(faltan.length ? `FALLO · faltan tablas: ${faltan.join(', ')}` : `OK · existen las ${NUEVAS.length} tablas nuevas.`);
  console.log(malPermiso.length ? `FALLO · permisos de rukc_app en: ${malPermiso.map((p) => p.t).join(', ')}`
    : 'OK · permisos de rukc_app (lectura y escritura; solo añadir en wa_consents y kb_document_versions).');
  if (cambiadas.length || faltan.length || malPermiso.length) codigo = 1;
} catch (e) {
  console.error(e.message);
  codigo = 1;
} finally {
  if (ramaId) {
    await neon(`/branches/${ramaId}`, { method: 'DELETE' }).then(() => console.log('Rama temporal borrada.'))
      .catch((e) => console.error(`No se pudo borrar la rama temporal ${ramaId}: ${e.message}`));
  }
}
process.exit(codigo);
