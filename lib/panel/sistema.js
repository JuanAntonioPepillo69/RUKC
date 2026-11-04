// Panel de la fase 6: Documentos (versiones, revisión del abogado, activar), RGPD (solicitudes con plazo de un mes,
// exportar todo lo de una persona, anonimizar y candidatos con el plazo vencido) y sistema (estado de las tareas
// programadas, consumo de Neon y copias de seguridad).
import { ErrorPanel } from '../admin.js';
import { leerArchivo, listarArchivos } from '../archivos.js';
import { activar } from '../documentos.js';
import * as R from '../rgpd.js';
import * as V from '../validacion/panel.js';

const val = (esquema, datos) => V.validar(esquema, datos, ErrorPanel);
const uno = async (c, t, p) => (await c.query(t, p)).rows[0];
const filas = async (c, t, p) => (await c.query(t, p)).rows;

// ---------- Documentos legales ----------

export async function documentos({ tx }) {
  return tx(async (c) => ({
    documentos: await filas(c, `SELECT d.id, d.tipo, d.version, d.titulo, d.obligatorio_onboarding, d.revocable, d.revisado_abogado_en::text AS revisado_abogado_en,
        d.vigente_desde, d.vigente_hasta, d.hash_sha256, length(d.contenido_md) AS caracteres, d.creado_en,
        (d.vigente_desde IS NOT NULL AND d.vigente_desde <= now() AND (d.vigente_hasta IS NULL OR d.vigente_hasta > now())) AS vigente,
        (SELECT count(*)::int FROM aceptacion a WHERE a.documento_legal_id = d.id) AS aceptaciones
      FROM documento_legal d ORDER BY d.tipo, d.creado_en DESC`),
  }));
}

export async function documento({ params, tx }) {
  const d = await tx((c) => uno(c, 'SELECT id, tipo, version, titulo, contenido_md, obligatorio_onboarding, revocable FROM documento_legal WHERE id = $1', [params.id]));
  if (!d) throw new ErrorPanel(404, 'No existe ese documento.');
  return { documento: d };
}

/** Nueva versión (sin activar). Los textos legales los redacta y revisa el abogado: aquí solo se pegan. */
export async function crearDocumento({ body, tx, actor }) {
  const d = val(V.documento, body);
  const r = await tx((c) => uno(c, `INSERT INTO documento_legal (tipo, version, titulo, contenido_md, obligatorio_onboarding, revocable, creado_por)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [d.tipo, d.version, d.titulo, d.contenido_md, d.obligatorio_onboarding, d.revocable, actor]));
  return { id: r.id };
}

/** Editar el texto solo mientras no esté activada ni aceptada (lo impide también la base de datos). */
export async function editarDocumento({ params, body, tx }) {
  const d = val(V.documento, body);
  await tx((c) => c.query(`UPDATE documento_legal SET version = $2, titulo = $3, contenido_md = $4, obligatorio_onboarding = $5, revocable = $6
    WHERE id = $1 AND tipo = $7`, [params.id, d.version, d.titulo, d.contenido_md, d.obligatorio_onboarding, d.revocable, d.tipo]));
  return { ok: true };
}

export async function revisarDocumento({ params, body, tx }) {
  const { revisado_abogado_en } = val(V.revisionAbogado, body);
  await tx((c) => c.query('UPDATE documento_legal SET revisado_abogado_en = $2 WHERE id = $1 AND vigente_desde IS NULL', [params.id, revisado_abogado_en]));
  return { ok: true };
}

export async function activarDocumento({ params, tx }) {
  return tx((c) => activar(c, params.id));
}

// ---------- RGPD ----------

export async function rgpd({ tx }) {
  return tx(async (c) => ({
    solicitudes: await filas(c, `SELECT s.id, s.contacto, s.tipo, s.estado, s.resolucion, s.recibida_en, s.vence_en, s.persona_id,
        btrim(p.nombre || ' ' || coalesce(p.apellidos, '')) AS persona, ceil(extract(epoch FROM s.vence_en - now()) / 86400)::int AS dias
      FROM solicitud_rgpd s LEFT JOIN persona p ON p.id = s.persona_id ORDER BY s.estado = 'pendiente' DESC, s.vence_en`),
    candidatos: await R.candidatos(c),
  }));
}

export async function nuevaSolicitud({ body, tx, actor }) {
  const d = val(V.solicitudRgpd, body);
  const r = await tx((c) => uno(c, `INSERT INTO solicitud_rgpd (contacto, tipo, persona_id, recibida_en, creado_por)
    VALUES ($1, $2, $3, coalesce($4::date::timestamptz, now()), $5) RETURNING id, vence_en`, [d.contacto, d.tipo, d.persona_id ?? null, d.recibida_en ?? null, actor]));
  return r;
}

export async function resolverSolicitud({ params, body, tx }) {
  const d = val(V.resolverRgpd, body);
  const r = await tx((c) => c.query(`UPDATE solicitud_rgpd SET estado = $2, resolucion = $3 WHERE id = $1 AND estado = 'pendiente'`, [params.id, d.estado, d.resolucion]));
  if (!r.rowCount) throw new ErrorPanel(404, 'No existe esa solicitud o ya está cerrada.');
  return { ok: true };
}

/** Acceso y portabilidad: todo lo de una persona en un JSON (queda en el historial quién lo descargó). */
export async function exportarPersona({ params, tx, actor, admin }) {
  const datos = await tx(async (c) => {
    const d = await R.exportar(c, params.id);
    await c.query(`INSERT INTO evento (actor, entidad, entidad_id, accion, despues, ip) VALUES ($1, 'persona', $2, 'exportacion_rgpd', $3, current_setting('rukc.ip', true))`,
      [actor, params.id, { admin: admin.email }]);
    return d;
  });
  return new Response(JSON.stringify(datos, null, 2), { headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="rukc-datos-${params.id.slice(0, 8)}.json"`, 'Cache-Control': 'no-store' } });
}

