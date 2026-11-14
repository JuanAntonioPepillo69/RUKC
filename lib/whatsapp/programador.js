// Fase 3 · Programador de recordatorios (especificación 3a, D1 a D3; cron /api/wa/programador cada 5 minutos).
// - D1, una semana antes: a las 12:00 a John le llega la propuesta (destinatarios, ejemplo y código); sale a las 18:00
//   si la confirma. Sin CONFIRMO a las 18:00 no sale y se le avisa; si confirma antes de las 21:30, sale al confirmar.
// - D2, la víspera: igual, propuesta a las 12:00 y envío a las 19:00.
// - D3, dos días antes: a las 12:00, borrador del mensaje para el grupo de pilotos, solo a John.
// - E1, el día siguiente: a las 10:00, propuesta del feedback (rukc_feedback_ronda con el botón /feedback/<slug>, el
//   formulario anónimo de la ronda en src/config/feedback/rondas.js; el mismo enlace para todos) a los pilotos marcados
//   como "asistió" en el panel; sale a las 12:00. Si nadie está marcado, o la ronda no tiene formulario configurado, se
//   avisa a John (una vez al día, hasta tres días después) y se propone en cuanto esté.
// - C2, el sábado anterior al cierre de inscripción (martes antes de la ronda): a las 10:00, propuesta del aviso de la
//   ronda (rukc_nueva_ronda, comercial) a los contactos con consentimiento comercial vigente, sin plaza en ella y sin
//   mensajes en 3 días; sale a las 12:00 con CONFIRMO. Antes de cada envío se vuelve a comprobar el consentimiento.
// Destinatarios: inscritos con plaza reservada o pagada; si el piloto es menor, su tutor (y el menor si tiene teléfono).
// Nunca a quien se dio de baja del todo. Una sola vez por automatización, ronda y teléfono (idempotency_key).
// La cola manda de 9:30 a 21:30 (bot_settings); lo que vence fuera de horario espera a las 9:30 y se anula si la
// ronda ya pasó. Reintentos a 1, 5 y 30 minutos.
import { consulta } from '../db.js';
import { proponerAccion } from '../bot/admin.js';
import { asegurarContacto, conversacionActual, enviarAJohn } from './entrante.js';
import { enviar as enviarYcloud } from './client.js';
import { construirPlantilla } from './templates.js';
import { rondaPorId } from '../../src/config/feedback/rondas.js';
import { martesAnterior } from '../bot/datos.js';

const uno = async (t, p) => (await consulta(t, p))[0] ?? null;
const pila = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const euros = (cent) => { const v = Math.max(0, Number(cent) || 0) / 100; return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ','); };
const fechaLarga = (iso) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' })
  .format(new Date(`${iso}T12:00:00Z`));
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);
export const REINTENTOS_MIN = [1, 5, 30];

/** Fecha (YYYY-MM-DD) y hora (HH:MM) en Madrid de un instante. */
export function madrid(ahora = new Date()) {
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ahora);
  const [fecha, hora] = f.split(' ');
  return { fecha, hora };
}
const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export const AUTOMATIZACIONES = {
  D1: { dias: 7, propuesta: '12:00', envio: '18:00', limite: '21:30', plantilla: 'rukc_recordatorio_semana', nombre: 'recordatorio de una semana' },
  D2: { dias: 1, propuesta: '12:00', envio: '19:00', limite: '21:30', plantilla: 'rukc_recordatorio_manana', nombre: 'recordatorio de la víspera' },
  E1: { dias: -1, propuesta: '10:00', envio: '12:00', limite: '21:30', plantilla: 'rukc_feedback_ronda', nombre: 'mensaje de feedback' },
  // C2 no va por días antes de la ronda: el sábado anterior al cierre de inscripción (el martes antes de la ronda).
  C2: { propuesta: '10:00', envio: '12:00', limite: '21:30', plantilla: 'rukc_nueva_ronda', nombre: 'aviso de la próxima ronda' },
};
const DIAS_REINTENTO_E1 = 3;  // hasta cuántos días después de la ronda se sigue esperando a que se marque la asistencia

