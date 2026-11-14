// Respuestas al recordatorio de una semana (D1, especificación 3a): el botón «Confirmo asistencia» o un «no puedo ir»
// escrito (lo detecta el bot y llama a la herramienta registrar_asistencia).
// Se anota en la fila D1 de wa_outbox de ese contacto y ronda (variables.respuesta, con las inscripciones a las que se
// refiere); si aún no hay fila (avisa antes del D1), se crea una ya cancelada para que el D1 no le llegue.
// - no va: no recibe el recordatorio de la víspera (D2, programador.js) y a John se le avisa una vez, para que libere
//   o mueva la plaza desde el panel. La plaza no se toca sola.
// - confirma: solo se anota (sale en ver_estado de la ronda).
import { consulta } from '../db.js';

const uno = async (t, p) => (await consulta(t, p))[0] ?? null;

/** Inscripciones con plaza de un teléfono (como piloto, quien pagó o tutor) en rondas que aún no se han corrido. */
async function plazasProximas(telefono) {
  return consulta(
    `SELECT i.id, r.id AS ronda_id, r.numero, r.fecha::text AS fecha, pil.nombre AS piloto
     FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id
     JOIN persona pil ON pil.id = i.piloto_persona_id
     JOIN pedido pe ON pe.id = i.pedido_id JOIN persona pag ON pag.id = pe.pagador_persona_id
     WHERE i.estado IN ('reservada', 'pagada') AND r.estado IN ('programada', 'aplazada')
       AND r.fecha >= (now() AT TIME ZONE 'Europe/Madrid')::date
       AND ($1 IN (pil.telefono, pag.telefono)
            OR pil.id IN (SELECT tu.menor_persona_id FROM tutela tu JOIN persona pt ON pt.id = tu.tutor_persona_id WHERE pt.telefono = $1))
     ORDER BY r.fecha, pil.nombre`, [telefono]);
}

/**
 * Registra si el contacto va o no a una ronda (la indicada, "R2", o la próxima en la que tiene plaza).
 * Devuelve { ok, ronda, respuesta, pilotos } o { ok: false, motivo }. d: { enviarAJohn } para los tests.
 */
export async function registrarAsistencia(contacto, { va, ronda = null, cita = '' }, d = {}) {
  const plazas = await plazasProximas(contacto.phone_e164);
  const numero = ronda ? Number(String(ronda).replace(/\D/g, '')) : null;
  const objetivo = numero ? plazas.filter((p) => p.numero === numero) : plazas.filter((p) => p.ronda_id === plazas[0]?.ronda_id);
  if (!objetivo.length) return { ok: false, motivo: ronda ? `no tiene plaza en la ${ronda}` : 'no tiene plaza en ninguna ronda próxima' };
  const r = objetivo[0];
  const respuesta = va ? 'confirma' : 'no_va';
  const datos = { respuesta, respuesta_at: new Date().toISOString(), cita: String(cita).slice(0, 300), inscripciones: objetivo.map((p) => p.id) };
  const clave = `D1:R${r.numero}:${contacto.phone_e164}`;
  const previa = await uno(`SELECT variables->>'respuesta' AS respuesta FROM wa_outbox WHERE idempotency_key = $1`, [clave]);
  await consulta(
    `INSERT INTO wa_outbox (contact_id, automatizacion, ronda_id, variables, enviar_at, estado, idempotency_key, ultimo_error)
     VALUES ($1, 'D1', $2, $3, now(), 'cancelado', $4, 'respondió antes del recordatorio')
     ON CONFLICT (idempotency_key) DO UPDATE SET variables = wa_outbox.variables || EXCLUDED.variables,
       estado = CASE WHEN $5 AND wa_outbox.estado IN ('pendiente_confirmacion', 'confirmado') THEN 'cancelado' ELSE wa_outbox.estado END`,
    [contacto.id, r.ronda_id, JSON.stringify(datos), clave, !va]);

  const pilotos = [...new Set(objetivo.map((p) => p.piloto))];
  if (!va && previa?.respuesta !== 'no_va') {
    const { enviarAJohn } = d.enviarAJohn ? d : await import('./entrante.js');
    await enviarAJohn({
      texto: `${contacto.display_name || 'Un contacto'} (${contacto.phone_e164}) avisa de que ${pilotos.join(' y ')} no va a la R${r.numero}: «${datos.cita}». `
        + 'No recibirá el recordatorio de la víspera. La plaza sigue reservada: si quieres liberarla o moverla, hazlo desde el panel.',
      automatizacion: 'A4',
    });
  }
  return { ok: true, ronda: `R${r.numero}`, respuesta, pilotos };
}

/** Inscripciones de una ronda cuyo contacto avisó de que no va (para excluirlas del D2). */
export async function inscripcionesQueNoVan(rondaId) {
  const filas = await consulta(
    `SELECT DISTINCT jsonb_array_elements_text(variables->'inscripciones') AS id FROM wa_outbox
     WHERE automatizacion = 'D1' AND ronda_id = $1 AND variables->>'respuesta' = 'no_va'`, [rondaId]);
  return new Set(filas.map((f) => f.id));
}

/** Recuento de respuestas al D1 de una ronda. */
export async function respuestasRonda(rondaId) {
  const [n] = await consulta(
    `SELECT count(*) FILTER (WHERE variables->>'respuesta' = 'confirma')::int AS confirman,
            count(*) FILTER (WHERE variables->>'respuesta' = 'no_va')::int AS no_van
     FROM wa_outbox WHERE automatizacion = 'D1' AND ronda_id = $1`, [rondaId]);
  return n;
}
