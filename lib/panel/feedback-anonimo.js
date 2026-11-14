// Panel: feedback anónimo y sorteo de cada ronda (src/config/feedback/rondas.js). Solo el propietario exporta.
// - Respuestas: XLSX con dos hojas. "Respuestas": una fila por respuesta (en orden aleatorio) y una columna por id de
//   pregunta, con el texto de cada opción; las múltiples separadas por «; ». "Libro de códigos": id, bloque, tipo,
//   texto, cuándo se muestra y opciones (clave = texto).
// - Sorteo: archivo aparte (XLSX o CSV) con nombre y WhatsApp.
// No hay vista de resultados agregados: si se crea, debe ocultar cualquier cruce con menos de 5 respuestas.
import ExcelJS from 'exceljs';
import { celdaCsv } from '../csv.js';
import { ErrorPanel } from '../admin.js';
import { bloquesDe, formVersion } from '../feedback-anonimo/motor.js';
import { PREGUNTAS } from '../../src/config/feedback/preguntas.js';
import { TEXTOS, rellenar } from '../../src/config/feedback/textos.es.js';
import { RONDAS, DIAS_BORRAR_SORTEO, rondaPorSlug, ventana } from '../../src/config/feedback/rondas.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const descarga = (cuerpo, nombre, tipo) => new Response(cuerpo, { headers: {
  'Content-Type': tipo, 'Content-Disposition': `attachment; filename="${nombre}"`, 'Cache-Control': 'no-store' } });

function rondaDe(params) {
  const r = rondaPorSlug(params.ronda);
  if (!r) throw new ErrorPanel(404, 'Esa ronda no tiene formulario de feedback.');
  return r;
}

/** GET feedback-anonimo/rondas · rondas configuradas con su estado y cuántas respuestas y participaciones hay. */
export async function rondas({ tx }) {
  return tx(async (c) => {
    const { rows } = await c.query(`SELECT round_id, 'r' AS t, count(*)::int AS n FROM feedback_responses GROUP BY 1
      UNION ALL SELECT round_id, 's', count(*)::int FROM raffle_entries GROUP BY 1`);
    const n = (id, t) => rows.find((x) => x.round_id === id && x.t === t)?.n ?? 0;
    return { rondas: RONDAS.map((r) => ({
      slug: r.slug, round_id: r.round_id, nombre: r.nombre, circuito: r.circuito, abre: r.abre, cierra: r.cierra,
      modulo: r.modulo, form_version: formVersion(r), estado: ventana(r), respuestas: n(r.round_id, 'r'), sorteo: n(r.round_id, 's'),
      dias_borrar_sorteo: DIAS_BORRAR_SORTEO,
    })) };
  });
}

/** Columnas de la exportación de una ronda: las preguntas de sus bloques en orden, cada una seguida de su `_otro`. */
function columnas(ronda) {
  const ids = [];
  for (const b of bloquesDe(ronda)) for (const { id } of b.preguntas) {
    if (ids.includes(id)) continue;
    ids.push(id);
    if (PREGUNTAS[id].otro) ids.push(`${id}_otro`);
  }
  return ids;
}

const textoPregunta = (ronda, id) => {
  const base = id.replace(/_otro$/, '');
  const t = rellenar(TEXTOS.preguntas[base].texto, { proxima_ronda: ronda.proxima_ronda });
  return id.endsWith('_otro') ? `${base}: texto de «Otro»` : t;
};

function describirCondicion(c) {
  if (!c) return '';
  if (c.y) return c.y.map(describirCondicion).join(' y ');
  if (c.o) return c.o.map(describirCondicion).join(' o ');
  const quien = c.cfg ? `config.${c.cfg}` : c.p;
  if ('es' in c) return `${quien} = ${c.es}`;
  if ('max' in c) return `${quien} ≤ ${c.max}`;
  if (c.en) return `${quien} ∈ {${c.en.join(', ')}}`;
  if (c.no) return `${quien} ∉ {${c.no.join(', ')}}`;
  return '';
}

/** Texto legible de un valor guardado. */
function legible(id, v) {
  if (v == null) return '';
  const p = PREGUNTAS[id];
  const ops = TEXTOS.preguntas[id]?.opciones;
  if (!p || !ops) return v;   // texto, escala o `_otro`
  return Array.isArray(v) ? v.map((x) => ops[x] ?? x).join('; ') : ops[v] ?? v;
}

