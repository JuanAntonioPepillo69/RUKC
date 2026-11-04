// Panel: feedback post-carrera (F6). Plantillas (una usada no se edita: se duplica como versión nueva), generar los
// envíos de una ronda celebrada, enviar y recordar por WhatsApp, contadores, filtro por respuesta y exportación.
// Enlaces: al generar se guarda el hash de un token que nadie conoce; al enviar o recordar se crea uno nuevo (el
// anterior deja de valer), como en el onboarding, porque en la base de datos solo queda el hash.
import ExcelJS from 'exceljs';
import { ErrorPanel } from '../admin.js';
import { MENSAJES } from '../../src/config/mensajes.js';
import { hashToken, nuevoToken } from '../tokens.js';
import * as F from '../validacion/feedback.js';

const DIAS_VALIDEZ = 14;   // regla 7 del diseño
const val = (esquema, datos) => {
  const r = esquema.safeParse(datos ?? {});
  if (r.success) return r.data;
  const i = r.error.issues[0];
  throw new ErrorPanel(400, i.code === 'custom' || !/^(Invalid|Expected|Too)/.test(i.message) ? i.message : `Revisa el campo ${i.path.join('.') || 'datos'}.`);
};
const uno = async (c, t, p) => (await c.query(t, p)).rows[0];
const filas = async (c, t, p) => (await c.query(t, p)).rows;
const pila = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const origen = (request) => new URL(request.url).origin.replace(/^http:\/\/localhost:\d+$/, 'https://raceupkc.com');
const temporadaVigente = (c) => uno(c, `SELECT id, codigo FROM temporada WHERE estado IN ('abierta', 'en_curso') ORDER BY inicio DESC NULLS LAST LIMIT 1`);

/** Estado que se muestra: un envío sin responder con la fecha pasada cuenta como caducado aunque la tarea diaria aún no lo haya marcado. */
const ESTADO = `CASE WHEN e.estado IN ('generado', 'enviado', 'abierto') AND e.expira_en <= now() THEN 'caducado' ELSE e.estado END`;

// ---------- Plantillas ----------

export async function plantillas({ tx }) {
  return tx(async (c) => ({
    plantillas: await filas(c, `SELECT pf.id, pf.version, pf.preguntas, pf.activa, pf.creado_en,
        (SELECT count(*)::int FROM envio_feedback e WHERE e.plantilla_id = pf.id) AS usos
      FROM plantilla_feedback pf ORDER BY pf.creado_en DESC`),
    tipos: F.TIPOS,
  }));
}

export async function crearPlantilla({ body, tx, actor }) {
  const d = val(F.plantilla, body);
  const p = await tx((c) => uno(c, 'INSERT INTO plantilla_feedback (version, preguntas, creado_por) VALUES ($1, $2, $3) RETURNING id',
    [d.version, JSON.stringify(d.preguntas), actor]));
  return { id: p.id };
}

export async function editarPlantilla({ params, body, tx }) {
  const d = val(F.plantilla, body);
  await tx(async (c) => {
    const p = await uno(c, 'SELECT activa FROM plantilla_feedback WHERE id = $1', [params.id]);
    if (!p) throw new ErrorPanel(404, 'No existe esa plantilla.');
    if (p.activa && !d.preguntas.length) throw new ErrorPanel(400, 'La plantilla activa necesita al menos una pregunta.');
    await c.query('UPDATE plantilla_feedback SET version = $2, preguntas = $3 WHERE id = $1', [params.id, d.version, JSON.stringify(d.preguntas)]);
  });
  return { ok: true };
}

export async function duplicarPlantilla({ params, body, tx, actor }) {
  const { version } = val(F.duplicar, body);
  const p = await tx((c) => uno(c, `INSERT INTO plantilla_feedback (version, preguntas, creado_por)
    SELECT $2, preguntas, $3 FROM plantilla_feedback WHERE id = $1 RETURNING id`, [params.id, version, actor]));
  if (!p) throw new ErrorPanel(404, 'No existe esa plantilla.');
  return { id: p.id };
}

