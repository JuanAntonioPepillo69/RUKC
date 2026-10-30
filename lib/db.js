// Conexión a la base de datos (Neon Postgres) para las funciones de api/.
// - sql: consultas sueltas por HTTP, con parámetros. Uso: const filas = await sql`SELECT ... WHERE id = ${id}`;
// - conTransaccion(fn): varias consultas en una sola transacción (BEGIN/COMMIT, ROLLBACK si falla).
//   Uso: await conTransaccion(async (c) => { await c.query('...', [a, b]); ... });
// Siempre SQL parametrizado: nunca se concatena texto del usuario en una consulta.
// Variable de entorno: DATABASE_URL (rol rukc_app, conexión con -pooler).
import { neon, Pool } from '@neondatabase/serverless';

const url = () => {
  const u = process.env.DATABASE_URL;
  if (!u) throw new Error('Falta DATABASE_URL');
  return u;
};

let _sql;
/** Plantilla etiquetada para consultas sueltas: sql`SELECT * FROM ronda WHERE id = ${id}` */
export const sql = (strings, ...valores) => {
  _sql ??= neon(url());
  return _sql(strings, ...valores);
};

/** Ejecuta fn(cliente) dentro de una transacción. Devuelve lo que devuelva fn. */
export async function conTransaccion(fn) {
  const pool = new Pool({ connectionString: url() });
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    cliente.release();
    await pool.end();
  }
}
