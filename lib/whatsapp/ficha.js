// Recordatorio de la ficha de piloto (onboarding) por WhatsApp, en lote con CONFIRMO (programador.js).
// - A quién: pilotos con plaza (reservada, pagada o confirmada sin pago) en una ronda de los próximos 14 días cuya ficha de la temporada
//   no está completada. Si el piloto es menor, al tutor. Nunca a quien se dio de baja del todo.
// - Cuántas veces: como mucho uno cada 3 días (contando también los enlaces que mande John desde el panel) y 3 por
//   ronda desde el bot.
// - El enlace: https://raceupkc.com/ficha/<token>, el mismo token firmado del botón de la confirmación de plaza
//   (/ficha/ y /grupo/ van a api/grupo.js). No caduca: al abrirlo se genera el enlace nuevo a la ficha.
// - Con la ventana de 24 h abierta, texto libre; si no, la plantilla rukc_ficha_piloto (hay que darla de alta y que
//   Meta la apruebe).
// Va con el código de automatización B4 (recordatorios de un trámite pendiente, como el del Bizum), sin migración.
import { consulta } from '../db.js';
import { tokenGrupo } from './confirmacion.js';

export const DIAS_ANTES = 14;
export const DIAS_ENTRE = 3;
export const MAX_POR_RONDA = 3;
const ESTADOS_PENDIENTES = ['pendiente', 'en_curso', 'falta_tutor', 'requiere_actualizacion'];
const pila = (n) => String(n || '').trim().split(/\s+/)[0] || '';

export const enlaceFicha = (inscripcionId) => `https://raceupkc.com/ficha/${tokenGrupo(inscripcionId)}`;

export const textoFicha = (v, enlace) =>
  `Hola, ${v[0]}. Para correr la ${v[1]} de RUKC falta completar la ficha de piloto: datos, contacto de emergencia y autorizaciones. Son unos minutos y es obligatoria para correr: ${enlace}`;

/**
 * Destinatarios del recordatorio de la ficha en una ronda (r de datosRonda). `ahora` para los tests.
 * Cada uno: { telefono, nombre, inscripcion_id, onboarding_id, variables: [nombre, "R2"] }.
 */
export async function destinatariosFicha(r, { ahora = new Date() } = {}) {
  const filas = await consulta(
    `SELECT i.id AS inscripcion_id, o.id AS onboarding_id, o.enlace_enviado_en,
            pil.nombre AS piloto_nombre, pil.telefono AS piloto_tel,
            tut.nombre AS tutor_nombre, tut.telefono AS tutor_tel, pag.nombre AS pagador_nombre, pag.telefono AS pagador_tel,
            (SELECT count(*)::int FROM wa_outbox x WHERE x.idempotency_key LIKE 'FICHA:R' || r.numero || ':%:' || i.id::text || ':%'
               AND x.estado = 'enviado') AS enviados_bot,
            (SELECT max(x.created_at) FROM wa_outbox x WHERE x.idempotency_key LIKE 'FICHA:R' || r.numero || ':%:' || i.id::text || ':%'
               AND x.estado IN ('pendiente_confirmacion', 'confirmado', 'enviando', 'enviado')) AS ultimo_bot
     FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id
     JOIN persona pil ON pil.id = i.piloto_persona_id
     JOIN onboarding o ON o.persona_id = pil.id AND o.temporada_id = r.temporada_id
     JOIN pedido pe ON pe.id = i.pedido_id JOIN persona pag ON pag.id = pe.pagador_persona_id
     LEFT JOIN LATERAL (SELECT pt.nombre, pt.telefono FROM tutela tu JOIN persona pt ON pt.id = tu.tutor_persona_id
                        WHERE tu.menor_persona_id = pil.id ORDER BY tu.creado_en LIMIT 1) tut ON true
     WHERE i.ronda_id = $1 AND (i.estado IN ('reservada', 'pagada') OR (i.estado = 'pendiente_pago' AND i.plaza_confirmada)) AND o.estado = ANY($2::text[])
     ORDER BY pil.nombre`, [r.id, ESTADOS_PENDIENTES]);
  const limite = ahora.getTime() - DIAS_ENTRE * 864e5;
  const salida = new Map();
  for (const x of filas) {
    if (x.enviados_bot >= MAX_POR_RONDA) continue;
    const ultimo = Math.max(x.enlace_enviado_en ? new Date(x.enlace_enviado_en).getTime() : 0, x.ultimo_bot ? new Date(x.ultimo_bot).getTime() : 0);
    if (ultimo > limite) continue;
    // Menor: al tutor (los menores no reciben mensajes). Si no, al piloto; si no tiene teléfono, a quien pagó.
    const [telefono, nombre] = x.tutor_tel ? [x.tutor_tel, x.tutor_nombre] : x.piloto_tel ? [x.piloto_tel, x.piloto_nombre] : [x.pagador_tel, x.pagador_nombre];
    if (!telefono || salida.has(telefono)) continue;
    salida.set(telefono, {
      telefono, nombre, inscripcion_id: x.inscripcion_id, onboarding_id: x.onboarding_id, n: x.enviados_bot + 1,
      clave: `FICHA:R${r.numero}:${telefono}:${x.inscripcion_id}:${x.enviados_bot + 1}`,
      variables: [pila(nombre) || 'piloto', `R${r.numero}`],
    });
  }
  return [...salida.values()];
}