/** Solo hay una plantilla activa: la que se usa al generar los envíos. */
export async function activarPlantilla({ params, tx }) {
  await tx(async (c) => {
    const p = await uno(c, 'SELECT preguntas FROM plantilla_feedback WHERE id = $1', [params.id]);
    if (!p) throw new ErrorPanel(404, 'No existe esa plantilla.');
    if (!p.preguntas.length) throw new ErrorPanel(400, 'Añade al menos una pregunta antes de activarla.');
    await c.query('UPDATE plantilla_feedback SET activa = false WHERE activa AND id <> $1', [params.id]);
    await c.query('UPDATE plantilla_feedback SET activa = true WHERE id = $1', [params.id]);
  });
  return { ok: true };
}

// ---------- Rondas y envíos ----------

const CONTADORES = `count(e.id)::int AS envios,
  count(*) FILTER (WHERE ${ESTADO} = 'generado')::int AS generados,
  count(*) FILTER (WHERE ${ESTADO} = 'enviado')::int AS enviados,
  count(*) FILTER (WHERE ${ESTADO} = 'abierto')::int AS abiertos,
  count(*) FILTER (WHERE ${ESTADO} = 'respondido')::int AS respondidos,
  count(*) FILTER (WHERE ${ESTADO} = 'caducado')::int AS caducados`;

/** Rondas de la temporada con sus asistentes y los contadores de feedback. */
export async function rondas({ tx }) {
  return tx(async (c) => {
    const t = await temporadaVigente(c);
    const activa = await uno(c, `SELECT id, version, jsonb_array_length(preguntas) AS preguntas FROM plantilla_feedback WHERE activa`);
    const lista = await filas(c, `SELECT r.id, r.numero, r.fecha::text AS fecha, r.estado, ci.nombre AS circuito,
        (SELECT count(*)::int FROM inscripcion i WHERE i.ronda_id = r.id AND i.estado = 'asistio') AS asistentes,
        (SELECT count(*)::int FROM inscripcion i WHERE i.ronda_id = r.id AND i.estado = 'asistio'
           AND NOT EXISTS (SELECT 1 FROM envio_feedback e WHERE e.inscripcion_id = i.id)) AS sin_envio,
        x.*
      FROM ronda r JOIN circuito ci ON ci.id = r.circuito_id
      LEFT JOIN LATERAL (SELECT ${CONTADORES} FROM envio_feedback e JOIN inscripcion i ON i.id = e.inscripcion_id WHERE i.ronda_id = r.id) x ON true
      WHERE r.temporada_id = $1 ORDER BY r.numero`, [t.id]);
    return { temporada: t.codigo, plantilla_activa: activa ?? null, rondas: lista };
  });
}

/** F6 paso 1: un envío por cada inscripción en asistio de una ronda celebrada, con la plantilla activa y 14 días. */
export async function generar({ params, tx }) {
  return tx(async (c) => {
    const r = await uno(c, 'SELECT estado FROM ronda WHERE id = $1', [params.id]);
    if (!r) throw new ErrorPanel(404, 'No existe esa ronda.');
    if (r.estado !== 'celebrada') throw new ErrorPanel(400, 'El feedback se genera cuando la ronda está celebrada.');
    const p = await uno(c, `SELECT id, preguntas FROM plantilla_feedback WHERE activa`);
    if (!p || !p.preguntas.length) throw new ErrorPanel(400, 'Activa una plantilla con preguntas antes de generar el feedback.');
    const pendientes = await filas(c, `SELECT i.id FROM inscripcion i WHERE i.ronda_id = $1 AND i.estado = 'asistio'
      AND NOT EXISTS (SELECT 1 FROM envio_feedback e WHERE e.inscripcion_id = i.id) FOR UPDATE OF i`, [params.id]);
    for (const i of pendientes) {
      await c.query(`INSERT INTO envio_feedback (inscripcion_id, plantilla_id, token_hash, expira_en)
        VALUES ($1, $2, $3, now() + make_interval(days => $4))`, [i.id, p.id, hashToken(nuevoToken()), DIAS_VALIDEZ]);
    }
    return { generados: pendientes.length };
  });
}

