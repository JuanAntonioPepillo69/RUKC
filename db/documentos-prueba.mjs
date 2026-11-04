// SOLO PARA LA RAMA DE DESARROLLO DE NEON. Activa versiones de prueba ("prueba-1") de los documentos que se firman en
// el onboarding (reglamento, cesión de imagen, asunción de riesgos y consentimiento de peso), para poder probar el
// flujo F5 mientras los textos reales siguen en BORRADOR esperando al abogado. Su texto dice que no son válidos.
// La fecha de revisión que llevan es ficticia: nunca se ejecuta contra producción.
// Protecciones: exige RUKC_ENTORNO=desarrollo y se niega si hay algún documento vigente que no sea de prueba.
// Se puede repetir: no duplica nada.
// Uso: npm run db:documentos-prueba
import { Pool } from '@neondatabase/serverless';

const TIPOS = [
  ['reglamento', 'Reglamento', false],
  ['cesion_imagen', 'Cesión de imagen (web, redes y anuncios)', true],
  ['asuncion_riesgos', 'Asunción de riesgos', false],
  ['consentimiento_peso', 'Consentimiento para tratar el peso', true],
];

/** Activa los documentos de prueba con la conexión `db` (pool o cliente). Devuelve cuántos ha creado. */
export async function activarDocumentosPrueba(db) {
  if (process.env.RUKC_ENTORNO !== 'desarrollo') throw new Error('Solo en desarrollo: falta RUKC_ENTORNO=desarrollo.');
  const { rows: reales } = await db.query(`SELECT tipo, version FROM documento_legal
    WHERE vigente_desde IS NOT NULL AND version NOT LIKE 'prueba-%' AND (vigente_hasta IS NULL OR vigente_hasta > now())`);
  if (reales.length) throw new Error(`Hay documentos reales vigentes (${reales.map((r) => `${r.tipo} ${r.version}`).join(', ')}): esto no es la rama de desarrollo.`);
  let creados = 0;
  for (const [tipo, titulo, revocable] of TIPOS) {
    const r = await db.query(`INSERT INTO documento_legal (tipo, version, titulo, contenido_md, obligatorio_onboarding, revocable, revisado_abogado_en, vigente_desde)
      SELECT $1, 'prueba-1', $2, $3, $4, $5, current_date, now()
      WHERE NOT EXISTS (SELECT 1 FROM documento_legal WHERE tipo = $1 AND version = 'prueba-1')`,
    [tipo, `PRUEBA · ${titulo}`,
      `**PRUEBA · solo para la rama de desarrollo. No es un texto legal ni tiene validez.**\n\nEste texto sustituye a «${titulo}» para probar el onboarding mientras el texto real espera la revisión del abogado.`,
      tipo !== 'consentimiento_peso', revocable]);
    creados += r.rowCount;
  }
  return creados;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/').replace(/^\//, '')}`) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const n = await activarDocumentosPrueba(pool);
    console.log(n ? `Activados ${n} documentos de prueba.` : 'Los documentos de prueba ya estaban activados.');
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
