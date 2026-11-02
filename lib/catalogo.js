// Catálogo vigente para el formulario de inscripción: temporada abierta, rondas futuras con el estado de cupo por
// categoría, precios, importe de reserva y textos/versiones de los documentos que se aceptan.

// Versiones de los textos legales publicados en la web mientras no haya versiones activadas en documento_legal.
export const VERSIONES_WEB = {
  condiciones_reserva: 'web-2026-10-22',
  privacidad: 'web-2026-10-22',
};

// Texto provisional del aviso de borradores mientras el documento legal "aviso_borradores" esté en BORRADOR.
export const AVISO_BORRADORES_PROVISIONAL =
  'Guardamos lo que escribes en este formulario mientras lo rellenas, para poder ayudarte a terminar la reserva ' +
  'si te quedas a medias.';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** "2026-11-21" → "sáb 21 nov" */
export function fechaCorta(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
}

const fechaIso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** Lee el catálogo con una función de consulta `q(texto, params) → filas`. */
export async function leerCatalogo(q) {
  const [t] = await q(
    `SELECT id, codigo, nombre, importe_reserva_cent FROM temporada
     WHERE estado IN ('abierta', 'en_curso') ORDER BY inicio DESC NULLS LAST LIMIT 1`);
  if (!t) return null;

  const rondas = await q(
    `SELECT r.id, r.numero, r.fecha::text AS fecha, r.estado, r.notas, c.nombre AS circuito
     FROM ronda r JOIN circuito c ON c.id = r.circuito_id
     WHERE r.temporada_id = $1 AND r.estado IN ('programada', 'aplazada')
       AND r.fecha >= (now() AT TIME ZONE 'Europe/Madrid')::date
     ORDER BY r.fecha, r.numero`, [t.id]);
  const cupos = await q(
    `SELECT v.ronda_id, v.categoria, c.nombre, v.plazas, v.inscritos, v.libres, v.estado_cupo
     FROM v_parrilla v JOIN categoria c ON c.id = v.categoria_id
     WHERE v.ronda_id = ANY($1::uuid[]) ORDER BY c.orden`, [rondas.map((r) => r.id)]);
  const [precio] = await q(
    `SELECT precio_vigente_cent(id) AS cent FROM producto WHERE temporada_id = $1 AND codigo = 'carrera_suelta' AND activo`, [t.id]);
  const docs = await q(
    `SELECT DISTINCT ON (tipo) tipo, version, contenido_md FROM documento_legal
     WHERE tipo IN ('aviso_borradores', 'condiciones_reserva', 'privacidad')
       AND vigente_desde <= now() AND (vigente_hasta IS NULL OR vigente_hasta > now())
     ORDER BY tipo, vigente_desde DESC`);
  const doc = (tipo) => docs.find((d) => d.tipo === tipo);

  return {
    temporada: { codigo: t.codigo, nombre: t.nombre },
    reserva_cent: t.importe_reserva_cent,
    carrera_cent: precio?.cent ?? null,
    rondas: rondas.map((r) => ({
      id: r.id,
      numero: r.numero,
      fecha: fechaIso(r.fecha),
      fecha_corta: fechaCorta(fechaIso(r.fecha)),
      circuito: r.circuito,
      aplazada: r.estado === 'aplazada',
      notas: r.notas,
      categorias: cupos.filter((c) => c.ronda_id === r.id).map((c) => ({
        codigo: c.categoria, nombre: c.nombre, estado: c.estado_cupo,
        plazas: Number(c.plazas), libres: Number(c.libres),
      })),
    })),
    aviso_borradores: doc('aviso_borradores')
      ? { texto: doc('aviso_borradores').contenido_md, version: doc('aviso_borradores').version, provisional: false }
      : { texto: AVISO_BORRADORES_PROVISIONAL, version: 'provisional', provisional: true },
    documentos: {
      condiciones_reserva: doc('condiciones_reserva')?.version ?? VERSIONES_WEB.condiciones_reserva,
      privacidad: doc('privacidad')?.version ?? VERSIONES_WEB.privacidad,
    },
  };
}
