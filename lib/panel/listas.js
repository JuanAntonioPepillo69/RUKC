// Listas del panel: cada pantalla lee de una vista SQL con filtros combinables (Y), búsqueda, orden, paginación,
// vistas guardadas y exportación a CSV o XLSX de lo que se ve. Solo columnas de la lista blanca de cada vista.
// Datos sensibles: fuera por defecto; solo en la exportación de inscripciones, con casilla + confirmación, y queda
// registrado en evento. El número de documento nunca se exporta.
import ExcelJS from 'exceljs';
import { ErrorPanel } from '../admin.js';
import { descifrar } from '../cifrado.js';

const c = (col, titulo, tipo = 'texto') => ({ c: col, t: titulo, tipo });

export const VISTAS = {
  leads: {
    tabla: 'v_leads', id: 'id', extra: ['persona_id'], orden: 'proxima_accion_en ASC NULLS LAST',
    busca: ['persona', 'telefono', 'email', 'campana'],
    cols: [c('persona', 'Persona'), c('telefono', 'Teléfono'), c('email', 'Email'), c('etapa', 'Etapa'), c('origen', 'Origen'),
      c('canal', 'Canal'), c('campana', 'Campaña'), c('proxima_accion', 'Próxima acción'), c('proxima_accion_en', 'Fecha de la acción', 'fechahora'),
      c('accion_vencida', 'Vencida', 'bool'), c('ultima_interaccion_en', 'Última interacción', 'fechahora'), c('ultima_interaccion', 'Resumen')],
  },
  recuperar: {
    tabla: 'v_embudo', id: 'id', extra: ['persona_id'], fijo: `estado IN ('borrador', 'pago_abandonado', 'enviada')`,
    orden: 'coalesce(ultimo_guardado_en, creado_en) DESC', busca: ['codigo', 'pagador_nombre', 'pagador_telefono', 'pagador_email'],
    cols: [c('codigo', 'Código'), c('estado', 'Estado'), c('ronda', 'Ronda', 'num'), c('categoria', 'Categoría'), c('metodo', 'Método'),
      c('pagador_nombre', 'Nombre'), c('pagador_telefono', 'Teléfono'), c('pagador_email', 'Email'), c('piloto_nombre', 'Piloto'),
      c('canal', 'Canal'), c('utm_campaign', 'Campaña'), c('ultimo_guardado_en', 'Último guardado', 'fechahora'), c('horas_sin_pagar', 'Horas sin pagar', 'num')],
  },
  embudo: {
    tabla: 'v_embudo', id: 'id', extra: ['persona_id'], orden: 'creado_en DESC', busca: ['codigo', 'pagador_nombre', 'pagador_telefono'],
    cols: [c('codigo', 'Código'), c('estado', 'Estado'), c('ronda', 'Ronda', 'num'), c('categoria', 'Categoría'), c('metodo', 'Método'),
      c('pagador_nombre', 'Nombre'), c('pagador_telefono', 'Teléfono'), c('canal', 'Canal'), c('utm_source', 'Fuente'), c('utm_campaign', 'Campaña'),
      c('creado_en', 'Creada', 'fechahora'), c('pagada_en', 'Pagada', 'fechahora')],
  },
  personas: {
    tabla: 'v_persona_360', id: 'id', orden: 'creado_en DESC', busca: ['nombre', 'apellidos', 'telefono', 'email'],
    cols: [c('nombre', 'Nombre'), c('apellidos', 'Apellidos'), c('telefono', 'Teléfono'), c('email', 'Email'), c('municipio', 'Municipio'),
      c('estado', 'Estado'), c('es_piloto', 'Piloto', 'bool'), c('dorsal', 'Dorsal', 'num'), c('etapa', 'Etapa'),
      c('inscripciones_activas', 'Inscripciones', 'num'), c('saldo_pendiente_cent', 'Saldo pendiente', 'cent'), c('credito_cent', 'Crédito', 'cent'),
      c('onboarding', 'Onboarding'), c('grupo', 'Grupo'), c('primer_canal', 'Primer canal'), c('ultima_interaccion_en', 'Última interacción', 'fechahora')],
  },
  inscripciones: {
    tabla: 'v_inscripciones', id: 'id', extra: ['piloto_persona_id'], orden: 'ronda ASC, piloto ASC', busca: ['codigo', 'piloto', 'piloto_telefono', 'pagador'],
    cols: [c('codigo', 'Código'), c('ronda', 'Ronda', 'num'), c('ronda_fecha', 'Fecha', 'fecha'), c('circuito', 'Circuito'), c('piloto', 'Piloto'),
      c('nombre_competicion', 'Nombre de competición'), c('dorsal', 'Dorsal', 'num'), c('piloto_telefono', 'Teléfono'), c('categoria', 'Categoría'), c('categoria_origen', 'Origen de la categoría'),
      c('producto', 'Producto'), c('precio_cent', 'Precio', 'cent'), c('pagado_cent', 'Pagado', 'cent'), c('credito_cent', 'Crédito', 'cent'),
      c('saldo_cent', 'Saldo', 'cent'), c('estado', 'Estado'), c('sobrecupo', 'Sobrecupo', 'bool'), c('pagador', 'Pagador'),
      c('paga_otra_persona', 'Paga otra persona', 'bool'), c('onboarding', 'Onboarding'), c('grupo', 'Grupo'), c('feedback', 'Feedback'), c('pedido', 'Pedido')],
  },
  circuito: {
    // Lista para el circuito: solo lo que el circuito necesita.
    tabla: 'v_inscripciones', id: 'id', fijo: `estado IN ('pendiente_pago', 'reservada', 'pagada', 'asistio')`, orden: 'categoria ASC, dorsal ASC NULLS LAST, piloto ASC',
    busca: ['piloto'],
    cols: [c('ronda', 'Ronda', 'num'), c('categoria', 'Categoría'), c('categoria_origen', 'Origen de la categoría'), c('dorsal', 'Dorsal', 'num'), c('nombre_competicion', 'Nombre de competición'), c('piloto', 'Piloto')],
  },
  parrilla: {
    tabla: 'v_parrilla', id: 'ronda_id', orden: 'fecha ASC, categoria ASC', busca: ['circuito'],
    cols: [c('ronda', 'Ronda', 'num'), c('fecha', 'Fecha', 'fecha'), c('circuito', 'Circuito'), c('ronda_estado', 'Estado de la ronda'),
      c('categoria', 'Categoría'), c('plazas', 'Plazas', 'num'), c('inscritos', 'Inscritos', 'num'), c('pagados', 'Pagados', 'num'),
      c('reservados', 'Reservados', 'num'), c('libres', 'Libres', 'num'), c('en_sobrecupo', 'Sobrecupo', 'bool'), c('estado_cupo', 'Inscripción')],
  },
  pagos: {
    tabla: 'v_pagos', id: 'id', extra: ['pagador_persona_id'], orden: 'fecha DESC', busca: ['codigo', 'pagador', 'pagador_telefono', 'referencia_externa', 'inscripciones'],
    cols: [c('codigo', 'Código'), c('fecha', 'Fecha', 'fechahora'), c('metodo', 'Método'), c('importe_cent', 'Importe', 'cent'),
      c('reembolsado_cent', 'Reembolsado', 'cent'), c('aplicado_cent', 'Aplicado', 'cent'), c('sin_aplicar_cent', 'Sin aplicar', 'cent'),
      c('estado', 'Estado'), c('entidad', 'Entidad'), c('pagador', 'Pagador'), c('pagador_telefono', 'Teléfono'), c('inscripciones', 'Inscripciones'),
      c('referencia_externa', 'Referencia'), c('factura_ref', 'Factura'), c('sin_factura', 'Sin factura', 'bool'), c('ronda_cobro', 'Ronda de cobro', 'num'),
      c('cobrado_por', 'Cobrado por')],
  },
  caja: {
    tabla: 'v_caja', id: 'dia', orden: 'dia DESC, metodo ASC', busca: ['metodo', 'entidad'],
    cols: [c('dia', 'Día', 'fecha'), c('metodo', 'Método'), c('entidad', 'Entidad'), c('cobrado_cent', 'Cobrado', 'cent'),
      c('reembolsado_cent', 'Reembolsado', 'cent'), c('neto_cent', 'Neto', 'cent')],
  },
  onboarding: {
    tabla: 'v_onboarding', id: 'id', extra: ['persona_id'], orden: 'creado_en DESC', busca: ['piloto', 'telefono'],
    cols: [c('piloto', 'Piloto'), c('telefono', 'Teléfono'), c('temporada', 'Temporada'), c('estado', 'Estado'), c('paso_actual', 'Paso', 'num'),
      c('menor', 'Menor', 'bool'), c('tiene_tutor', 'Tutor', 'bool'), c('documentos_aceptados', 'Documentos', 'num'), c('tiene_foto', 'Foto', 'bool'),
      c('grupo', 'Grupo'), c('completado_en', 'Completado', 'fechahora')],
  },
  creditos: {
    tabla: 'v_creditos', id: 'persona_id', orden: 'saldo_cent DESC', busca: ['persona', 'telefono'],
    cols: [c('persona', 'Persona'), c('telefono', 'Teléfono'), c('saldo_cent', 'Saldo', 'cent'), c('ultimo_movimiento_en', 'Último movimiento', 'fechahora'),
      c('caducidad_proxima', 'Caducidad más próxima', 'fechahora')],
  },
  eventos: {
    tabla: 'evento', id: 'id', orden: 'id DESC', busca: ['actor', 'entidad', 'entidad_id', 'accion'],
    cols: [c('ocurrido_en', 'Fecha', 'fechahora'), c('actor', 'Quién'), c('entidad', 'Tabla'), c('entidad_id', 'Registro'), c('accion', 'Acción'),
      c('antes', 'Antes', 'json'), c('despues', 'Después', 'json')],
  },
};