// Cuerpos aprobados (especificación 3e), solo para enseñarle a John un ejemplo real en la propuesta.
const CUERPOS = {
  rukc_recordatorio_semana: (v) => `Hola, ${v[0]}. Queda una semana para la ${v[1]} de RUKC: ${v[2]} en ${v[3]}.\nHay que estar en el circuito a las ${v[4]} para la acreditación y el pesaje. El resto de la inscripción, ${v[5]} €, se paga allí.\nSi hay algún cambio, avísanos respondiendo a este mensaje.`,
  rukc_recordatorio_manana: (v) => `Hola, ${v[0]}. Mañana es la ${v[1]} de RUKC en ${v[2]}.\nLlegada a las ${v[3]} para la acreditación y el pesaje; el briefing empieza a las ${v[4]}.\nCómo llegar: ${v[5]}\nRecuerda el pago restante de ${v[6]} €. Nos vemos en pista.`,
  rukc_feedback_ronda: (v) => `Hola, ${v[0]}. Gracias por correr la ${v[1]} de RUKC.\nQueremos que cada ronda salga mejor que la anterior. ¿Nos cuentas qué tal fue? Es un formulario corto.\n[Botón: Dar mi opinión]`,
  rukc_nueva_ronda: (v) => `Qué tal, ${v[0]}. La próxima ronda de RUKC es la ${v[1]}: ${v[2]} en ${v[3]}.\nKarts sorteados, lastre y categorías por peso: aquí gana el que mejor conduce. La inscripción cierra el ${v[4]}.\n¿Te guardamos sitio?\n[Botones: Reservar plaza · Tengo dudas]`,
};
export const vistaPrevia = (plantilla, variables) => CUERPOS[plantilla]?.(variables) ?? '';

async function horario() {
  const filas = await consulta(`SELECT clave, valor FROM bot_settings WHERE clave IN ('horario_inicio', 'horario_fin')`);
  const h = Object.fromEntries(filas.map((x) => [x.clave, x.valor]));
  return { inicio: h.horario_inicio || '09:30', fin: h.horario_fin || '21:30' };
}

/** Ronda con su horario por categoría. */
export async function datosRonda(rondaId) {
  const r = await uno(
    `SELECT r.id, r.numero, r.fecha::text AS fecha, r.maps_url, c.nombre AS circuito, t.codigo AS temporada,
            r.hora_acreditacion::text AS hora_acreditacion, r.hora_briefing::text AS hora_briefing
     FROM ronda r JOIN circuito c ON c.id = r.circuito_id JOIN temporada t ON t.id = r.temporada_id WHERE r.id = $1`, [rondaId]);
  if (!r) return null;
  r.cupos = await consulta(
    `SELECT cat.id AS categoria_id, cat.nombre, coalesce(cr.hora_llegada, $2::time)::text AS llegada, coalesce(cr.hora_briefing, $3::time)::text AS briefing
     FROM cupo_ronda cr JOIN categoria cat ON cat.id = cr.categoria_id WHERE cr.ronda_id = $1 ORDER BY cat.orden`,
    [rondaId, r.hora_acreditacion, r.hora_briefing]);
  return r;
}

