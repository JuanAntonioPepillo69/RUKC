// F2 · Resumen diario para John (20:00 hora de Madrid). Sale solo si hay algo que mirar: temas escalados sin
// atender, conversaciones en sus manos, urgencias o envíos fallidos. Llega como texto si su ventana de 24 h está abierta
// y, si no, con la plantilla rukc_aviso_admin (enviarAJohn).
import { consulta } from '../db.js';
import { enviarAJohn, TEXTO_CORTE, TEXTO_URGENCIA } from './entrante.js';

const MAX_LISTA = 8;
const hora = (f) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(f);
const hoyLargo = (f = new Date()) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' }).format(f);

/** Datos del día (desde las 00:00 de Madrid) y lo pendiente ahora mismo. */
export async function datosDelDia() {
  const desde = `(date_trunc('day', now() AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid')`;
  const [act] = await consulta(
    `SELECT count(*) FILTER (WHERE m.direccion = 'entrada' AND m.autor = 'usuario')::int AS recibidos,
            count(DISTINCT m.contact_id) FILTER (WHERE m.direccion = 'entrada' AND m.autor = 'usuario')::int AS personas,
            count(*) FILTER (WHERE m.direccion = 'salida' AND m.autor = 'bot')::int AS respuestas_bot,
            count(*) FILTER (WHERE m.direccion = 'salida' AND m.autor = 'john_app')::int AS respuestas_john,
            count(*) FILTER (WHERE m.direccion = 'salida' AND m.autor = 'bot' AND m.cuerpo = $1)::int AS cortes,
            count(*) FILTER (WHERE m.direccion = 'salida' AND m.autor = 'bot' AND m.cuerpo = $2)::int AS urgencias_en_tus_manos
     FROM wa_messages m WHERE m.created_at >= ${desde}`, [TEXTO_CORTE, TEXTO_URGENCIA]);
  const escalados = await consulta(
    `SELECT c.display_name, c.phone_e164, v.motivo_escalado, v.temas_escalados, v.ultimo_mensaje_at
     FROM wa_conversations v JOIN wa_contacts c ON c.id = v.contact_id
     WHERE v.estado = 'escalada' AND c.rol <> 'admin'
     ORDER BY ('urgencia' = ANY(v.temas_escalados)) DESC, v.ultimo_mensaje_at`);
  const [manos] = await consulta(
    `SELECT count(*)::int AS n FROM wa_contacts
     WHERE rol <> 'admin' AND modo <> 'bot' AND (modo_hasta IS NULL OR modo_hasta > now())`);
  const [fallidos] = await consulta(
    `SELECT count(*)::int AS n FROM wa_messages WHERE direccion = 'salida' AND estado = 'fallido' AND created_at > now() - interval '24 hours'`);
  const [urg] = await consulta(
    `SELECT count(*)::int AS n FROM wa_conversations
     WHERE 'urgencia' = ANY(temas_escalados) AND ultimo_mensaje_at >= ${desde}`);
  // Rondas de los próximos 30 días a las que les falta la hora de llegada de alguna categoría o el Maps.
  const sinHorario = await consulta(
    `SELECT r.numero, r.fecha::text AS fecha,
            bool_or(coalesce(cr.hora_llegada, r.hora_acreditacion) IS NULL) AS falta_hora, (r.maps_url IS NULL) AS falta_maps
     FROM ronda r JOIN temporada t ON t.id = r.temporada_id JOIN cupo_ronda cr ON cr.ronda_id = r.id
     WHERE t.estado IN ('abierta', 'en_curso') AND r.estado IN ('programada', 'aplazada')
       AND r.fecha BETWEEN current_date AND current_date + 30
     GROUP BY r.id HAVING bool_or(coalesce(cr.hora_llegada, r.hora_acreditacion) IS NULL) OR r.maps_url IS NULL
     ORDER BY r.fecha`);
  return { ...act, escalados, en_tus_manos: manos.n, fallidos: fallidos.n, urgencias: urg.n + act.urgencias_en_tus_manos, sin_horario: sinHorario };
}

/** Texto del resumen, o null si no hay nada pendiente (entonces no se manda). */
export function textoResumen(d, ahora = new Date()) {
  const hayAlgo = d.escalados.length || d.en_tus_manos || d.fallidos || d.urgencias || d.sin_horario?.length;
  if (!hayAlgo) return null;
  const lineas = [`Resumen del bot · ${hoyLargo(ahora)}`];
  const pl = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  lineas.push(`Hoy: ${pl(d.recibidos, 'mensaje', 'mensajes')} de ${pl(d.personas, 'persona', 'personas')}. El bot ha contestado ${d.respuestas_bot} y tú ${d.respuestas_john}.`);
  if (d.urgencias) lineas.push(`Urgencias hoy: ${d.urgencias}.`);
  if (d.escalados.length) {
    lineas.push(`Pendientes de ti (${d.escalados.length}):`);
    for (const e of d.escalados.slice(0, MAX_LISTA)) {
      const quien = [e.display_name, e.phone_e164].filter(Boolean).join(' ');
      lineas.push(`- ${quien}: ${e.motivo_escalado ?? 'sin motivo'} (último mensaje ${hora(new Date(e.ultimo_mensaje_at))}) https://wa.me/${e.phone_e164.slice(1)}`);
    }
    if (d.escalados.length > MAX_LISTA) lineas.push(`- y ${d.escalados.length - MAX_LISTA} más.`);
  }
  if (d.en_tus_manos) lineas.push(`Conversaciones en tus manos (el bot calla): ${d.en_tus_manos}.`);
  if (d.cortes) lineas.push(`Charlas cortadas por fuera de tema: ${d.cortes}.`);
  if (d.fallidos) lineas.push(`Envíos fallidos en 24 h: ${d.fallidos}.`);
  for (const x of d.sin_horario ?? []) {
    const falta = [x.falta_hora ? 'la hora de llegada' : null, x.falta_maps ? 'el enlace de Maps' : null].filter(Boolean).join(' y ');
    lineas.push(`Falta ${falta} de la R${x.numero} (${x.fecha}). Escríbeme, por ejemplo: "la R${x.numero}, ligeros a las 15:00 y pesados a las 16:00".`);
  }
  return lineas.join('\n');
}

/** Monta y manda el resumen. Devuelve { enviado, motivo }. */
export async function enviarResumenDiario(deps = {}) {
  const texto = textoResumen(await datosDelDia());
  if (!texto) return { enviado: false, motivo: 'nada pendiente' };
  const envio = await enviarAJohn({ texto, automatizacion: 'F2', ...(deps.d ? { d: deps.d } : {}) });
  return { enviado: Boolean(envio.ok), pendiente: Boolean(envio.pendiente), texto };
}