/** Envíos de una ronda con sus respuestas, filtrados opcionalmente por una pregunta (?pregunta=&op=&valor=). */
async function enviosDe(c, rondaId, url) {
  const params = [rondaId];
  let filtro = '';
  if (url.searchParams.get('pregunta')) {
    const f = val(F.filtro, Object.fromEntries(['pregunta', 'op', 'valor'].map((k) => [k, url.searchParams.get(k) ?? ''])));
    params.push(f.pregunta);
    let cond;
    if (f.op === 'contiene') {
      params.push(f.valor);
      cond = `(rf.valor_texto ILIKE '%' || $${params.length} || '%' OR $${params.length} = ANY (rf.valor_opciones))`;
    } else {
      const n = Number(f.valor.replace(',', '.'));
      if (!Number.isFinite(n)) throw new ErrorPanel(400, 'Para comparar, el valor tiene que ser un número.');
      params.push(n);
      cond = `rf.valor_num ${{ lt: '<', lte: '<=', eq: '=', gte: '>=', gt: '>' }[f.op]} $${params.length}`;
    }
    filtro = `AND EXISTS (SELECT 1 FROM respuesta_feedback rf WHERE rf.envio_id = e.id AND rf.pregunta_id = $2 AND ${cond})`;
  }
  return filas(c, `SELECT e.id, ${ESTADO} AS estado, e.enviado_en, e.abierto_en, e.respondido_en, e.recordatorio_en, e.expira_en,
      i.piloto_persona_id, btrim(p.nombre || ' ' || coalesce(p.apellidos, '')) AS piloto, p.telefono, pf.version AS plantilla,
      (SELECT jsonb_object_agg(rf.pregunta_id, coalesce(to_jsonb(rf.valor_num), to_jsonb(rf.valor_texto), to_jsonb(rf.valor_opciones)))
         FROM respuesta_feedback rf WHERE rf.envio_id = e.id) AS respuestas
    FROM envio_feedback e JOIN inscripcion i ON i.id = e.inscripcion_id JOIN persona p ON p.id = i.piloto_persona_id
    JOIN plantilla_feedback pf ON pf.id = e.plantilla_id
    WHERE i.ronda_id = $1 ${filtro} ORDER BY piloto`, params);
}

export async function ronda({ params, url, tx }) {
  return tx(async (c) => {
    const r = await uno(c, `SELECT r.id, r.numero, r.fecha::text AS fecha, r.estado, ci.nombre AS circuito FROM ronda r
      JOIN circuito ci ON ci.id = r.circuito_id WHERE r.id = $1`, [params.id]);
    if (!r) throw new ErrorPanel(404, 'No existe esa ronda.');
    const contadores = await uno(c, `SELECT ${CONTADORES} FROM envio_feedback e JOIN inscripcion i ON i.id = e.inscripcion_id WHERE i.ronda_id = $1`, [params.id]);
    // Preguntas de las plantillas usadas en la ronda (normalmente una), para el filtro y las columnas.
    const preguntas = (await filas(c, `SELECT DISTINCT ON (pf.id) pf.preguntas FROM envio_feedback e JOIN inscripcion i ON i.id = e.inscripcion_id
      JOIN plantilla_feedback pf ON pf.id = e.plantilla_id WHERE i.ronda_id = $1`, [params.id]))
      .flatMap((x) => x.preguntas).filter((p, i, a) => a.findIndex((q) => q.id === p.id) === i);
    return { ronda: r, contadores, preguntas, envios: await enviosDe(c, params.id, url) };
  });
}

