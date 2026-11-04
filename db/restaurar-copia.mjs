// Restaura una copia de seguridad (lib/copia.js) en una base de datos VACÍA con el esquema ya creado: una rama nueva
// de Neon en la que se han aplicado las migraciones (npm run db:migrar con su cadena). Nunca contra producción ni
// contra una base con datos: se niega si la tabla persona ya tiene filas.
// Inserta las tablas en orden de dependencias con los triggers de usuario apagados (los de estados rechazarían
// filas que no empiezan en su estado inicial), vuelve a encenderlos, pone las secuencias donde estaban y compara
// los conteos con los de la copia.
// Uso: node --env-file=.env db/restaurar-copia.mjs <copia.rukc> <cadena de conexión del rol rukc_migraciones de la rama>
// (o RESTAURAR_URL en vez del segundo argumento). Necesita RUKC_BACKUP_KEY.
import fs from 'node:fs';
import { Pool } from '@neondatabase/serverless';
import { descifrarCopia } from '../lib/copia.js';

const SALTAR = ['_migraciones'];   // la rama ya tiene las suyas

/** Orden de inserción: primero las tablas de las que dependen otras (claves foráneas). */
async function orden(db, tablas) {
  const { rows } = await db.query(`SELECT c.conrelid::regclass::text AS hija, c.confrelid::regclass::text AS madre FROM pg_constraint c
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`);
  const deps = new Map(tablas.map((t) => [t, new Set()]));
  for (const { hija, madre } of rows) if (deps.has(hija) && deps.has(madre) && hija !== madre) deps.get(hija).add(madre);
  const lista = [];
  const hechas = new Set();
  while (lista.length < tablas.length) {
    const listas = tablas.filter((t) => !hechas.has(t) && [...deps.get(t)].every((m) => hechas.has(m)));
    if (!listas.length) throw new Error(`Dependencias circulares entre: ${tablas.filter((t) => !hechas.has(t)).join(', ')}`);
    for (const t of listas) { lista.push(t); hechas.add(t); }
  }
  return lista;
}

export async function restaurar(copia, url) {
  const pool = new Pool({ connectionString: url });
  const db = await pool.connect();
  const q = (t, p) => db.query(t, p);
  const ident = (s) => `"${s.replace(/"/g, '""')}"`;
  try {
    if ((await q('SELECT count(*)::int AS n FROM persona')).rows[0].n) throw new Error('La base de destino ya tiene datos: restaura solo en una rama nueva y vacía.');
    const existentes = new Set((await q(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)).rows.map((r) => r.table_name));
    const faltan = Object.keys(copia.tablas).filter((t) => !existentes.has(t) && !SALTAR.includes(t));
    if (faltan.length) throw new Error(`Faltan tablas en el destino (¿migraciones sin aplicar?): ${faltan.join(', ')}`);
    const tablas = await orden(db, Object.keys(copia.tablas).filter((t) => !SALTAR.includes(t)));
    await q('BEGIN');
    // Los datos iniciales que creen las migraciones se sustituyen por los de la copia.
    for (const t of [...tablas].reverse()) {
      await q(`ALTER TABLE ${ident(t)} DISABLE TRIGGER USER`);
      await q(`DELETE FROM ${ident(t)}`);
    }
    for (const t of tablas) {
      const filas = copia.tablas[t];
      for (let i = 0; i < filas.length; i += 500) {
        await q(`INSERT INTO ${ident(t)} SELECT * FROM json_populate_recordset(NULL::${ident(t)}, $1::json)`, [JSON.stringify(filas.slice(i, i + 500))]);
      }
    }
    for (const t of tablas) await q(`ALTER TABLE ${ident(t)} ENABLE TRIGGER USER`);
    for (const [s, v] of Object.entries(copia.secuencias ?? {})) {
      if (v != null) await q('SELECT setval($1::regclass, $2)', [`public.${ident(s)}`, v]);
    }
    await q('COMMIT');
    const comparacion = [];
    for (const t of tablas) {
      const n = (await q(`SELECT count(*)::int AS n FROM ${ident(t)}`)).rows[0].n;
      comparacion.push({ tabla: t, copia: copia.conteos[t], restaurada: n, ok: n === copia.conteos[t] });
    }
    return comparacion;
  } catch (e) {
    await q('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    db.release();
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('restaurar-copia.mjs')) {
  const [archivo, url = process.env.RESTAURAR_URL] = process.argv.slice(2);
  if (!archivo || !url) {
    console.error('Uso: node --env-file=.env db/restaurar-copia.mjs <copia.rukc> <cadena de la rama nueva (rol rukc_migraciones)>');
    process.exit(1);
  }
  try {
    const copia = descifrarCopia(fs.readFileSync(archivo));
    console.log(`Copia del ${copia.creada_en}: ${Object.keys(copia.tablas).length} tablas.`);
    const r = await restaurar(copia, url);
    console.table(r);
    const mal = r.filter((x) => !x.ok);
    console.log(mal.length ? `${mal.length} tablas NO cuadran.` : `Las ${r.length} tablas cuadran con la copia.`);
    process.exitCode = mal.length ? 1 : 0;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