const OPERADORES = ['eq', 'ne', 'contiene', 'gte', 'lte', 'vacio', 'no_vacio', 'si', 'no', 'in'];
const POR_PAGINA = 50;

function vista(nombre) {
  const v = VISTAS[nombre];
  if (!v) throw new ErrorPanel(404, 'No existe esa lista.');
  return v;
}

/** WHERE parametrizado a partir de los filtros (?f=[{c,op,v}]) y la búsqueda (?q=). Solo columnas de la lista blanca. */
export function construirWhere(v, url, params = []) {
  const cond = v.fijo ? [`(${v.fijo})`] : [];
  const validas = new Set([...v.cols.map((x) => x.c), ...(v.extra ?? []), v.id]);
  let filtros = [];
  try { filtros = JSON.parse(url.searchParams.get('f') || '[]'); } catch { throw new ErrorPanel(400, 'Filtros no válidos.'); }
  if (!Array.isArray(filtros)) throw new ErrorPanel(400, 'Filtros no válidos.');
  for (const f of filtros) {
    if (!validas.has(f?.c) || !OPERADORES.includes(f?.op)) throw new ErrorPanel(400, `Filtro no válido: ${f?.c ?? ''}`);
    const col = `"${f.c}"`;
    const p = () => { params.push(f.v); return `$${params.length}`; };
    switch (f.op) {
      case 'eq': cond.push(`${col}::text = ${p()}::text`); break;
      case 'ne': cond.push(`${col}::text IS DISTINCT FROM ${p()}::text`); break;
      case 'contiene': cond.push(`${col}::text ILIKE '%' || ${p()}::text || '%'`); break;
      case 'gte': cond.push(`${col} >= ${p()}`); break;
      case 'lte': cond.push(`${col} <= ${p()}`); break;
      case 'vacio': cond.push(`${col} IS NULL`); break;
      case 'no_vacio': cond.push(`${col} IS NOT NULL`); break;
      case 'si': cond.push(`${col} IS TRUE`); break;
      case 'no': cond.push(`${col} IS NOT TRUE`); break;
      case 'in': if (!Array.isArray(f.v)) throw new ErrorPanel(400, 'Filtro no válido.'); cond.push(`${col}::text = ANY(${p()}::text[])`); break;
    }
  }
  const q = (url.searchParams.get('q') || '').trim();
  if (q) {
    params.push(q);
    cond.push(`(${v.busca.map((b) => `"${b}"::text ILIKE '%' || $${params.length} || '%'`).join(' OR ')})`);
  }
  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}