/** Destinatarios de los recordatorios de una ronda: uno por teléfono, con las variables de su plantilla. */
export async function destinatariosRonda(r, automatizacion) {
  const filas = await consulta(
    `SELECT i.id, i.es_menor, i.categoria_id, inscripcion_saldo_cent(i.id) AS saldo_cent,
            pil.id AS piloto_id, pil.nombre AS piloto_nombre, pil.telefono AS piloto_tel,
            pag.id AS pagador_id, pag.nombre AS pagador_nombre, pag.telefono AS pagador_tel,
            tut.nombre AS tutor_nombre, tut.telefono AS tutor_tel
     FROM inscripcion i
     JOIN persona pil ON pil.id = i.piloto_persona_id
     JOIN pedido pe ON pe.id = i.pedido_id JOIN persona pag ON pag.id = pe.pagador_persona_id
     LEFT JOIN LATERAL (SELECT pt.nombre, pt.telefono FROM tutela tu JOIN persona pt ON pt.id = tu.tutor_persona_id
                        WHERE tu.menor_persona_id = pil.id ORDER BY tu.creado_en LIMIT 1) tut ON true
     WHERE i.ronda_id = $1 AND i.estado IN ('reservada', 'pagada') ORDER BY pil.nombre`, [r.id]);
  const primera = (campo) => r.cupos.map((c) => c[campo]).filter(Boolean).sort()[0] ?? null;
  // D2: sin los que avisaron (botón o mensaje) de que no van (lib/whatsapp/asistencia.js).
  const noVan = automatizacion === 'D2' ? await (await import('./asistencia.js')).inscripcionesQueNoVan(r.id) : new Set();
  const salida = new Map();
  for (const x of filas) {
    if (noVan.has(x.id)) continue;
    const cupo = r.cupos.find((c) => c.categoria_id === x.categoria_id);
    const llegada = hhmm(cupo?.llegada ?? primera('llegada'));
    const briefing = hhmm(cupo?.briefing ?? primera('briefing'));
    const variables = (nombre) => (automatizacion === 'D1'
      ? [pila(nombre), `R${r.numero}`, fechaLarga(r.fecha), r.circuito, llegada, euros(x.saldo_cent)]
      : [pila(nombre), `R${r.numero}`, r.circuito, llegada, briefing, r.maps_url, euros(x.saldo_cent)]);
    const menor = Boolean(x.es_menor || x.tutor_tel);
    const telTutor = x.tutor_tel || (x.pagador_id !== x.piloto_id ? x.pagador_tel : null);
    const lista = [];
    if (menor) {
      if (telTutor) lista.push({ telefono: telTutor, nombre: x.tutor_nombre || x.pagador_nombre });
      if (x.piloto_tel && x.piloto_tel !== telTutor) lista.push({ telefono: x.piloto_tel, nombre: x.piloto_nombre });
    } else if (x.piloto_tel) lista.push({ telefono: x.piloto_tel, nombre: x.piloto_nombre });
    else if (x.pagador_tel) lista.push({ telefono: x.pagador_tel, nombre: x.pagador_nombre });
    for (const d of lista) if (!salida.has(d.telefono)) salida.set(d.telefono, { ...d, inscripcion_id: x.id, variables: variables(d.nombre), llegada, briefing });
  }
  return [...salida.values()];
}

/**
 * E1: un destinatario por inscripción en "asistió": el piloto, o su tutor o quien pagó si el piloto no tiene teléfono.
 * Todos reciben el mismo enlace al formulario anónimo de la ronda (no se crean envíos personales ni tokens: así no hay
 * forma de saber quién responde).
 */
export async function destinatariosFeedback(r) {
  const [n] = await consulta(
    `SELECT count(*) FILTER (WHERE estado = 'asistio')::int AS asistio, count(*) FILTER (WHERE estado IN ('reservada', 'pagada'))::int AS sin_marcar
     FROM inscripcion WHERE ronda_id = $1`, [r.id]);
  const formulario = rondaPorId(`${r.temporada}-R${r.numero}`);
  const falta = [];
  if (!n.asistio && n.sin_marcar) falta.push('marcar en el panel quién asistió');
  if (!formulario && (n.asistio || n.sin_marcar)) falta.push(`configurar el formulario de feedback de la R${r.numero} (src/config/feedback/rondas.js)`);
  if (falta.length || !n.asistio) return { destinatarios: [], falta, sinMarcar: n.sin_marcar };
  const filas = await consulta(
    `SELECT pil.nombre AS piloto_nombre, pil.telefono AS piloto_tel,
            tut.nombre AS tutor_nombre, tut.telefono AS tutor_tel, pag.nombre AS pagador_nombre, pag.telefono AS pagador_tel
     FROM inscripcion i JOIN persona pil ON pil.id = i.piloto_persona_id
     JOIN pedido pe ON pe.id = i.pedido_id JOIN persona pag ON pag.id = pe.pagador_persona_id
     LEFT JOIN LATERAL (SELECT pt.nombre, pt.telefono FROM tutela tu JOIN persona pt ON pt.id = tu.tutor_persona_id
                        WHERE tu.menor_persona_id = pil.id ORDER BY tu.creado_en LIMIT 1) tut ON true
     WHERE i.ronda_id = $1 AND i.estado = 'asistio' ORDER BY pil.nombre`, [r.id]);
  const salida = new Map();
  for (const x of filas) {
    const telefono = x.piloto_tel || x.tutor_tel || x.pagador_tel;
    if (!telefono || salida.has(telefono)) continue;
    const nombre = x.piloto_tel ? x.piloto_nombre : (x.tutor_tel ? x.tutor_nombre : x.pagador_nombre);
    salida.set(telefono, { telefono, nombre, sufijo: formulario.slug, variables: [pila(x.piloto_nombre), `R${r.numero}`] });
  }
  return { destinatarios: [...salida.values()], falta: [], sinMarcar: n.sin_marcar };
}