export async function anonimizarPersona({ params, body, tx }) {
  const { motivo } = val(V.anonimizar, body);
  return R.anonimizarConFoto(tx, params.id, motivo);
}

// ---------- Sistema: tareas, consumo de Neon y copias ----------

/** Última ejecución de cada tarea, los errores desde su último éxito y el último consumo de Neon. */
export async function estadoTareas(c) {
  const ultimas = await filas(c, `SELECT DISTINCT ON (entidad_id) entidad_id AS tarea, accion, ocurrido_en, despues FROM evento
    WHERE entidad = 'tarea' ORDER BY entidad_id, ocurrido_en DESC`);
  const neon = await uno(c, `SELECT despues -> 'resultado' AS r, ocurrido_en FROM evento WHERE entidad = 'tarea' AND entidad_id = 'neon' AND accion = 'ok' ORDER BY ocurrido_en DESC LIMIT 1`);
  const anon = await uno(c, `SELECT (despues -> 'resultado' ->> 'candidatos')::int AS n, ocurrido_en FROM evento WHERE entidad = 'tarea' AND entidad_id = 'anonimizacion' AND accion = 'ok' ORDER BY ocurrido_en DESC LIMIT 1`);
  return {
    ultimas: ultimas.map((u) => ({ tarea: u.tarea, ok: u.accion === 'ok', cuando: u.ocurrido_en, error: u.despues?.error ?? null })),
    errores: ultimas.filter((u) => u.accion === 'error').map((u) => ({ tarea: u.tarea, cuando: u.ocurrido_en, error: u.despues?.error ?? '' })),
    neon: neon ? { ...neon.r, cuando: neon.ocurrido_en } : null,
    anonimizacion: anon ? { candidatos: anon.n, cuando: anon.ocurrido_en } : null,
  };
}

export async function sistema({ tx }) {
  const estado = await tx((c) => estadoTareas(c));
  const copias = [...await listarArchivos('copias/diaria/'), ...await listarArchivos('copias/mensual/')];
  return { ...estado, copias };
}

/** Descarga de una copia (sigue cifrada: sin RUKC_BACKUP_KEY no se puede abrir). Solo el propietario. */
export async function descargarCopia({ url }) {
  // `copia`, no `ruta`: la reescritura de vercel.json ya usa ?ruta= para el camino del panel.
  const ruta = url.searchParams.get('copia') ?? '';
  if (!/^copias\/(diaria|mensual)\/[\d-]+\.rukc$/.test(ruta)) throw new ErrorPanel(400, 'Copia no válida.');
  const buf = await leerArchivo(ruta);
  if (!buf) throw new ErrorPanel(404, 'No existe esa copia.');
  return new Response(buf, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="rukc-${ruta.split('/').slice(1).join('-')}"`, 'Cache-Control': 'no-store' } });
}
