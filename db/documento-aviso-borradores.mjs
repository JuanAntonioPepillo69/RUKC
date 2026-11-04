// Carga y activa el aviso de borradores del formulario (/inscripcion) como documento legal "aviso_borradores".
// El texto es el que ya se mostraba como provisional (lib/catalogo.js), revisado por el abogado el 4-11-2026: al estar
// vigente, el formulario deja de mostrar la etiqueta "Texto provisional" y cada borrador guarda esta versión.
// Uso: node --env-file=.env db/documento-aviso-borradores.mjs   (o --env-file=.env.produccion). Se puede repetir.
import crypto from 'node:crypto';
import { Pool } from '@neondatabase/serverless';
import { AVISO_BORRADORES_PROVISIONAL } from '../lib/catalogo.js';
import { activar } from '../lib/documentos.js';

const VERSION = 'aviso-v1';
const REVISADO_ABOGADO = '2026-11-04';
const TITULO = 'Aviso de borradores del formulario de reserva';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();
try {
  await c.query('BEGIN');
  await c.query("SELECT set_config('rukc.actor', 'sistema', true)");
  const hash = crypto.createHash('sha256').update(AVISO_BORRADORES_PROVISIONAL).digest('hex');
  const { rows: [ya] } = await c.query('SELECT id, hash_sha256, vigente_desde FROM documento_legal WHERE tipo = $1 AND version = $2', ['aviso_borradores', VERSION]);
  if (ya?.vigente_desde) {
    console.log(ya.hash_sha256 === hash ? `aviso_borradores ${VERSION}: ya vigente` : `aviso_borradores ${VERSION} está vigente con otro texto: crea una versión nueva.`);
  } else {
    let id = ya?.id;
    if (!id) {
      ({ rows: [{ id }] } = await c.query(`INSERT INTO documento_legal (tipo, version, titulo, contenido_md, obligatorio_onboarding, revocable, revisado_abogado_en, creado_por)
        VALUES ('aviso_borradores', $1, $2, $3, false, false, $4, 'sistema') RETURNING id`, [VERSION, TITULO, AVISO_BORRADORES_PROVISIONAL, REVISADO_ABOGADO]));
    }
    const a = await activar(c, id);
    console.log(`aviso_borradores: activado ${VERSION} (revisado el ${REVISADO_ABOGADO})${a.cerradas.length ? `, cierra ${a.cerradas.join(', ')}` : ''}`);
  }
  await c.query('COMMIT');
} catch (e) {
  await c.query('ROLLBACK').catch(() => {});
  console.error(e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
