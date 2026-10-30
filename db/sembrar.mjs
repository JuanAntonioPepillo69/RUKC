// Carga datos iniciales (db/seed/*.sql) en una sola transacción. Se puede repetir: el SQL no duplica nada.
// Uso: npm run db:sembrar            (aplica db/seed/t2.sql)
//      node --env-file=.env db/sembrar.mjs db/seed/otro.sql
import { Pool } from '@neondatabase/serverless';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const archivo = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed', 't2.sql');
const url = process.env.DATABASE_URL_MIGRACIONES;
if (!url) {
  console.error('Falta DATABASE_URL_MIGRACIONES.');
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
const db = await pool.connect();
let codigo = 0;
try {
  await db.query('BEGIN');
  await db.query(fs.readFileSync(archivo, 'utf8'));
  await db.query('COMMIT');
  console.log(`Datos de ${path.basename(archivo)} cargados.`);
} catch (e) {
  await db.query('ROLLBACK').catch(() => {});
  console.error(`${path.basename(archivo)}: ${e.message}`);
  codigo = 1;
} finally {
  db.release();
  await pool.end();
}
process.exit(codigo);
