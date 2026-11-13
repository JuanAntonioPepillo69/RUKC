// Tareas programadas (D7: el plan Hobby solo permite una tarea diaria, así que todas van en una sola llamada a
// /api/cron, a las 03:00 UTC). Cada paso es independiente: si uno falla, se apunta el error en `evento` y siguen los
// demás. Nunca se reintenta solo; el panel avisa en "Hoy".
//   bizum         solicitudes con Bizum avisado y sin confirmar en 72 h → pago_abandonado (regla 6)
//   feedback      envíos de feedback sin responder con la fecha pasada → caducado
//   sorteo        borra los datos del sorteo de las rondas cerradas hace más de 30 días
//   copia         copia de seguridad cifrada en el almacén privado (30 diarias, 12 mensuales)
//   neon          consumo de cómputo de Neon del mes; aviso al pasar el 70 %
//   anonimizacion el día 1 de cada mes: cuántas personas tienen el plazo de conservación vencido (las confirma John)
import { conTransaccion } from './db.js';
import { hacerCopia } from './copia.js';
import { candidatos } from './rgpd.js';
import { RONDAS, DIAS_BORRAR_SORTEO } from '../src/config/feedback/rondas.js';

export const TAREAS = ['bizum', 'feedback', 'sorteo', 'copia', 'neon', 'anonimizacion'];
const HORAS_BIZUM = 72;

async function bizum(c) {
  const r = await c.query(`UPDATE solicitud_inscripcion SET estado = 'pago_abandonado'
    WHERE estado = 'enviada' AND metodo_elegido = 'bizum' AND enviada_en < now() - make_interval(hours => $1) RETURNING codigo`, [HORAS_BIZUM]);
  return { abandonadas: r.rowCount, codigos: r.rows.map((x) => x.codigo) };
}

async function feedback(c) {
  const r = await c.query(`UPDATE envio_feedback SET estado = 'caducado' WHERE estado IN ('generado', 'enviado', 'abierto') AND expira_en <= now()`);
  return { caducados: r.rowCount };
}

/** Borra los datos del sorteo de las rondas cerradas hace más de DIAS_BORRAR_SORTEO días (src/config/feedback/rondas.js). */
async function sorteo(c, ahora = new Date()) {
  const vencidas = RONDAS.filter((r) => ahora.getTime() > Date.parse(r.cierra) + DIAS_BORRAR_SORTEO * 86400000).map((r) => r.round_id);
  if (!vencidas.length) return { borradas: 0 };
  const r = await c.query('DELETE FROM raffle_entries WHERE round_id = ANY($1::text[])', [vencidas]);
  return { borradas: r.rowCount, rondas: vencidas };
}

/** Consumo de cómputo del mes del proyecto de Neon (API: compute_time_seconds, en CU-segundos). */
async function neon() {
  const clave = process.env.NEON_API_KEY;
  const proyecto = process.env.NEON_PROJECT_ID;
  if (!clave || !proyecto) throw new Error('Falta NEON_API_KEY o NEON_PROJECT_ID.');
  const res = await fetch(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(proyecto)}`, {
    headers: { Authorization: `Bearer ${clave}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Neon ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { project } = await res.json();
  const limite = Number(process.env.NEON_LIMITE_CU_HORAS || 100);   // plan Free: 100 CU-horas por proyecto y mes
  const horas = Math.round(((project.compute_time_seconds ?? 0) / 3600) * 10) / 10;
  return { cu_horas: horas, limite_cu_horas: limite, porcentaje: Math.round((horas / limite) * 100), aviso: horas / limite >= 0.7,
    periodo_desde: project.consumption_period_start ?? null, almacenamiento_mb: project.synthetic_storage_size ? Math.round(project.synthetic_storage_size / 1048576) : null };
}

async function anonimizacion(c) {
  const lista = await candidatos(c);
  return { candidatos: lista.length };
}

const PASOS = {
  bizum: (c) => bizum(c),
  feedback: (c) => feedback(c),
  sorteo: (c) => sorteo(c),
  copia: (c) => hacerCopia(c),
  neon: () => neon(),
  anonimizacion: (c) => anonimizacion(c),
};

/** Ejecuta las tareas pedidas (por defecto, las del día: la de anonimización solo el día 1). Nunca lanza. */
export async function ejecutar({ tareas = null, ahora = new Date(), origen = 'cron' } = {}) {
  const lista = tareas ?? TAREAS.filter((t) => t !== 'anonimizacion' || ahora.getUTCDate() === 1);
  const resultados = [];
  for (const t of lista) {
    const inicio = Date.now();
    let fila;
    try {
      const resultado = await conTransaccion((c) => PASOS[t](c), { actor: 'sistema' });
      fila = { tarea: t, ok: true, resultado, ms: Date.now() - inicio };
    } catch (e) {
      fila = { tarea: t, ok: false, error: String(e.message || e).slice(0, 500), ms: Date.now() - inicio };
    }
    resultados.push(fila);
    // El resultado (o el error) queda en el historial; si ni eso se puede guardar, al menos sale en el registro de Vercel.
    await conTransaccion((c) => c.query(`INSERT INTO evento (actor, entidad, entidad_id, accion, despues) VALUES ('sistema', 'tarea', $1, $2, $3)`,
      [t, fila.ok ? 'ok' : 'error', { origen, ms: fila.ms, ...(fila.ok ? { resultado: fila.resultado } : { error: fila.error }) }]), { actor: 'sistema' })
      .catch((e) => console.error('tarea', t, 'no se pudo apuntar en evento', e.message));
    if (!fila.ok) console.error('tarea', t, fila.error);
  }
  return { ok: resultados.every((r) => r.ok), resultados };
}