/**
 * C2: contactos con consentimiento comercial vigente y sin baja, sin plaza en la ronda y sin mensajes (de ida o de
 * vuelta) en los últimos 3 días. Un destinatario por teléfono.
 */
export async function destinatariosC2(r) {
  const { puedeRecibirComercial, tienePlazaEnRonda } = await import('./comercial.js');
  const cierre = martesAnterior(r.fecha);
  const candidatos = await consulta(
    `SELECT c.*, (SELECT p.nombre FROM persona p WHERE p.telefono = c.phone_e164 ORDER BY p.creado_en DESC LIMIT 1) AS nombre_persona
     FROM wa_contacts c
     WHERE c.baja = 'ninguna' AND c.rol <> 'admin'
       AND (SELECT w.accion FROM wa_consents w WHERE w.contact_id = c.id AND w.tipo = 'comercial' ORDER BY w.created_at DESC, w.id DESC LIMIT 1) = 'otorga'
       AND NOT EXISTS (SELECT 1 FROM wa_messages m WHERE m.contact_id = c.id AND m.created_at > now() - interval '3 days')
     ORDER BY c.phone_e164`);
  const salida = [];
  for (const c of candidatos) {
    if (!(await puedeRecibirComercial(c)) || (await tienePlazaEnRonda(c.phone_e164, r.id))) continue;
    const nombre = pila(c.nombre_persona || c.display_name) || 'piloto';
    salida.push({ telefono: c.phone_e164, nombre: c.display_name, variables: [nombre, `R${r.numero}`, fechaLarga(r.fecha), r.circuito, fechaLarga(cierre)] });
  }
  return salida;
}

/** Datos que faltan para poder mandar el recordatorio de una ronda. */
function faltan(r, automatizacion, destinatarios) {
  const f = [];
  if (automatizacion === 'E1' || automatizacion === 'C2') return f;
  if (destinatarios.some((d) => !d.llegada)) f.push('la hora de llegada');
  if (automatizacion === 'D2') {
    if (destinatarios.some((d) => !d.briefing)) f.push('la hora del briefing');
    if (!r.maps_url) f.push('el enlace de Maps');
  }
  return f;
}