/** ¿Sigue pendiente la ficha? (justo antes de enviar). */
export async function fichaPendiente(onboardingId) {
  const [o] = await consulta('SELECT estado FROM onboarding WHERE id = $1', [onboardingId]);
  return Boolean(o && ESTADOS_PENDIENTES.includes(o.estado));
}

/** Tras enviar: cuenta en el panel como un envío más del enlace (seguimiento de la ficha). */
export async function anotarEnvio(onboardingId) {
  await consulta('UPDATE onboarding SET envios = envios + 1, enlace_enviado_en = now() WHERE id = $1', [onboardingId]);
}

// --- Envío automático del enlace a las 24 h ---------------------------------------------------------------------------
// Si 24 h después de crearse la ficha (al confirmarse la plaza) el piloto no la ha empezado y nadie le ha mandado el
// enlace (ni John desde el panel ni el bot), el bot se lo manda solo: una vez por ficha, de 9:30 a 21:30 y sin CONFIRMO
// (va a una sola persona). Después siguen los recordatorios en lote (programador.js), cada 3 días.
export const HORAS_ENVIO_AUTOMATICO = 24;

/** Fichas sin empezar y sin enlace enviado de pilotos con plaza en una ronda futura, creadas hace 24 h o más. */
async function candidatasAutomaticas(ahora) {
  return consulta(
    `SELECT DISTINCT ON (o.id) o.id AS onboarding_id, i.id AS inscripcion_id, r.numero,
            pil.nombre AS piloto_nombre, pil.telefono AS piloto_tel,
            tut.nombre AS tutor_nombre, tut.telefono AS tutor_tel, pag.nombre AS pagador_nombre, pag.telefono AS pagador_tel
     FROM onboarding o
     JOIN persona pil ON pil.id = o.persona_id
     JOIN inscripcion i ON i.piloto_persona_id = pil.id AND (i.estado IN ('reservada', 'pagada') OR (i.estado = 'pendiente_pago' AND i.plaza_confirmada))
     JOIN ronda r ON r.id = i.ronda_id AND r.temporada_id = o.temporada_id AND r.estado IN ('programada', 'aplazada')
       AND r.fecha >= ($1::timestamptz AT TIME ZONE 'Europe/Madrid')::date
     JOIN pedido pe ON pe.id = i.pedido_id JOIN persona pag ON pag.id = pe.pagador_persona_id
     LEFT JOIN LATERAL (SELECT pt.nombre, pt.telefono FROM tutela tu JOIN persona pt ON pt.id = tu.tutor_persona_id
                        WHERE tu.menor_persona_id = pil.id ORDER BY tu.creado_en LIMIT 1) tut ON true
     WHERE o.estado = 'pendiente' AND o.iniciado_en IS NULL AND o.enlace_enviado_en IS NULL AND o.envios = 0
       AND o.creado_en <= $1::timestamptz - make_interval(hours => $2)
       AND NOT EXISTS (SELECT 1 FROM wa_outbox x WHERE x.idempotency_key = 'FICHA:auto:' || o.id::text)
     ORDER BY o.id, r.fecha
     LIMIT 50`, [ahora.toISOString(), HORAS_ENVIO_AUTOMATICO]);
}