function ordenar(v, url) {
  const col = url.searchParams.get('o');
  if (col && v.cols.some((x) => x.c === col)) return `"${col}" ${url.searchParams.get('d') === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`;
  return v.orden;
}

const seleccion = (v) => [v.id, ...(v.extra ?? []), ...v.cols.map((x) => x.c)]
  .filter((x, i, a) => a.indexOf(x) === i)
  .map((x) => (v.cols.find((k) => k.c === x)?.tipo === 'json' ? `"${x}"::text AS "${x}"` : `"${x}"`)).join(', ');

/** GET /api/admin/lista/:vista?f=&q=&o=&d=&pagina= */
export async function lista({ params, url, tx }) {
  const v = vista(params.vista);
  const { where, params: p } = construirWhere(v, url);
  const pagina = Math.max(0, Number(url.searchParams.get('pagina')) || 0);
  return tx(async (cl) => {
    const filas = (await cl.query(`SELECT ${seleccion(v)} FROM ${v.tabla} ${where} ORDER BY ${ordenar(v, url)} LIMIT ${POR_PAGINA} OFFSET ${pagina * POR_PAGINA}`, p)).rows;
    const total = (await cl.query(`SELECT count(*)::int AS n FROM ${v.tabla} ${where}`, p)).rows[0].n;
    return { columnas: v.cols, id: v.id, filas, total, pagina, por_pagina: POR_PAGINA };
  });
}