/** Crea el lote de una automatización para una ronda y le manda a John la propuesta con código. */
export async function crearLote(automatizacion, rondaId, hoy, d = {}) {
  const a = AUTOMATIZACIONES[automatizacion];
  const r = await datosRonda(rondaId);
  const fb = automatizacion === 'E1' ? await destinatariosFeedback(r) : null;
  let destinatarios = fb ? fb.destinatarios
    : automatizacion === 'C2' ? await destinatariosC2(r) : await destinatariosRonda(r, automatizacion);
  if (d.filtrarDestinatarios) destinatarios = destinatarios.filter(d.filtrarDestinatarios);
  const falta = fb?.falta.length ? fb.falta : faltan(r, automatizacion, destinatarios);
  if (!destinatarios.length && !falta.length) return { nota: 'sin inscritos' };
  if (falta.length) {
    // Una sola vez al día: el aviso queda como lote cancelado con el motivo.
    const ya = await uno(`SELECT 1 FROM wa_batches WHERE automatizacion = $1 AND ronda_id = $2 AND estado = 'cancelado'
      AND vista_previa LIKE 'Faltan datos%' AND created_at > now() - interval '20 hours'`, [automatizacion, rondaId]);
    if (!ya) {
      await consulta(`INSERT INTO wa_batches (automatizacion, ronda_id, num_destinatarios, vista_previa, estado) VALUES ($1, $2, $3, $4, 'cancelado')`,
        [automatizacion, rondaId, destinatarios.length, `Faltan datos: ${falta.join(', ')}`]);
      await enviarAJohn({
        texto: fb
          ? `Para mandar el ${a.nombre} de la R${r.numero} hace falta ${falta.join(' y ')}. En cuanto esté, te lo propongo.`
          : `No puedo preparar el ${a.nombre} de la R${r.numero} (${fechaLarga(r.fecha)}): falta ${falta.join(' y ')}. Escríbeme, por ejemplo: "la R${r.numero}, ligeros a las 15:00 y briefing a las 16:00, el maps es …". En cuanto lo tenga, te lo propongo.`,
        automatizacion: 'F2', d,
      });
    }
    return { nota: `faltan datos: ${falta.join(', ')}` };
  }

  const limite = await uno(`SELECT ($1 || ' ' || $2)::timestamp AT TIME ZONE 'Europe/Madrid' AS limite, ($1 || ' ' || $3)::timestamp AT TIME ZONE 'Europe/Madrid' AS envio`,
    [hoy, a.limite, a.envio]);
  const ejemplo = vistaPrevia(a.plantilla, destinatarios[0].variables);
  const lote = await uno(
    `INSERT INTO wa_batches (automatizacion, ronda_id, num_destinatarios, vista_previa, confirmar_antes_de)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`, [automatizacion, rondaId, destinatarios.length, ejemplo, limite.limite]);
  let filas = 0;
  for (const dest of destinatarios) {
    const contacto = await asegurarContacto(dest.telefono, dest.nombre ?? null, false);
    if (contacto.baja === 'total') continue;
    const fila = await uno(
      `INSERT INTO wa_outbox (contact_id, lote_id, automatizacion, ronda_id, plantilla, variables, enviar_at, estado, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente_confirmacion', $8) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [contacto.id, lote.id, automatizacion, rondaId, a.plantilla,
        JSON.stringify({ variables: dest.variables, ...(dest.sufijo ? { sufijo: dest.sufijo } : {}), ...(dest.inscripcion_id ? { inscripciones: [dest.inscripcion_id] } : {}) }), limite.envio,
        `${automatizacion}:R${r.numero}:${dest.telefono}`]);
    if (fila) filas += 1;
  }
  await consulta('UPDATE wa_batches SET num_destinatarios = $2 WHERE id = $1', [lote.id, filas]);
  if (!filas) {
    await consulta(`UPDATE wa_batches SET estado = 'cancelado' WHERE id = $1`, [lote.id]);
    return { nota: 'nadie a quien enviar' };
  }
  const tarde = madrid(d.ahora ?? new Date()).hora >= a.envio;   // p. ej. la asistencia se marcó por la tarde
  const resumen = [
    `${a.nombre[0].toUpperCase()}${a.nombre.slice(1)} de la R${r.numero} (${fechaLarga(r.fecha)}, ${r.circuito}) para ${filas} persona(s). ${tarde ? 'Sale en cuanto lo confirmes.' : `Sale a las ${a.envio}.`}`,
    ...(automatizacion === 'D2' ? await (async () => {
      const n = await (await import('./asistencia.js')).respuestasRonda(r.id);
      return n.no_van ? [`${n.no_van} avisaron de que no van y no lo recibirán.`] : [];
    })() : []),
    ...(fb?.sinMarcar ? [`Hay ${fb.sinMarcar} inscrito(s) sin marcar la asistencia en el panel: no lo recibirán hasta que los marques.`] : []),
    `Ejemplo:\n«${ejemplo}»`,
    tarde ? `Si no lo confirmas antes de las ${a.limite}, no sale.` : `Si no lo confirmas antes de las ${a.envio}, no sale; si lo confirmas antes de las ${a.limite}, sale al confirmar.`,
  ].join('\n\n');
  const propuesta = await proponerAccion('enviar_lote',
    { lote_id: lote.id, automatizacion, ronda: `R${r.numero}`, num: filas, resumen, requiere_pin: filas > 20, envio: a.envio, avisado: tarde },
    `Programador: ${a.nombre} de la R${r.numero}`, { caducaAt: limite.limite });
  await enviarAJohn({ texto: propuesta, automatizacion: automatizacion, d });
  return { lote: lote.id, destinatarios: filas };
}

/** D3: borrador para el grupo de pilotos, dos días antes, solo a John (una vez). */
export async function borradorGrupo(rondaId, d = {}) {
  const r = await datosRonda(rondaId);
  const ya = await uno(`SELECT 1 FROM wa_batches WHERE automatizacion = 'D3' AND ronda_id = $1`, [rondaId]);
  if (ya) return { nota: 'ya enviado' };
  const horas = r.cupos.filter((c) => c.llegada).map((c) => `${c.nombre}: llegada a las ${hhmm(c.llegada)}${c.briefing ? `, briefing a las ${hhmm(c.briefing)}` : ''}.`);
  const texto = [
    `Pilotos, este ${fechaLarga(r.fecha)} corremos la R${r.numero} en ${r.circuito}.`,
    ...(horas.length ? horas : ['(Falta el horario de llegada: pásamelo y te rehago el borrador.)']),
    'El briefing empieza a su hora y no se espera a nadie.',
    'Traed los 69 € del resto en efectivo; si no podéis, pagadlo por Bizum antes de la carrera.',
    ...(r.maps_url ? [`Cómo llegar: ${r.maps_url}`] : []),
    'Nos vemos en pista.',
  ].join('\n');
  await consulta(`INSERT INTO wa_batches (automatizacion, ronda_id, num_destinatarios, vista_previa, estado) VALUES ('D3', $1, 0, $2, 'enviado')`, [rondaId, texto]);
  await enviarAJohn({ texto: `Borrador para el grupo de pilotos de la R${r.numero}. Cópialo, cámbialo si quieres y pégalo en el grupo desde la app:\n\n${texto}`, automatizacion: 'D3', d });
  return { borrador: true };
}

/** Planificador: propone D1 y D2, manda D3 y gestiona los lotes sin confirmar. d: { ahora, filtrarDestinatarios }. */
export async function planificar(d = {}) {
  const ahora = d.ahora ?? new Date();
  const { fecha: hoy, hora } = madrid(ahora);
  const salida = [];
  const rondas = await consulta(
    `SELECT r.id, r.fecha::text AS fecha FROM ronda r JOIN temporada t ON t.id = r.temporada_id
     WHERE t.estado IN ('abierta', 'en_curso') AND r.estado IN ('programada', 'aplazada') AND r.fecha BETWEEN $1::date AND $1::date + 8`, [hoy]);
  for (const r of rondas) {
    for (const [aut, a] of Object.entries(AUTOMATIZACIONES)) {
      if (aut === 'E1' || aut === 'C2' || sumarDias(r.fecha, -a.dias) !== hoy || hora < a.propuesta || hora >= a.limite) continue;
      const hecho = await uno(`SELECT 1 FROM wa_batches WHERE automatizacion = $1 AND ronda_id = $2 AND estado IN ('propuesto', 'confirmado', 'enviado')`, [aut, r.id]);
      if (!hecho) salida.push({ aut, ronda: r.fecha, ...(await crearLote(aut, r.id, hoy, d)) });
    }
    if (sumarDias(r.fecha, -2) === hoy && hora >= '12:00' && hora < '21:30') salida.push({ aut: 'D3', ...(await borradorGrupo(r.id, d)) });
  }
  // C2: el sábado anterior al cierre de inscripción de una ronda que aún tiene la inscripción abierta.
  const c2 = AUTOMATIZACIONES.C2;
  if (hora >= c2.propuesta && hora < c2.limite) {
    const proximas = await consulta(
      `SELECT r.id, r.fecha::text AS fecha FROM ronda r JOIN temporada t ON t.id = r.temporada_id
       WHERE t.estado IN ('abierta', 'en_curso') AND r.estado IN ('programada', 'aplazada') AND r.fecha BETWEEN $1::date AND $1::date + 14
         AND EXISTS (SELECT 1 FROM cupo_ronda cr WHERE cr.ronda_id = r.id AND cr.estado_inscripcion = 'abierta')`, [hoy]);
    for (const r of proximas) {
      if (sumarDias(martesAnterior(r.fecha), -3) !== hoy) continue;
      const hecho = await uno(`SELECT 1 FROM wa_batches WHERE automatizacion = 'C2' AND ronda_id = $1 AND estado IN ('propuesto', 'confirmado', 'enviado', 'caducado', 'cancelado')`, [r.id]);
      if (!hecho) salida.push({ aut: 'C2', ronda: r.fecha, ...(await crearLote('C2', r.id, hoy, d)) });
    }
  }
  // E1: de uno a tres días después de la ronda, una sola propuesta (si caduca o se cancela, no se repite).
  const e1 = AUTOMATIZACIONES.E1;
  if (hora >= e1.propuesta && hora < e1.limite) {
    const pasadas = await consulta(
      `SELECT r.id, r.fecha::text AS fecha FROM ronda r
       WHERE r.estado IN ('programada', 'celebrada') AND r.fecha BETWEEN $1::date - $2::int AND $1::date - 1`, [hoy, DIAS_REINTENTO_E1]);
    for (const r of pasadas) {
      const hecho = await uno(
        `SELECT 1 FROM wa_batches WHERE automatizacion = 'E1' AND ronda_id = $1
           AND (estado IN ('propuesto', 'confirmado', 'enviado', 'caducado') OR (estado = 'cancelado' AND vista_previa NOT LIKE 'Faltan datos%'))`, [r.id]);
      if (!hecho) salida.push({ aut: 'E1', ronda: r.fecha, ...(await crearLote('E1', r.id, hoy, d)) });
    }
  }
  // Lotes sin confirmar: aviso a la hora de envío y caducidad a la hora límite.
  const propuestos = await consulta(
    `SELECT b.id, b.automatizacion, b.confirmar_antes_de, a.id AS accion_id, a.estado AS accion_estado, a.parametros
     FROM wa_batches b LEFT JOIN admin_actions a ON a.tipo = 'enviar_lote' AND a.parametros->>'lote_id' = b.id::text
     WHERE b.estado = 'propuesto'`);
  for (const b of propuestos) {
    const p = b.parametros ?? {};
    if (b.accion_estado === 'cancelada' || new Date(b.confirmar_antes_de) <= ahora) {
      await consulta(`UPDATE wa_batches SET estado = $2 WHERE id = $1`, [b.id, b.accion_estado === 'cancelada' ? 'cancelado' : 'caducado']);
      await consulta(`UPDATE wa_outbox SET estado = 'caducado' WHERE lote_id = $1 AND estado = 'pendiente_confirmacion'`, [b.id]);
      if (b.accion_estado === 'propuesta') await consulta(`UPDATE admin_actions SET estado = 'caducada' WHERE id = $1`, [b.accion_id]);
      if (b.accion_estado !== 'cancelada') {
        await enviarAJohn({ texto: `El ${AUTOMATIZACIONES[b.automatizacion]?.nombre ?? b.automatizacion} de la ${p.ronda ?? 'ronda'} no se ha enviado: no se confirmó a tiempo.`, automatizacion: 'F2', d });
      }
      salida.push({ caducado: b.id });
    } else if (!p.avisado && p.envio && hora >= p.envio) {
      await consulta(`UPDATE admin_actions SET parametros = parametros || '{"avisado": true}' WHERE id = $1`, [b.accion_id]);
      await enviarAJohn({ texto: `El ${AUTOMATIZACIONES[b.automatizacion]?.nombre} de la ${p.ronda} no ha salido a las ${p.envio} porque falta tu CONFIRMO. Si lo confirmas antes de las ${AUTOMATIZACIONES[b.automatizacion]?.limite}, sale al confirmar.`, automatizacion: 'F2', d });
      salida.push({ avisado: b.id });
    }
  }
  return salida;
}

/** CONFIRMO de un lote: queda confirmado y sus mensajes pasan a la cola (salen a su hora, o ya si ha pasado). */
export async function confirmarLote(p, d = {}) {
  const b = await uno(`SELECT * FROM wa_batches WHERE id = $1`, [p.lote_id]);
  if (!b || b.estado !== 'propuesto') return { ok: false, texto: `Ese lote ya no está pendiente (${b?.estado ?? 'no existe'}).` };
  if (new Date(b.confirmar_antes_de) <= new Date()) return { ok: false, texto: 'Ese lote ya ha caducado.' };
  await consulta(`UPDATE wa_batches SET estado = 'confirmado', confirmado_at = now() WHERE id = $1`, [b.id]);
  const filas = await consulta(
    `UPDATE wa_outbox SET estado = 'confirmado', enviar_at = greatest(enviar_at, now()) WHERE lote_id = $1 AND estado = 'pendiente_confirmacion' RETURNING enviar_at`, [b.id]);
  const yaToca = filas.some((f) => new Date(f.enviar_at) <= new Date(Date.now() + 60_000));
  if (yaToca) {
    const r = await procesarCola(d);
    return { ok: true, texto: `Confirmado: el ${AUTOMATIZACIONES[b.automatizacion]?.nombre} de la ${p.ronda} está saliendo ahora (${r.enviados ?? 0} enviados).` };
  }
  return { ok: true, texto: `Confirmado: el ${AUTOMATIZACIONES[b.automatizacion]?.nombre} de la ${p.ronda} sale a las ${p.envio} a ${filas.length} persona(s).` };
}

/** Cola: manda los recordatorios confirmados que ya tocan, dentro del horario. d: { ahora, enviar }. Nunca lanza. */
export async function procesarCola(d = {}) {
  try {
    const ahora = d.ahora ?? new Date();
    const enviar = d.enviar ?? enviarYcloud;
    const { fecha: hoy, hora } = madrid(ahora);
    // Recordatorios y avisos de rondas que ya han pasado: no se mandan.
    await consulta(
      `UPDATE wa_outbox o SET estado = 'caducado' FROM ronda r
       WHERE r.id = o.ronda_id AND o.automatizacion IN ('D1', 'D2', 'C2') AND o.estado IN ('confirmado', 'pendiente_confirmacion') AND r.fecha < $1::date`, [hoy]);
    const h = await horario();
    if (hora < h.inicio || hora > h.fin) return { nota: 'fuera de horario' };
    const filas = await consulta(
      `UPDATE wa_outbox SET estado = 'enviando', intentos = intentos + 1
       WHERE id IN (SELECT id FROM wa_outbox WHERE automatizacion IN ('D1', 'D2', 'E1', 'C2') AND estado = 'confirmado' AND enviar_at <= $1
                    ORDER BY enviar_at LIMIT 80 FOR UPDATE SKIP LOCKED)
       RETURNING *`, [ahora.toISOString()]);
    let enviados = 0;
    for (const o of filas) {
      const contacto = await uno('SELECT * FROM wa_contacts WHERE id = $1', [o.contact_id]);
      if (!contacto || contacto.baja === 'total') {
        await consulta(`UPDATE wa_outbox SET estado = 'cancelado', ultimo_error = 'baja' WHERE id = $1`, [o.id]);
        continue;
      }
      // C2 es comercial: justo antes de mandar, otra vez consentimiento vigente, sin baja, sin plaza ya y con la
      // inscripción aún abierta.
      if (o.automatizacion === 'C2') {
        const { puedeRecibirComercial, tienePlazaEnRonda } = await import('./comercial.js');
        const r = await uno('SELECT fecha::text AS fecha FROM ronda WHERE id = $1', [o.ronda_id]);
        const motivo = !(await puedeRecibirComercial(contacto)) ? 'sin consentimiento comercial vigente'
          : (await tienePlazaEnRonda(contacto.phone_e164, o.ronda_id)) ? 'ya tiene plaza'
          : (!r || martesAnterior(r.fecha) < hoy) ? 'inscripción cerrada' : null;
        if (motivo) {
          await consulta(`UPDATE wa_outbox SET estado = 'cancelado', ultimo_error = $2 WHERE id = $1`, [o.id, motivo]);
          continue;
        }
      }
      // E1: el botón lleva al formulario anónimo de la ronda (/feedback/<slug>), el mismo para todos.
      let opciones = {};
      if (o.automatizacion === 'E1') {
        if (!o.variables.sufijo) {
          await consulta(`UPDATE wa_outbox SET estado = 'cancelado', ultimo_error = 'sin enlace de feedback' WHERE id = $1`, [o.id]);
          continue;
        }
        opciones = { sufijoBoton: o.variables.sufijo };
      }
      const conv = await conversacionActual(contacto.id);
      const envio = await enviar({ contacto, conversacionId: conv.id, autor: 'sistema', plantilla: construirPlantilla(o.plantilla, o.variables.variables, opciones) });
      if (envio.ok) {
        enviados += 1;
        await consulta(`UPDATE wa_outbox SET estado = 'enviado', message_id = $2, ultimo_error = NULL WHERE id = $1`, [o.id, envio.id ?? null]);
      } else {
        const espera = REINTENTOS_MIN[o.intentos - 1];
        await consulta(
          `UPDATE wa_outbox SET estado = $2, ultimo_error = $3, enviar_at = CASE WHEN $4::int IS NULL THEN enviar_at ELSE $5::timestamptz + make_interval(mins => $4::int) END WHERE id = $1`,
          [o.id, espera ? 'confirmado' : 'fallido', String(envio.error ?? 'error').slice(0, 300), espera ?? null, ahora.toISOString()]);
      }
    }
    // Lotes terminados.
    await consulta(
      `UPDATE wa_batches b SET estado = 'enviado' WHERE b.estado = 'confirmado'
         AND NOT EXISTS (SELECT 1 FROM wa_outbox o WHERE o.lote_id = b.id AND o.estado IN ('confirmado', 'enviando', 'pendiente_confirmacion'))`);
    return { enviados, procesados: filas.length };
  } catch (e) {
    console.error('cola', e.message);
    return { error: e.message };
  }
}