/** Manda el enlace a quien le toca. d: { ahora, enviar } (tests). Nunca lanza. */
export async function enviosAutomaticosFicha(d = {}) {
  try {
    const ahora = d.ahora ?? new Date();
    const hora = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ahora);
    const h = Object.fromEntries((await consulta(`SELECT clave, valor FROM bot_settings WHERE clave IN ('horario_inicio', 'horario_fin')`))
      .map((x) => [x.clave, x.valor]));
    if (hora < (h.horario_inicio || '09:30') || hora > (h.horario_fin || '21:30')) return { nota: 'fuera de horario' };

    const { asegurarContacto, conversacionActual } = await import('./entrante.js');
    const { enviar: enviarYcloud } = await import('./client.js');
    const { construirPlantilla } = await import('./templates.js');
    const enviar = d.enviar ?? enviarYcloud;
    const salida = { enviados: 0, revisadas: 0 };
    for (const x of await candidatasAutomaticas(ahora)) {
      salida.revisadas += 1;
      // Menor: al tutor. Si no, al piloto; si no tiene teléfono, a quien pagó.
      const [telefono, nombre] = x.tutor_tel ? [x.tutor_tel, x.tutor_nombre] : x.piloto_tel ? [x.piloto_tel, x.piloto_nombre] : [x.pagador_tel, x.pagador_nombre];
      if (!telefono) continue;
      const contacto = await asegurarContacto(telefono, nombre ?? null, false);
      if (contacto.baja === 'total' || contacto.modo === 'pausado') continue;
      const variables = [pila(nombre) || 'piloto', `R${x.numero}`];
      const abierta = contacto.last_inbound_at && ahora.getTime() - new Date(contacto.last_inbound_at).getTime() < 24 * 3.6e6;
      const fila = (await consulta(
        `INSERT INTO wa_outbox (contact_id, automatizacion, plantilla, variables, enviar_at, estado, idempotency_key, intentos)
         VALUES ($1, 'B4', $2, $3, $4, 'enviando', $5, 1) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [contacto.id, abierta ? null : 'rukc_ficha_piloto', JSON.stringify({ variables, onboarding_id: x.onboarding_id, inscripciones: [x.inscripcion_id] }),
          ahora.toISOString(), `FICHA:auto:${x.onboarding_id}`]))[0];
      if (!fila) continue;
      const conv = await conversacionActual(contacto.id);
      const envio = abierta
        ? await enviar({ contacto, conversacionId: conv.id, autor: 'sistema', texto: textoFicha(variables, enlaceFicha(x.inscripcion_id)) })
        : await enviar({ contacto, conversacionId: conv.id, autor: 'sistema',
          plantilla: construirPlantilla('rukc_ficha_piloto', variables, { sufijoBoton: tokenGrupo(x.inscripcion_id) }) });
      await consulta(`UPDATE wa_outbox SET estado = $2, message_id = $3, ultimo_error = $4 WHERE id = $1`,
        [fila.id, envio.ok ? 'enviado' : 'fallido', envio.id ?? null, envio.ok ? null : String(envio.error ?? 'error').slice(0, 300)]);
      if (envio.ok) {
        salida.enviados += 1;
        await anotarEnvio(x.onboarding_id);
      }
    }
    return salida;
  } catch (e) {
    console.error('ficha automática', e.message);
    return { error: e.message };
  }
}