const valor = (col, x) => {
  if (x == null) return '';
  if (col.tipo === 'cent') return Number(x) / 100;
  if (col.tipo === 'bool') return x ? 'sí' : 'no';
  if (col.tipo === 'fecha') return String(x).slice(0, 10);
  if (col.tipo === 'fechahora') return new Date(x).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
  return x;
};
const cabecera = (col) => (col.tipo === 'cent' ? `${col.t} (€)` : col.t);
const csv = (s) => { const t = String(s ?? ''); return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

/** GET /api/admin/exportar/:vista?formato=csv|xlsx&...filtros (&sensibles=1&confirmo=1 solo en inscripciones) */
export async function exportar({ params, url, tx, admin, actor }) {
  const v = vista(params.vista);
  const formato = url.searchParams.get('formato') === 'xlsx' ? 'xlsx' : 'csv';
  const sensibles = url.searchParams.get('sensibles') === '1';
  if (sensibles && (params.vista !== 'inscripciones' || url.searchParams.get('confirmo') !== '1')) {
    throw new ErrorPanel(400, 'Los datos sensibles solo se exportan desde Inscripciones y con confirmación.');
  }
  const { where, params: p } = construirWhere(v, url);
  const cols = [...v.cols];
  let sql = `SELECT ${seleccion(v)} FROM ${v.tabla} ${where} ORDER BY ${ordenar(v, url)} LIMIT 10000`;
  // El documento de identidad completo (descifrado) solo sale para el propietario; el operador ve los últimos 3.
  const documento = sensibles && admin.rol === 'propietario';
  if (sensibles) {
    cols.push(c('fecha_nacimiento', 'Fecha de nacimiento', 'fecha'), c('peso_declarado_kg', 'Peso declarado (kg)', 'num'));
    if (documento) cols.push(c('documento_tipo', 'Tipo de documento'), c('documento', 'Documento'));
    else cols.push(c('documento_ultimos3', 'Documento (últimos 3)'));
    sql = `SELECT x.*, ds.fecha_nacimiento::text AS fecha_nacimiento, ds.peso_declarado_kg, ds.documento_tipo, ds.documento_ultimos3
           ${documento ? ', ds.documento_cifrado' : ''} FROM (${sql}) x
           LEFT JOIN datos_sensibles_piloto ds ON ds.persona_id = x.piloto_persona_id`;
  }
  const filas = await tx(async (cl) => {
    const r = (await cl.query(sql, p)).rows;
    if (documento) {
      for (const f of r) {
        f.documento = f.documento_cifrado ? descifrar(f.documento_cifrado) : '';
        delete f.documento_cifrado;
      }
    }
    if (sensibles) {
      const columnas = ['fecha_nacimiento', 'peso_declarado_kg', ...(documento ? ['documento_tipo', 'documento'] : ['documento_ultimos3'])];
      await cl.query(`INSERT INTO evento (actor, entidad, entidad_id, accion, despues, ip) VALUES ($1, 'exportacion', $2, 'exportacion_sensible', $3, current_setting('rukc.ip', true))`,
        [actor, params.vista, { filas: r.length, columnas, filtros: url.searchParams.get('f'), admin: admin.email }]);
    }
    return r;
  });
  const nombre = `rukc-${params.vista}-${new Date().toISOString().slice(0, 10)}`;
  if (formato === 'csv') {
    const lineas = [cols.map((x) => csv(cabecera(x))).join(';'), ...filas.map((f) => cols.map((x) => csv(valor(x, f[x.c]))).join(';'))];
    return new Response(`﻿${lineas.join('\r\n')}\r\n`, { headers: {
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nombre}.csv"`, 'Cache-Control': 'no-store' } });
  }
  const libro = new ExcelJS.Workbook();
  libro.creator = 'RUKC';
  const hoja = libro.addWorksheet(params.vista.slice(0, 31));
  hoja.columns = cols.map((x) => ({ header: cabecera(x), key: x.c, width: Math.min(40, Math.max(10, cabecera(x).length + 2)),
    style: x.tipo === 'cent' ? { numFmt: '#,##0.00' } : {} }));
  for (const f of filas) hoja.addRow(Object.fromEntries(cols.map((x) => [x.c, valor(x, f[x.c])])));
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: 'frozen', ySplit: 1 }];
  const buf = await libro.xlsx.writeBuffer();
  return new Response(buf, { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${nombre}.xlsx"`, 'Cache-Control': 'no-store' } });
}

/** Vistas guardadas por pantalla para el administrador. */
export async function vistasGuardadas({ params, admin, tx }) {
  return tx(async (cl) => ({ vistas: (await cl.query(
    'SELECT id, nombre, filtros FROM vista_guardada WHERE admin_id = $1 AND pantalla = $2 ORDER BY nombre', [admin.id, params.pantalla])).rows }));
}
export async function guardarVista({ body, admin, tx }) {
  const nombre = String(body.nombre || '').trim().slice(0, 60);
  if (!nombre || !VISTAS[body.pantalla]) throw new ErrorPanel(400, 'Pon un nombre a la vista.');
  return tx(async (cl) => (await cl.query(
    `INSERT INTO vista_guardada (admin_id, pantalla, nombre, filtros, creado_por) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (admin_id, pantalla, nombre) DO UPDATE SET filtros = EXCLUDED.filtros RETURNING id`,
    [admin.id, body.pantalla, nombre, body.filtros ?? {}, `admin:${admin.id}`])).rows[0]);
}
export async function borrarVista({ params, admin, tx }) {
  await tx((cl) => cl.query('DELETE FROM vista_guardada WHERE id = $1 AND admin_id = $2', [params.id, admin.id]));
  return { ok: true };
}