/** Enlace nuevo y WhatsApp con el mensaje: el primer envío pasa a "enviado"; el recordatorio anota la fecha. */
async function prepararWhatsapp({ params, tx, admin, actor, request }, recordatorio) {
  return tx(async (c) => {
    const e = await uno(c, `SELECT e.id, ${ESTADO} AS estado, e.expira_en, p.id AS persona_id, p.nombre, p.telefono, r.numero
      FROM envio_feedback e JOIN inscripcion i ON i.id = e.inscripcion_id JOIN persona p ON p.id = i.piloto_persona_id
      JOIN ronda r ON r.id = i.ronda_id WHERE e.id = $1 FOR UPDATE OF e`, [params.id]);
    if (!e) throw new ErrorPanel(404, 'No existe ese envío.');
    if (!e.telefono) throw new ErrorPanel(400, 'No tiene teléfono.');
    if (e.estado === 'respondido') throw new ErrorPanel(400, 'Ya ha respondido.');
    if (e.estado === 'caducado') throw new ErrorPanel(400, 'El enlace ha caducado: ya no acepta respuestas.');
    if (recordatorio && e.estado === 'generado') throw new ErrorPanel(400, 'Todavía no se ha enviado: usa "Enviar".');
    const token = nuevoToken();
    await c.query(`UPDATE envio_feedback SET token_hash = $2, canal = 'whatsapp'${recordatorio ? ', recordatorio_en = now()' : ''} WHERE id = $1`, [e.id, hashToken(token)]);
    if (e.estado === 'generado') await c.query(`UPDATE envio_feedback SET estado = 'enviado' WHERE id = $1`, [e.id]);
    const dias = Math.max(1, Math.ceil((new Date(e.expira_en) - Date.now()) / 864e5));
    const texto = MENSAJES[recordatorio ? 'feedback_recordatorio' : 'feedback']({ nombre: pila(e.nombre), ronda: e.numero, dias, enlace: `${origen(request)}/feedback/${token}` });
    await c.query(`INSERT INTO interaccion (persona_id, tipo, resumen, ocurrida_en, admin_id, creado_por) VALUES ($1, 'whatsapp_saliente', $2, now(), $3, $4)`,
      [e.persona_id, `WhatsApp preparado: ${recordatorio ? 'recordatorio de feedback' : 'feedback'} de la R${e.numero}`, admin.id, actor]);
    return { url: `https://wa.me/${e.telefono.replace(/^\+/, '')}?text=${encodeURIComponent(texto)}`, texto };
  });
}
export const enviar = (ctx) => prepararWhatsapp(ctx, false);
export const recordar = (ctx) => prepararWhatsapp(ctx, true);

/** Exportación de lo que se ve (con el mismo filtro): una columna por pregunta. */
export async function exportar(ctx) {
  const { ronda: r, preguntas, envios } = await ronda(ctx);
  const formato = ctx.url.searchParams.get('formato') === 'xlsx' ? 'xlsx' : 'csv';
  const cols = [['piloto', 'Piloto'], ['telefono', 'Teléfono'], ['estado', 'Estado'], ['respondido_en', 'Respondido'],
    ...preguntas.map((p) => [`p:${p.id}`, p.texto])];
  const valor = (e, k) => {
    if (k.startsWith('p:')) { const v = e.respuestas?.[k.slice(2)]; return Array.isArray(v) ? v.join(', ') : v ?? ''; }
    if (k === 'respondido_en') return e.respondido_en ? new Date(e.respondido_en).toISOString().slice(0, 16).replace('T', ' ') : '';
    return e[k] ?? '';
  };
  const nombre = `rukc-feedback-R${r.numero}-${new Date().toISOString().slice(0, 10)}`;
  if (formato === 'csv') {
    const celda = (v) => (/[";\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lineas = [cols.map(([, t]) => celda(t)).join(';'), ...envios.map((e) => cols.map(([k]) => celda(valor(e, k))).join(';'))];
    return new Response(`﻿${lineas.join('\r\n')}\r\n`, { headers: {
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nombre}.csv"`, 'Cache-Control': 'no-store' } });
  }
  const libro = new ExcelJS.Workbook();
  libro.creator = 'RUKC';
  const hoja = libro.addWorksheet(`Feedback R${r.numero}`);
  hoja.columns = cols.map(([k, t]) => ({ header: t, key: k, width: Math.min(50, Math.max(12, t.length + 2)) }));
  for (const e of envios) hoja.addRow(Object.fromEntries(cols.map(([k]) => [k, valor(e, k)])));
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: 'frozen', ySplit: 1 }];
  return new Response(await libro.xlsx.writeBuffer(), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${nombre}.xlsx"`, 'Cache-Control': 'no-store' } });
}
