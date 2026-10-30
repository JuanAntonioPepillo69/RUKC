// Aplica en orden las migraciones de db/migrations/ que aún no se han aplicado.
// Uso:  npm run db:migrar            (lee DATABASE_URL_MIGRACIONES de .env)
//       npm run db:migrar -- --estado (solo lista aplicadas y pendientes)
//
// Reglas:
// - Cada migración se aplica dentro de su propia transacción; al primer error se deshace esa migración y se para.
// - Lo aplicado queda en la tabla _migraciones con el hash del archivo. Si un archivo ya aplicado cambia,
//   el script se niega a seguir: una migración aplicada nunca se edita, los cambios van en una nueva.
import { Pool } from '@neondatabase/serverless';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CARPETA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const NOMBRE = /^\d{4}_[a-z0-9_]+\.sql$/;
const soloEstado = process.argv.includes('--estado');

const url = process.env.DATABASE_URL_MIGRACIONES;
if (!url) {
  console.error('Falta DATABASE_URL_MIGRACIONES (cadena del rol rukc_migraciones, conexión directa, sin -pooler).');
  process.exit(1);
}

const archivos = fs.readdirSync(CARPETA).filter((f) => f.endsWith('.sql')).sort();
const malos = archivos.filter((f) => !NOMBRE.test(f));
if (malos.length) {
  console.error(`Nombres de migración no válidos (deben ser NNNN_descripcion.sql): ${malos.join(', ')}`);
  process.exit(1);
}
const migraciones = archivos.map((nombre) => {
  const sql = fs.readFileSync(path.join(CARPETA, nombre), 'utf8');
  return { nombre, sql, hash: crypto.createHash('sha256').update(sql).digest('hex') };
});

const pool = new Pool({ connectionString: url });
const db = await pool.connect();
let codigo = 0;
try {
  await db.query(`CREATE TABLE IF NOT EXISTS _migraciones (
    nombre      text PRIMARY KEY,
    hash_sha256 text NOT NULL,
    aplicada_en timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await db.query('SELECT nombre, hash_sha256 FROM _migraciones');
  const aplicadas = new Map(rows.map((r) => [r.nombre, r.hash_sha256]));

  const editadas = migraciones.filter((m) => aplicadas.has(m.nombre) && aplicadas.get(m.nombre) !== m.hash);
  if (editadas.length) {
    throw new Error(`Migraciones ya aplicadas que han cambiado: ${editadas.map((m) => m.nombre).join(', ')}. No se editan: crea una migración nueva.`);
  }
  const desconocidas = [...aplicadas.keys()].filter((n) => !migraciones.some((m) => m.nombre === n));
  if (desconocidas.length) console.warn(`Aviso: aplicadas en la base de datos pero sin archivo: ${desconocidas.join(', ')}`);

  const pendientes = migraciones.filter((m) => !aplicadas.has(m.nombre));
  if (soloEstado) {
    for (const m of migraciones) console.log(`${aplicadas.has(m.nombre) ? 'aplicada ' : 'pendiente'}  ${m.nombre}`);
  } else if (!pendientes.length) {
    console.log('Sin migraciones pendientes.');
  } else {
    for (const m of pendientes) {
      process.stdout.write(`Aplicando ${m.nombre}… `);
      try {
        await db.query('BEGIN');
        await db.query(m.sql);
        await db.query('INSERT INTO _migraciones (nombre, hash_sha256) VALUES ($1, $2)', [m.nombre, m.hash]);
        await db.query('COMMIT');
        console.log('OK');
      } catch (e) {
        await db.query('ROLLBACK').catch(() => {});
        console.log('FALLO');
        throw new Error(`${m.nombre}: ${e.message}`);
      }
    }
    console.log(`${pendientes.length} migración(es) aplicada(s).`);
  }
} catch (e) {
  console.error(e.message);
  codigo = 1;
} finally {
  db.release();
  await pool.end();
}
process.exit(codigo);
