// Tests del esquema contra la rama de desarrollo de Neon, conectando como rukc_app (DATABASE_URL).
// Cada caso corre en una transacción que se deshace al final: no deja datos.
// Uso: npm run db:test   (antes: npm run db:migrar y npm run db:sembrar)
import { after, test } from 'node:test';
import { Pool } from '@neondatabase/serverless';
import { casos } from './casos.mjs';

if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL (rol rukc_app de la rama de desarrollo)');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
after(() => pool.end());

for (const [nombre, caso] of casos) {
  test(nombre, async () => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await caso(db);
    } finally {
      await db.query('ROLLBACK').catch(() => {});
      db.release();
    }
  });
}