/** GET feedback-anonimo/:ronda/exportar · XLSX con respuestas y libro de códigos. */
export async function exportar({ params, tx }) {
  const ronda = rondaDe(params);
  const filas = await tx(async (c) => (await c.query(
    `SELECT form_version, submitted_on::text AS submitted_on, answers FROM feedback_responses WHERE round_id = $1 ORDER BY random()`,
    [ronda.round_id])).rows);
  const cols = columnas(ronda);
  const libro = new ExcelJS.Workbook();
  libro.creator = 'RUKC';

  const hoja = libro.addWorksheet('Respuestas');
  hoja.columns = [
    { header: 'form_version', key: 'form_version', width: 12 }, { header: 'fecha', key: 'submitted_on', width: 12 },
    ...cols.map((id) => ({ header: id, key: id, width: PREGUNTAS[id]?.tipo === 'texto' || id.endsWith('_otro') ? 40 : 18 })),
  ];
  for (const f of filas) hoja.addRow({ form_version: f.form_version, submitted_on: f.submitted_on, ...Object.fromEntries(cols.map((id) => [id, legible(id, f.answers[id])])) });
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: 'frozen', ySplit: 1 }];

  const codigos = libro.addWorksheet('Libro de códigos');
  codigos.columns = [
    { header: 'id', key: 'id', width: 12 }, { header: 'bloque', key: 'bloque', width: 22 }, { header: 'tipo', key: 'tipo', width: 12 },
    { header: 'obligatoria', key: 'obligatoria', width: 11 }, { header: 'texto', key: 'texto', width: 70 },
    { header: 'se muestra si', key: 'si', width: 34 }, { header: 'opciones (clave = texto)', key: 'opciones', width: 80 },
  ];
  for (const b of bloquesDe(ronda)) {
    for (const { id, si } of b.preguntas) {
      const p = PREGUNTAS[id];
      const ops = TEXTOS.preguntas[id].opciones;
      const condicion = [describirCondicion(b.si), describirCondicion(si), describirCondicion(p.si)].filter(Boolean).join(' y ');
      codigos.addRow({
        id, bloque: TEXTOS.bloques[b.id], obligatoria: p.tipo === 'texto' ? 'no' : 'sí',
        tipo: p.tipo === 'escala' ? `escala ${p.escala[0]}-${p.escala[1]}` : p.tipo + (p.max ? ` (máx. ${p.max})` : ''),
        texto: textoPregunta(ronda, id) + (p.auto ? ` [si ${describirCondicion(p.auto.si)}, no se pregunta y se guarda «${ops[p.auto.valor]}»]` : ''),
        si: condicion,
        opciones: p.opciones ? p.opciones.map((o) => `${o} = ${ops[o]}`).join(' | ')
          : p.tipo === 'escala' ? `${p.escala[0]} = ${TEXTOS.preguntas[id].extremos[0]} | ${p.escala[1]} = ${TEXTOS.preguntas[id].extremos[1]}` : '',
      });
      if (p.otro) codigos.addRow({ id: `${id}_otro`, bloque: TEXTOS.bloques[b.id], tipo: 'texto', obligatoria: 'no', texto: textoPregunta(ronda, `${id}_otro`), si: `${id} = otro` });
    }
  }
  codigos.getRow(1).font = { bold: true };
  codigos.views = [{ state: 'frozen', ySplit: 1 }];

  return descarga(await libro.xlsx.writeBuffer(), `rukc-feedback-${ronda.round_id}.xlsx`, XLSX);
}

/** GET feedback-anonimo/:ronda/sorteo?formato=csv|xlsx · participantes del sorteo, archivo aparte. */
export async function exportarSorteo({ params, url, tx, actor, admin }) {
  const ronda = rondaDe(params);
  const filas = await tx(async (c) => {
    const r = (await c.query(`SELECT name, whatsapp, created_on::text AS created_on FROM raffle_entries WHERE round_id = $1 ORDER BY random()`,
      [ronda.round_id])).rows;
    await c.query(`INSERT INTO evento (actor, entidad, entidad_id, accion, despues, ip) VALUES ($1, 'exportacion', $2, 'exportacion_sensible', $3, current_setting('rukc.ip', true))`,
      [actor, `sorteo:${ronda.round_id}`, { filas: r.length, admin: admin.email }]);
    return r;
  });
  const cab = ['Nombre y apellidos', 'WhatsApp', 'Fecha'];
  const nombre = `rukc-sorteo-${ronda.round_id}`;
  if (url.searchParams.get('formato') === 'csv') {
    const celda = celdaCsv;
    const lineas = [cab.join(';'), ...filas.map((f) => [f.name, f.whatsapp, f.created_on].map(celda).join(';'))];
    return descarga(`﻿${lineas.join('\r\n')}\r\n`, `${nombre}.csv`, 'text/csv; charset=utf-8');
  }
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Sorteo');
  hoja.columns = [{ header: cab[0], key: 'name', width: 34 }, { header: cab[1], key: 'whatsapp', width: 18 }, { header: cab[2], key: 'created_on', width: 12 }];
  for (const f of filas) hoja.addRow(f);
  hoja.getRow(1).font = { bold: true };
  return descarga(await libro.xlsx.writeBuffer(), `${nombre}.xlsx`, XLSX);
}
