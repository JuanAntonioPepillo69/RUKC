// Datos de las imágenes semanales de inscritos: la próxima ronda y, por categoría, las plazas y la parrilla.
// Solo sale lo que ya es público: dorsal y nombre de competición (perfil_piloto.nombre_competicion, "así aparecerás en
// la clasificación"; si no hay ficha, nombre + inicial del apellido, como el trigger perfil_nombre_por_defecto).
// Nunca email, teléfono, edad ni peso.
// Cuentan las inscripciones con algún pago confirmado: reservada (reserva pagada), pagada y asistio.
import { consulta } from '../db.js';

export const CATEGORIAS = ['LIG', 'PES'];
export const ESTADOS_CON_PAGO = ['reservada', 'pagada', 'asistio'];

// Plazas que valen para la imagen aunque la BD diga otra cosa (las de cupo_ronda también controlan el cierre de la
// inscripción, por eso no se tocan). Clave: <temporada>-R<número>. Decidido por John el 2026-11-13: en la R2 de
// Campillos son 30 por categoría.
export const PLAZAS_IMAGEN = {
  'T2-R2': { LIG: 30, PES: 30 },
};

/** Fecha de hoy en Madrid (YYYY-MM-DD). */
export const hoyMadrid = (ahora = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);

/**
 * Próxima ronda: la primera de una temporada abierta o en curso, programada o aplazada, con fecha de hoy en adelante
 * (hora de Madrid). Cuando pasa una carrera, la siguiente consulta ya devuelve la ronda siguiente.
 */
export async function proximaRonda(ahora = new Date(), q = consulta) {
  const [r] = await q(
    `SELECT r.id, r.numero, r.fecha::text AS fecha, r.estado, c.nombre AS circuito, t.codigo AS temporada,
            (SELECT count(*)::int FROM ronda r2 WHERE r2.temporada_id = r.temporada_id) AS rondas_temporada
     FROM ronda r JOIN temporada t ON t.id = r.temporada_id JOIN circuito c ON c.id = r.circuito_id
     WHERE t.estado IN ('abierta', 'en_curso') AND r.estado IN ('programada', 'aplazada') AND r.fecha >= $1::date
     ORDER BY r.fecha, r.numero LIMIT 1`, [hoyMadrid(ahora)]);
  return r ?? null;
}

/** Ronda por id (para regenerar la imagen de un enlace firmado). */
export async function rondaPorId(id, q = consulta) {
  const [r] = await q(
    `SELECT r.id, r.numero, r.fecha::text AS fecha, r.estado, c.nombre AS circuito, t.codigo AS temporada,
            (SELECT count(*)::int FROM ronda r2 WHERE r2.temporada_id = r.temporada_id) AS rondas_temporada
     FROM ronda r JOIN temporada t ON t.id = r.temporada_id JOIN circuito c ON c.id = r.circuito_id
     WHERE r.id = $1`, [id]);
  return r ?? null;
}

const limpiarNombre = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Parrilla de una categoría en una ronda: { categoria, nombre, plazas, pilotos: [{ dorsal, nombre }] } en orden alfabético.
 * Si la categoría no tiene cupo en esa ronda, devuelve null.
 */
export async function parrilla(ronda, categoria, q = consulta) {
  if (!CATEGORIAS.includes(categoria)) throw new Error(`Categoría no válida: ${categoria}`);
  const [cupo] = await q(
    `SELECT cat.id, cat.nombre, cr.plazas
     FROM cupo_ronda cr JOIN categoria cat ON cat.id = cr.categoria_id
     WHERE cr.ronda_id = $1 AND cat.codigo = $2`, [ronda.id, categoria]);
  if (!cupo) return null;
  const filas = await q(
    `SELECT dt.dorsal,
            coalesce(nullif(btrim(pp.nombre_competicion), ''),
                     btrim(p.nombre || coalesce(' ' || upper(left(btrim(p.apellidos), 1)) || '.', ''))) AS nombre
     FROM inscripcion i
     JOIN persona p ON p.id = i.piloto_persona_id
     JOIN ronda r ON r.id = i.ronda_id
     LEFT JOIN perfil_piloto pp ON pp.persona_id = i.piloto_persona_id
     LEFT JOIN dorsal_temporada dt ON dt.persona_id = i.piloto_persona_id AND dt.temporada_id = r.temporada_id
     WHERE i.ronda_id = $1 AND i.categoria_id = $2 AND i.estado = ANY($3::text[]) AND p.estado = 'activa'`,
    [ronda.id, cupo.id, ESTADOS_CON_PAGO]);
  const pilotos = filas
    .map((f) => ({ dorsal: f.dorsal == null ? null : Number(f.dorsal), nombre: limpiarNombre(f.nombre) }))
    .filter((f) => f.nombre)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }) || (a.dorsal ?? 999) - (b.dorsal ?? 999));
  const forzadas = PLAZAS_IMAGEN[`${ronda.temporada}-R${ronda.numero}`]?.[categoria];
  return { categoria, nombre: cupo.nombre, plazas: forzadas ?? Number(cupo.plazas), pilotos };
}

/** Inscripciones con pago de la ronda que aún no tienen categoría: no salen en ninguna imagen (aviso para John). */
export async function sinCategoria(ronda, q = consulta) {
  const [f] = await q(
    `SELECT count(*)::int AS n FROM inscripcion WHERE ronda_id = $1 AND categoria_id IS NULL AND estado = ANY($2::text[])`,
    [ronda.id, ESTADOS_CON_PAGO]);
  return f?.n ?? 0;
}
