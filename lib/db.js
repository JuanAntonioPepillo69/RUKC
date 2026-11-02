// Conexión a la base de datos (Neon Postgres) para las funciones de api/ y para la web al publicar.
// - sql`...`: consultas sueltas por HTTP con plantilla. Uso: const filas = await sql`SELECT ... WHERE id = ${id}`;
// - consulta(texto, params): consulta suelta por HTTP con $1, $2... Devuelve las filas.
// - conTransaccion(fn, { actor, ip }): varias consultas en una sola transacción (BEGIN/COMMIT, ROLLBACK si falla).
//   Fija rukc.actor y rukc.ip para que el historial (evento) sepa quién hizo el cambio.
//   Uso: await conTransaccion(async (c) => { await c.query('...', [a, b]); ... }, { actor: 'publico' });
// Siempre SQL parametrizado: nunca se concatena texto del usuario en una consulta.
// Variable de entorno: DATABASE_URL (rol rukc_app, conexión con -pooler).
import { neon, Pool } from '@neondatabase/serverless';

const url = () => {
  const u = process.env.DATABASE_URL;
  if (!u) throw Object.assign(new Error('Falta DATABASE_URL'), { codigo: 'sin_configurar' });
  return u;
};

let _sql;
const http = () => (_sql ??= neon(url()));

/** Plantilla etiquetada para consultas sueltas: sql`SELECT * FROM ronda WHERE id = ${id}` */
export const sql = (strings, ...valores) => http()(strings, ...valores);

/** Consulta suelta con parámetros posicionales. Devuelve las filas. */
export const consulta = (texto, params = []) => http().query(texto, params);

/** Ejecuta fn(cliente) dentro de una transacción. Devuelve lo que devuelva fn. */
export async function conTransaccion(fn, { actor = 'sistema', ip = null } = {}) {
  const pool = new Pool({ connectionString: url() });
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query("SELECT set_config('rukc.actor', $1, true), set_config('rukc.ip', $2, true)", [actor, ip ?? '']);
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
