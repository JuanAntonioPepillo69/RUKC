// Procesa los avisos de YCloud ya validados (firma e idempotencia en api/wa/webhook.js).
// - whatsapp.inbound_message.received: mensaje de un contacto → respuesta del bot (A1/A2), baja (F1) o escalado (A4).
// - whatsapp.smb.message.echoes: John escribe desde la app del número RUKC (coexistencia) → modo humano 12 h (A3).
// - whatsapp.message.updated: estado de un mensaje enviado (aceptado → enviado → entregado → leído, o fallido).
// Si el remitente es ADMIN_PHONE_E164 (lo decide el código, nunca el modelo), el mensaje va al canal admin, que en la
// fase 1 solo entiende órdenes fijas: PARA TODO, PAUSA <teléfono>, REANUDA <teléfono> y ESTADO.
import { consulta } from '../db.js';
import { normalizarTelefono } from '../telefono.js';
import * as datosBot from '../bot/datos.js';
import { textoParaPrompt } from '../bot/kb.js';
import { esDeRukc, esUrgencia, llmAnthropic, modelos, resumirEscalado } from '../bot/llm.js';
import { ahoraMadrid, systemAdmin, systemPublico } from '../bot/prompts.js';
import {
  CANCELO, CONFIRMO, HERRAMIENTAS_ADMIN, accionesPendientes, cancelarAccion, confirmarAccion, ejecutarHerramientaAdmin, proponerAccion, proponerReactivacion,
} from '../bot/admin.js';
import { AVISO_IA, ejecutarTurno } from '../bot/turn.js';
import { actualizarEstado, enviar, escribiendo, estadoLocal } from './client.js';
import { construirPlantilla } from './templates.js';
import { ACUSE_JUSTIFICANTE, ACUSE_RESTO, bizumPendientesDe, parametrosBizum, parametrosResto, propuestaRestoViva, propuestaViva,
  restosPendientesDe } from '../bot/bizum.js';

// Cuando John contesta desde la app, el bot calla 3 h desde el último mensaje de John (decisión de John, 2026-11-12;
// la especificación decía 12 h).
export const MODO_HUMANO_ECO_H = 3;
const DIAS_CONVERSACION = 7;
// Mensajes de la conversación que se le pasan a Claude: con 16 basta para seguir el hilo y se gastan menos tokens.
const MENSAJES_HISTORIAL = 16;
// Charla fuera de tema: se corta cuando 3 de las últimas 4 respuestas del bot lo son. El texto del corte se manda una
// vez; después el bot calla hasta que Haiku diga que el mensaje vuelve a ser de RUKC.
export const FUERA_DE_TEMA_MAX = 3;
const FUERA_DE_TEMA_VENTANA = 4;
export const TEXTO_CORTE = 'Hasta ahora me has escrito de cosas que no tienen que ver con RUKC, así que lo dejo aquí. Si tienes alguna duda de la liga, escríbemela y te contesto.';

// Baja escrita tal cual (F1). Las frases ("no me escribáis más") las entiende el bot y usa registrar_baja.
export const BAJA_EXACTA = /^\s*(baja|stop|parar|para ya|unsubscribe|darme de baja|dame de baja|quiero darme de baja)\s*[.!]*\s*$/i;
export const TEXTO_URGENCIA = 'Si es una urgencia, llama ahora al 112. Ya he avisado al equipo.';
export const CONFIRMACION_BAJA = 'Hecho, te he dado de baja y no te enviaremos más mensajes. Si algún día nos escribes, te contestamos por aquí.';

const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const uno = async (t, p) => (await consulta(t, p))[0] ?? null;

/** Dependencias sustituibles en los tests. */
const PREDETERMINADAS = { llm: llmAnthropic, datos: datosBot, enviar, escribiendo, resumir: resumirEscalado, clasificar: esDeRukc, urgencia: esUrgencia, esperaAgruparMs: 3000 };

export async function procesarEvento(evento, deps = {}) {
  const d = { ...PREDETERMINADAS, ...deps };
  switch (evento.type) {
    case 'whatsapp.inbound_message.received': return entrante(evento.whatsappInboundMessage ?? {}, d);
    case 'whatsapp.smb.message.echoes': return eco(evento.whatsappMessage ?? {});
    case 'whatsapp.message.updated': return { actualizado: await actualizarEstado(evento.whatsappMessage ?? {}) };
    default: return { nota: `evento sin uso: ${evento.type}` };
  }
}

// --- Contactos y conversaciones ------------------------------------------------------------------------------------
/** Crea o actualiza el contacto y recalcula su rol y su ficha a partir de persona, tutela e inscripciones. */
export async function asegurarContacto(telefono, nombre = null, esAdmin = false) {
  const r = await uno(
    `SELECT p.id AS persona_id,
            EXISTS (SELECT 1 FROM tutela t WHERE t.tutor_persona_id = p.id) AS tutor,
            (SELECT i.id FROM inscripcion i WHERE i.piloto_persona_id = p.id
               OR i.pedido_id IN (SELECT id FROM pedido WHERE pagador_persona_id = p.id)
               OR i.piloto_persona_id IN (SELECT menor_persona_id FROM tutela WHERE tutor_persona_id = p.id)
             ORDER BY i.creado_en DESC LIMIT 1) AS inscripcion
     FROM persona p WHERE p.telefono = $1`, [telefono]);
  const rol = esAdmin ? 'admin' : r?.tutor ? 'tutor' : r?.inscripcion ? 'piloto' : 'lead';
  return uno(
    `INSERT INTO wa_contacts (phone_e164, display_name, rol, persona_id, inscripcion_id_ultima)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (phone_e164) DO UPDATE SET
       display_name = coalesce(EXCLUDED.display_name, wa_contacts.display_name),
       rol = EXCLUDED.rol,
       persona_id = coalesce(EXCLUDED.persona_id, wa_contacts.persona_id),
       inscripcion_id_ultima = coalesce(EXCLUDED.inscripcion_id_ultima, wa_contacts.inscripcion_id_ultima)
     RETURNING *`, [telefono, nombre ? String(nombre).slice(0, 120) : null, rol, r?.persona_id ?? null, r?.inscripcion ?? null]);
}

/** Conversación en curso del contacto (la última no cerrada con actividad en los últimos 7 días) o una nueva. */
export async function conversacionActual(contactId) {
  const c = await uno(
    `SELECT * FROM wa_conversations WHERE contact_id = $1 AND estado <> 'cerrada'
       AND ultimo_mensaje_at > now() - make_interval(days => $2)
     ORDER BY ultimo_mensaje_at DESC LIMIT 1`, [contactId, DIAS_CONVERSACION]);
  if (c) return c;
  await consulta(`UPDATE wa_conversations SET estado = 'cerrada' WHERE contact_id = $1 AND estado <> 'cerrada'`, [contactId]);
  return uno(`INSERT INTO wa_conversations (contact_id) VALUES ($1) RETURNING *`, [contactId]);
}

const enModoHumano = (c) => c.modo !== 'bot' && (c.modo_hasta == null || new Date(c.modo_hasta) > new Date());

/** Texto que ve el bot para cada tipo de mensaje entrante. */
export function contenidoEntrante(m) {
  const t = m.type;
  if (t === 'text') return { tipo: 'texto', cuerpo: m.text?.body ?? '' };
  if (t === 'interactive') {
    const i = m.interactive ?? {};
    return { tipo: 'interactivo', cuerpo: i.button_reply?.title ?? i.list_reply?.title ?? '' };
  }
  if (t === 'button') return { tipo: 'interactivo', cuerpo: m.button?.text ?? m.button?.payload ?? '' };
  if (['image', 'document', 'video', 'sticker'].includes(t)) {
    const pie = m[t]?.caption ? `: ${m[t].caption}` : '';
    const nombre = t === 'image' ? 'una imagen' : t === 'document' ? 'un documento' : t === 'video' ? 'un vídeo' : 'un sticker';
    return { tipo: 'media', cuerpo: `[El contacto ha enviado ${nombre}${pie}]` };
  }
  if (t === 'audio') return { tipo: 'media', cuerpo: '[El contacto ha enviado una nota de voz. El bot no puede escucharla.]' };
  if (t === 'location') return { tipo: 'media', cuerpo: '[El contacto ha enviado una ubicación]' };
  return { tipo: 'media', cuerpo: `[Mensaje de tipo ${t || 'desconocido'}]` };
}

/**
 * Historial de la conversación para Claude: entradas → user, salidas → assistant; turnos del mismo rol unidos.
 * Los mensajes que el contacto escribió mientras la conversación estaba en manos de John y que John no contestó se
 * incluyen: cuando la conversación vuelve al bot, los contesta (decisión de John, 2026-11-12).
 */
export async function montarHistorial(conversacionId) {
  const filas = await consulta(
    `SELECT * FROM (SELECT direccion, autor, tipo, plantilla, cuerpo, created_at FROM wa_messages
       WHERE conversation_id = $1 AND (direccion = 'entrada' OR estado IS DISTINCT FROM 'fallido')
       ORDER BY created_at DESC LIMIT $2) x ORDER BY created_at`, [conversacionId, MENSAJES_HISTORIAL]);
  const mensajes = [];
  for (const f of filas) {
    const role = f.direccion === 'entrada' ? 'user' : 'assistant';
    let texto = f.tipo === 'plantilla' ? `[Plantilla enviada: ${f.plantilla}]` : (f.cuerpo || '').trim();
    if (f.autor === 'john_app') texto = `[El equipo, desde la app] ${texto}`;
    if (!texto) continue;
    const ultimo = mensajes.at(-1);
    if (ultimo?.role === role) ultimo.content += `\n${texto}`;
    else mensajes.push({ role, content: texto });
  }
  while (mensajes[0]?.role === 'assistant') mensajes.shift();
  return mensajes;
}

// --- Mensaje entrante -----------------------------------------------------------------------------------------------
async function entrante(m, d) {
  const telefono = normalizarTelefono(m.from);
  if (!telefono) return { nota: 'teléfono no válido' };
  const admin = normalizarTelefono(process.env.ADMIN_PHONE_E164);
  const esAdmin = Boolean(admin) && telefono === admin;
  const { tipo, cuerpo } = contenidoEntrante(m);

  let contacto = await asegurarContacto(telefono, m.customerProfile?.name ?? null, esAdmin);
  const conv = await conversacionActual(contacto.id);
  const guardado = await uno(
    `INSERT INTO wa_messages (conversation_id, contact_id, direccion, autor, tipo, cuerpo, provider_message_id, wamid, raw)
     VALUES ($1, $2, 'entrada', $3, $4, $5, $6, $7, $8)
     ON CONFLICT (provider_message_id) DO NOTHING RETURNING id, created_at`,
    [conv.id, contacto.id, esAdmin ? 'john_admin' : 'usuario', tipo, cuerpo, m.id ?? m.wamid ?? null, m.wamid ?? null, JSON.stringify(m)]);
  if (!guardado) return { nota: 'mensaje repetido' };
  await consulta('UPDATE wa_conversations SET ultimo_mensaje_at = now() WHERE id = $1', [conv.id]);
  contacto = await uno('UPDATE wa_contacts SET last_inbound_at = now() WHERE id = $1 RETURNING *', [contacto.id]);

  if (esAdmin) return canalAdmin(contacto, conv, cuerpo, d);
  const activo = await d.datos.botActivo();
  const avisoIaPendiente = !contacto.ai_disclosed_at;

  // F1: BAJA o STOP tal cual. Va antes que el modo humano: una baja se respeta siempre, también cuando John lleva la
  // conversación. Se registra antes de intentar enviar nada; con el bot apagado (PARA TODO) se registra sin contestar.
  if (tipo !== 'media' && BAJA_EXACTA.test(cuerpo)) {
    await d.datos.registrarBaja(contacto, 'total', guardado.id);
    if (!activo) return { baja: 'total', enviado: false, nota: 'bot apagado' };
    const texto = avisoIaPendiente ? `${AVISO_IA} ${CONFIRMACION_BAJA}` : CONFIRMACION_BAJA;
    const envio = await d.enviar({ contacto, conversacionId: conv.id, texto, autor: 'bot' });
    if (envio.ok && avisoIaPendiente) await consulta('UPDATE wa_contacts SET ai_disclosed_at = now() WHERE id = $1', [contacto.id]);
    return { baja: 'total', enviado: envio.ok };
  }

  if (!activo) return { nota: 'bot apagado' };

  // B2: imagen o PDF de alguien con una reserva por Bizum pendiente → acuse y aviso a John con el código para
  // confirmarlo. Va antes del modo humano: es un trámite, no una conversación.
  if (['image', 'document'].includes(m.type)) {
    const pendientes = await bizumPendientesDe(contacto.phone_e164);
    if (pendientes.length) return justificanteBizum({ contacto, conv, pendientes, avisoIaPendiente, d });
    // Resto por Bizum (los 69 € antes de la carrera): plaza reservada con saldo pendiente en la próxima ronda.
    const restos = await restosPendientesDe(contacto.phone_e164);
    if (restos.length) return justificanteResto({ contacto, conv, restos, avisoIaPendiente, d });
  }

  // Botón «Confirmo asistencia» del recordatorio de una semana (D1): se anota sin pasar por Claude y se contesta con
  // un texto fijo (si John lleva la conversación, solo se anota). «Necesito hablar» sigue el camino normal.
  if (tipo === 'interactivo' && /^\s*confirmo asistencia\s*$/i.test(cuerpo)) {
    const { registrarAsistencia } = await import('./asistencia.js');
    const res = await registrarAsistencia(contacto, { va: true, cita: cuerpo });
    if (res.ok && !enModoHumano(contacto)) {
      const base = `Apuntado: te esperamos en la ${res.ronda}. Si al final no puedes ir, avísanos por aquí.`;
      const texto = avisoIaPendiente ? `${AVISO_IA} ${base}` : base;
      const envio = await d.enviar({ contacto, conversacionId: conv.id, texto, autor: 'bot' });
      if (envio.ok && avisoIaPendiente) await consulta('UPDATE wa_contacts SET ai_disclosed_at = now() WHERE id = $1', [contacto.id]);
      return { asistencia: 'confirma', enviado: envio.ok };
    }
    if (res.ok) return { asistencia: 'confirma', nota: `modo ${contacto.modo}` };
  }

  if (enModoHumano(contacto)) {
    // Con la conversación en manos de John el bot no contesta, salvo una urgencia: Haiku revisa cada mensaje y, si hay
    // riesgo para alguien, se manda el texto fijo del 112 y John recibe un aviso URGENTE.
    if (tipo !== 'media') {
      const { clasificador } = await modelos();
      if (await d.urgencia({ modelo: clasificador, texto: cuerpo })) {
        const envio = await d.enviar({ contacto, conversacionId: conv.id, texto: TEXTO_URGENCIA, autor: 'bot' });
        await avisarJohn({
          contacto, conversacionId: conv.id, modelo: clasificador, d,
          escalado: { tipo: 'urgencia', motivo: 'posible urgencia con la conversación en tus manos', resumen: null, urgencia: 'alta', silencia: true },
        });
        return { urgencia: true, enviado: envio.ok };
      }
    }
    return { nota: `modo ${contacto.modo}` };
  }

  // Conversación cortada por fuera de tema: la última respuesta del bot es el texto del corte. Hasta que el contacto
  // escriba algo de RUKC no se contesta (ni se muestra "escribiendo"); lo decide Haiku, sin pasar por el bot normal.
  const ultimoBot = await uno(
    `SELECT cuerpo FROM wa_messages WHERE conversation_id = $1 AND direccion = 'salida' AND autor = 'bot'
     ORDER BY created_at DESC LIMIT 1`, [conv.id]);
  const enCorte = ultimoBot?.cuerpo === TEXTO_CORTE;
  if (!enCorte) d.escribiendo(m.id ?? m.wamid);
  // Varios mensajes seguidos: se espera un momento y solo responde el turno del último (un solo mensaje por turno).
  if (d.esperaAgruparMs) {
    await espera(d.esperaAgruparMs);
    // La comparación se hace en la BD: created_at tiene microsegundos y en JavaScript se pierde precisión, con lo que
    // el propio mensaje parecería posterior a sí mismo.
    const posterior = await uno(
      `SELECT 1 FROM wa_messages m, wa_messages yo
       WHERE yo.id = $2 AND m.contact_id = $1 AND m.direccion = 'entrada' AND m.id <> yo.id
         AND (m.created_at, m.id) > (yo.created_at, yo.id)
       LIMIT 1`,
      [contacto.id, guardado.id]);
    if (posterior) return { nota: 'agrupado con un mensaje posterior' };
  }

  return turnoBot({ contacto, conv, mensajeId: guardado.id, cuerpo, enCorte, avisoIaPendiente, idEntrante: m.id ?? m.wamid, d });
}

/**
 * Turno del bot sobre el último mensaje del contacto: lo usan un mensaje nuevo y la respuesta a lo que quedó
 * pendiente (REANUDA o fin del modo humano). enCorte: la conversación estaba cortada por fuera de tema.
 */
async function turnoBot({ contacto, conv, mensajeId, cuerpo, enCorte, avisoIaPendiente, idEntrante, d }) {
  const { conversacion: modelo, clasificador } = await modelos();
  if (enCorte) {
    const deRukc = await d.clasificar({ modelo: clasificador, texto: cuerpo });
    if (deRukc === false) return { nota: 'cortada por fuera de tema: silencio' };
    if (idEntrante) d.escribiendo(idEntrante);
  }

  const historial = await montarHistorial(conv.id);
  if (!historial.length || historial.at(-1).role !== 'user') return { nota: 'nada que responder' };
  const docs = await d.datos.documentosKb();
  // Reservas del contacto en la base de datos de la web, en cada turno: el bot nunca habla de su plaza sin mirarla.
  const reservas = await d.datos.inscripcionesDe(contacto.phone_e164).catch((e) => { console.error('reservas', e.message); return null; });
  const ctx = { contacto, conversacionId: conv.id, mensajeId, datos: d.datos };
  // Avisos comerciales: el bot pregunta una sola vez (prompts.js, <venta>), así que necesita saber si ya se decidió.
  const [comercial] = await consulta(
    `SELECT accion FROM wa_consents WHERE contact_id = $1 AND tipo = 'comercial' ORDER BY created_at DESC, id DESC LIMIT 1`, [contacto.id])
    .catch(() => [null]);
  const avisosComerciales = contacto.baja && contacto.baja !== 'ninguna' ? 'baja'
    : comercial?.accion === 'otorga' ? 'aceptados' : comercial ? 'rechazados' : 'sin_preguntar';
  const turno = await ejecutarTurno({
    llm: d.llm, modelo, historial, ctx, avisoIaPendiente, limiteMs: d.limiteMs,
    system: systemPublico({
      kbTexto: textoParaPrompt(docs), ahora: ahoraMadrid(), avisoIaPendiente,
      contacto: { nombre: contacto.display_name, rol: contacto.rol, avisos_comerciales: avisosComerciales },
      temasEscalados: (conv.temas_escalados ?? []).filter((t) => t !== 'fallo_tecnico'),
      reservas,
    }),
  });

  // Charla fuera de tema: con esta, 3 de las últimas 4 respuestas del bot marcadas (contando solo desde el último
  // corte) → se manda el texto del corte una vez, se avisa a John y el bot calla hasta que escriba algo de RUKC.
  let texto = turno.texto;
  let corte = null;
  if (turno.fueraDeTema && !turno.escalado) {
    const previas = await consulta(
      `SELECT cuerpo, fuera_de_tema FROM wa_messages WHERE conversation_id = $1 AND direccion = 'salida' AND autor = 'bot'
       ORDER BY created_at DESC LIMIT ${FUERA_DE_TEMA_VENTANA - 1}`, [conv.id]);
    let marcadas = 1;
    for (const p of previas) {
      if (p.cuerpo === TEXTO_CORTE) break;
      if (p.fuera_de_tema) marcadas += 1;
    }
    if (marcadas >= FUERA_DE_TEMA_MAX) {
      texto = TEXTO_CORTE;
      corte = { motivo: 'habla de temas que no son de RUKC', resumen: null, urgencia: 'normal', corte: true };
    }
  }

  const envio = await d.enviar({ contacto, conversacionId: conv.id, texto, autor: 'bot' });
  if (envio.ok && turno.fueraDeTema && envio.id) await consulta('UPDATE wa_messages SET fuera_de_tema = true WHERE id = $1', [envio.id]);
  if (envio.ok && avisoIaPendiente) await consulta('UPDATE wa_contacts SET ai_disclosed_at = now() WHERE id = $1', [contacto.id]);
  const aviso = turno.escalado ?? corte;
  if (aviso) await avisarJohn({ contacto, conversacionId: conv.id, escalado: aviso, modelo: clasificador, d });
  return {
    respondido: envio.ok, ms: turno.ms, fallo: turno.fallo, escalado: Boolean(turno.escalado),
    herramientas: turno.llamadas.map((l) => l.nombre), uso: turno.uso,
  };
}

/**
 * Cuando la conversación vuelve al bot (REANUDA o fin de las horas de John), contesta lo que el contacto escribió y
 * nadie contestó, sin esperar a que vuelva a escribir. Solo dentro de la ventana de 24 h de WhatsApp.
 */
export async function responderPendientes(contactoId, deps = {}) {
  const d = { ...PREDETERMINADAS, ...deps };
  if (!(await d.datos.botActivo())) return { nota: 'bot apagado' };
  const contacto = await uno('SELECT * FROM wa_contacts WHERE id = $1', [contactoId]);
  if (!contacto || contacto.rol === 'admin') return { nota: 'sin contacto' };
  if (enModoHumano(contacto)) return { nota: `modo ${contacto.modo}` };
  if (!contacto.last_inbound_at || Date.now() - new Date(contacto.last_inbound_at).getTime() > VENTANA_ADMIN_MS) {
    return { nota: 'ventana de 24 h cerrada' };
  }
  const conv = await conversacionActual(contacto.id);
  const ultimo = await uno(
    `SELECT id, direccion, cuerpo FROM wa_messages
     WHERE conversation_id = $1 AND (direccion = 'entrada' OR estado IS DISTINCT FROM 'fallido')
     ORDER BY created_at DESC LIMIT 1`, [conv.id]);
  if (!ultimo || ultimo.direccion !== 'entrada') return { nota: 'nada pendiente' };
  const ultimoBot = await uno(
    `SELECT cuerpo FROM wa_messages WHERE conversation_id = $1 AND direccion = 'salida' AND autor = 'bot'
     ORDER BY created_at DESC LIMIT 1`, [conv.id]);
  return turnoBot({
    contacto, conv, mensajeId: ultimo.id, cuerpo: ultimo.cuerpo, enCorte: ultimoBot?.cuerpo === TEXTO_CORTE,
    avisoIaPendiente: !contacto.ai_disclosed_at, idEntrante: null, d,
  });
}

/**
 * Cron cada 10 minutos: conversaciones cuyo modo humano (las 3 h de John o un escalado) ha terminado en las últimas
 * 2 h y cuyo último mensaje es del contacto, sin contestar. El bot lo contesta. Como mucho 20 por pasada.
 */
export async function responderPendientesVencidos(d = {}) {
  const candidatos = await consulta(
    `SELECT c.id FROM wa_contacts c
     WHERE c.rol <> 'admin' AND c.modo <> 'bot' AND c.modo_hasta IS NOT NULL
       AND c.modo_hasta <= now() AND c.modo_hasta > now() - interval '2 hours'
       AND c.last_inbound_at > now() - interval '23 hours'
       AND (SELECT m.direccion FROM wa_messages m WHERE m.contact_id = c.id
              AND (m.direccion = 'entrada' OR m.estado IS DISTINCT FROM 'fallido')
            ORDER BY m.created_at DESC LIMIT 1) = 'entrada'
     ORDER BY c.modo_hasta LIMIT 20`);
  const resultados = [];
  for (const c of candidatos) {
    try {
      resultados.push({ id: c.id, ...(await responderPendientes(c.id, d)) });
    } catch (e) {
      console.error('pendientes', c.id, e.message);
      resultados.push({ id: c.id, error: e.message });
    }
  }
  return { revisados: candidatos.length, respondidos: resultados.filter((r) => r.respondido).length, resultados };
}

/** A4: aviso a John por el canal admin, con el resumen de Haiku y el enlace al chat. */
export async function avisarJohn({ contacto, conversacionId, escalado, modelo, d = PREDETERMINADAS }) {
  const admin = normalizarTelefono(process.env.ADMIN_PHONE_E164);
  if (!admin) { console.error('A4: falta ADMIN_PHONE_E164'); return { ok: false }; }
  const filas = await consulta(
    `SELECT direccion, autor, cuerpo FROM (SELECT direccion, autor, cuerpo, created_at FROM wa_messages
       WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 12) x ORDER BY created_at`, [conversacionId]);
  const transcripcion = filas.map((f) => `${f.direccion === 'entrada' ? 'Contacto' : f.autor === 'john_app' ? 'John' : 'Bot'}: ${f.cuerpo ?? ''}`).join('\n');
  const resumen = (await d.resumir({ modelo, conversacion: transcripcion, motivo: escalado.motivo })) || escalado.resumen || 'Sin resumen.';
  await consulta('UPDATE wa_conversations SET resumen = $2 WHERE id = $1', [conversacionId, resumen.slice(0, 2000)]);
  const quien = [contacto.display_name, contacto.phone_e164, contacto.rol !== 'lead' ? `(${contacto.rol})` : null].filter(Boolean).join(' ');
  const texto = [
    `${escalado.urgencia === 'alta' ? 'URGENTE · ' : ''}${escalado.corte ? 'Aviso del bot' : 'Escalado del bot'}: ${quien}`,
    `Motivo: ${escalado.motivo}`,
    resumen,
    `Chat: https://wa.me/${contacto.phone_e164.slice(1)}`,
    ...(escalado.corte
      ? ['El bot le ha avisado una vez y no le contestará hasta que escriba algo de RUKC. No hace falta que hagas nada.']
      : escalado.silencia
        ? ['El bot no contestará en esta conversación durante 24 h. Contesta desde la app del número RUKC.',
          `Para devolvérsela al bot antes: REANUDA ${contacto.phone_e164}`]
        : [`El bot sigue contestando sus otras dudas, pero este tema lo deja para ti. Cuando contestes desde la app, el bot calla ${MODO_HUMANO_ECO_H} h desde tu último mensaje.`]),
  ].join('\n');
  // Hasta cuándo puede John contestar al contacto con texto libre: 24 h desde su último mensaje.
  const caduca = contacto.last_inbound_at ? new Date(new Date(contacto.last_inbound_at).getTime() + 24 * 3.6e6) : null;
  return enviarAJohn({ texto, automatizacion: 'A4', caduca, d });
}

// --- Mensajes a John con su ventana de 24 h cerrada ------------------------------------------------------------------
// WhatsApp solo deja mandar texto libre a John si ha escrito al número RUKC en las últimas 24 h. Si no, el aviso se
// guarda en wa_outbox (estado "confirmado") y se manda la plantilla aprobada rukc_aviso_admin ("Tienes N acciones de
// RUKC pendientes... Responde a este mensaje para verlas"). Cuando John escribe al canal admin, se le entregan.
const VENTANA_ADMIN_MS = 23.5 * 3.6e6; // con media hora de margen

const fechaCorta = (f) => new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(f).replace(/^(\p{L}+) (\d+), (\d+:\d+)$/u, '$3 del $1 $2');

/** Contacto de John (ADMIN_PHONE_E164) y si su ventana de 24 h está abierta. null si falta el teléfono. */
export async function contactoJohn() {
  const admin = normalizarTelefono(process.env.ADMIN_PHONE_E164);
  if (!admin) return null;
  const contacto = await asegurarContacto(admin, null, true);
  const abierta = Boolean(contacto.last_inbound_at) && Date.now() - new Date(contacto.last_inbound_at).getTime() < VENTANA_ADMIN_MS;
  return { contacto, abierta };
}

/**
 * Manda un aviso a John: directo si su ventana está abierta; si no, lo deja pendiente y le manda la plantilla
 * rukc_aviso_admin. imagen ({ link, caption }) lo manda como imagen (texto queda de respaldo si la imagen falla al
 * entregarla). avisar=false deja el aviso pendiente sin mandar la plantilla, para juntar varios en un solo aviso
 * (después, avisarPendientesJohn).
 */
export async function enviarAJohn({ texto, imagen = null, automatizacion = 'A4', caduca = null, avisar = true, d = PREDETERMINADAS }) {
  const john = await contactoJohn();
  if (!john) { console.error('aviso a John: falta ADMIN_PHONE_E164'); return { ok: false }; }
  const { contacto: adminContacto, abierta } = john;
  const enviar = d.enviar ?? PREDETERMINADAS.enviar;
  if (abierta) {
    if (imagen) {
      const envio = await enviar({ contacto: adminContacto, imagen, autor: 'sistema' });
      if (envio.ok) return envio;
    }
    return enviar({ contacto: adminContacto, texto, autor: 'sistema' });
  }

  await consulta(
    `INSERT INTO wa_outbox (contact_id, automatizacion, variables, enviar_at, estado, idempotency_key)
     VALUES ($1, $2, $3, now(), 'confirmado', $4)`,
    [adminContacto.id, automatizacion, JSON.stringify({ texto, ...(imagen ? { imagen } : {}), caduca: caduca?.toISOString() ?? null }),
      `${automatizacion}:admin:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`]);
  if (!avisar) return { ok: true, pendiente: true, sinAviso: true };
  return avisoPendientes(adminContacto, enviar);
}

/** Un solo aviso (rukc_aviso_admin) por todo lo que John tiene pendiente. Para después de enviarAJohn({ avisar: false }). */
export async function avisarPendientesJohn({ d = PREDETERMINADAS } = {}) {
  const john = await contactoJohn();
  if (!john) return { ok: false };
  return avisoPendientes(john.contacto, d.enviar ?? PREDETERMINADAS.enviar);
}

async function avisoPendientes(adminContacto, enviar) {
  const pendientes = await consulta(
    `SELECT variables->>'caduca' AS caduca FROM wa_outbox
     WHERE contact_id = $1 AND estado = 'confirmado' AND plantilla IS NULL ORDER BY created_at`, [adminContacto.id]);
  const fechas = pendientes.map((p) => p.caduca && new Date(p.caduca)).filter((f) => f && f > new Date()).sort((a, b) => a - b);
  const primera = fechas[0] ?? new Date(Date.now() + 24 * 3.6e6);
  const plantilla = construirPlantilla('rukc_aviso_admin', [String(pendientes.length), fechaCorta(primera)]);
  const envio = await enviar({ contacto: adminContacto, plantilla, autor: 'sistema' });
  return { ...envio, pendiente: true };
}

/** B2: acuse al contacto y aviso a John con la propuesta de confirmar el Bizum (una vez por solicitud viva). */
async function justificanteBizum({ contacto, conv, pendientes, avisoIaPendiente, d }) {
  const s = pendientes[0];
  if (await propuestaViva(s.id)) return { bizum: 'ya avisado', codigo: s.codigo };
  const texto = avisoIaPendiente ? `${AVISO_IA} ${ACUSE_JUSTIFICANTE}` : ACUSE_JUSTIFICANTE;
  const envio = await d.enviar({ contacto, conversacionId: conv.id, texto, autor: 'bot' });
  if (envio.ok && avisoIaPendiente) await consulta('UPDATE wa_contacts SET ai_disclosed_at = now() WHERE id = $1', [contacto.id]);
  const resumen = await proponerAccion('confirmar_bizum', parametrosBizum(s), `Justificante de Bizum recibido de ${contacto.phone_e164}`);
  const aviso = [
    `Justificante de Bizum de ${contacto.display_name || contacto.phone_e164} (${contacto.phone_e164}). Lo tienes en el chat de la app del número RUKC.`,
    ...(pendientes.length > 1 ? [`Tiene ${pendientes.length} reservas por Bizum pendientes; esta es la más reciente. Las demás: ${pendientes.slice(1).map((x) => x.codigo).join(', ')}.`] : []),
    resumen,
    'Si caduca, pídeme "confirma el Bizum de <nombre>" y te doy otro código.',
  ].join('\n\n');
  const caduca = contacto.last_inbound_at ? new Date(new Date(contacto.last_inbound_at).getTime() + 24 * 3.6e6) : null;
  await enviarAJohn({ texto: aviso, automatizacion: 'B2', caduca, d });
  return { bizum: 'aviso a John', codigo: s.codigo, acuse: envio.ok };
}

/** Justificante del resto: acuse al contacto y aviso a John con el código para confirmarlo (una vez por inscripción). */
async function justificanteResto({ contacto, conv, restos, avisoIaPendiente, d }) {
  const viva = await propuestaRestoViva(restos.map((r) => r.id));
  if (viva) return { resto: 'ya avisado', codigo: viva.codigo };
  const texto = avisoIaPendiente ? `${AVISO_IA} ${ACUSE_RESTO}` : ACUSE_RESTO;
  const envio = await d.enviar({ contacto, conversacionId: conv.id, texto, autor: 'bot' });
  if (envio.ok && avisoIaPendiente) await consulta('UPDATE wa_contacts SET ai_disclosed_at = now() WHERE id = $1', [contacto.id]);
  const resumen = await proponerAccion('confirmar_bizum', parametrosResto(restos, { telefono: contacto.phone_e164, nombre: contacto.display_name }),
    `Justificante del resto recibido de ${contacto.phone_e164}`);
  const aviso = [
    `Justificante de Bizum del resto de ${contacto.display_name || contacto.phone_e164} (${contacto.phone_e164}). Lo tienes en el chat de la app del número RUKC.`,
    resumen,
    'Si caduca, pídeme "confirma el Bizum de <nombre>" y te doy otro código.',
  ].join('\n\n');
  const caduca = contacto.last_inbound_at ? new Date(new Date(contacto.last_inbound_at).getTime() + 24 * 3.6e6) : null;
  await enviarAJohn({ texto: aviso, automatizacion: 'B2', caduca, d });
  return { resto: 'aviso a John', acuse: envio.ok };
}

/** Turno con Claude en el canal admin: consultas al momento y acciones como propuestas con código. */
async function turnoAdmin(admin, conv, texto, d) {
  const { conversacion: modelo } = await modelos();
  const historial = await montarHistorial(conv.id);
  if (!historial.length || historial.at(-1).role !== 'user') return { admin: 'nada que responder' };
  const ctx = { contacto: admin, conversacionId: conv.id, datos: d.datos, noEscalar: true, textoOriginal: texto, propuestas: [], reanudados: [] };
  const turno = await ejecutarTurno({
    llm: d.llm, modelo, historial, ctx, definiciones: HERRAMIENTAS_ADMIN, ejecutar: ejecutarHerramientaAdmin,
    system: systemAdmin({ ahora: ahoraMadrid(), pendientes: await accionesPendientes() }),
    limiteMs: d.limiteMs ?? 30000, thinking: null, effort: 'low',
  });
  let salida = turno.fallo
    ? 'No he podido procesar eso ahora mismo. Prueba otra vez o usa una orden fija: ESTADO, PAUSA <teléfono>, REANUDA <teléfono>, PARA TODO.'
    : turno.texto;
  if (ctx.propuestas.length) salida = [salida, ...ctx.propuestas].join('\n\n');
  const envio = await d.enviar({ contacto: admin, conversacionId: conv.id, texto: salida, autor: 'sistema' });
  for (const id of ctx.reanudados) await responderPendientes(id, d);
  return { admin: 'turno', respondido: envio.ok, fallo: turno.fallo, herramientas: turno.llamadas.map((l) => l.nombre), propuestas: ctx.propuestas.length };
}

/** Entrega a John los avisos que esperaban a que abriera su ventana. Devuelve cuántos ha entregado. */
async function entregarPendientesJohn(admin, conv, d) {
  const pendientes = await consulta(
    `SELECT id, variables->>'texto' AS texto, variables->'imagen' AS imagen FROM wa_outbox
     WHERE contact_id = $1 AND estado = 'confirmado' AND plantilla IS NULL ORDER BY created_at`, [admin.id]);
  for (const p of pendientes) {
    // Imágenes (p. ej. las de inscritos): como imagen; si no sale (enlace caducado), el texto con el enlace.
    let envio = p.imagen?.link ? await d.enviar({ contacto: admin, conversacionId: conv.id, imagen: p.imagen, autor: 'sistema' }) : null;
    if (!envio?.ok) envio = await d.enviar({ contacto: admin, conversacionId: conv.id, texto: p.texto, autor: 'sistema' });
    await consulta(`UPDATE wa_outbox SET estado = $2, intentos = intentos + 1, message_id = $3, ultimo_error = $4 WHERE id = $1`,
      [p.id, envio.ok ? 'enviado' : 'fallido', envio.id ?? null, envio.ok ? null : String(envio.error ?? 'error').slice(0, 300)]);
  }
  return pendientes.length;
}

// --- Eco de la app (A3) ----------------------------------------------------------------------------------------------
async function eco(m) {
  // Los mensajes que envía el propio bot por la API no deben silenciarlo: si el eco corresponde a un mensaje ya
  // registrado como saliente, se ignora. Se espera un poco por si el registro del envío aún no ha terminado.
  const nuestro = async () => uno(
    `SELECT id FROM wa_messages WHERE direccion = 'salida' AND autor <> 'john_app'
       AND ((wamid IS NOT NULL AND wamid = $1) OR (provider_message_id IS NOT NULL AND provider_message_id = $2))`,
    [m.wamid ?? null, m.id ?? null]);
  if (await nuestro()) return { nota: 'eco de un mensaje del bot' };
  await espera(2500);
  if (await nuestro()) return { nota: 'eco de un mensaje del bot' };

  const telefono = normalizarTelefono(m.to);
  if (!telefono) return { nota: 'eco sin destinatario' };
  const admin = normalizarTelefono(process.env.ADMIN_PHONE_E164);
  const contacto = await asegurarContacto(telefono, m.customerProfile?.name ?? null, telefono === admin);
  const conv = await conversacionActual(contacto.id);
  const cuerpo = m.type === 'text' ? (m.text?.body ?? '') : `[John ha enviado un mensaje de tipo ${m.type}]`;
  const guardado = await uno(
    `INSERT INTO wa_messages (conversation_id, contact_id, direccion, autor, tipo, cuerpo, provider_message_id, wamid, estado, raw)
     VALUES ($1, $2, 'salida', 'john_app', $3, $4, $5, $6, $7, $8)
     ON CONFLICT (provider_message_id) DO NOTHING RETURNING id`,
    [conv.id, contacto.id, m.type === 'text' ? 'texto' : 'media', cuerpo, m.id ?? null, m.wamid ?? null,
      estadoLocal(m.status) ?? 'enviado', JSON.stringify(m)]);
  if (!guardado) return { nota: 'eco repetido' };
  // John ya está con la conversación: deja de contar como escalada pendiente (los temas se guardan para no repetir avisos).
  await consulta(
    `UPDATE wa_conversations SET ultimo_mensaje_at = now(), estado = CASE WHEN estado = 'escalada' THEN 'abierta' ELSE estado END
     WHERE id = $1`, [conv.id]);
  // Modo humano 3 h desde este mensaje de John: cada mensaje suyo vuelve a contar las 3 h (también si venía de un
  // escalado de 24 h). Una PAUSA indefinida se respeta.
  await consulta(
    `UPDATE wa_contacts SET
       modo = CASE WHEN modo = 'pausado' THEN 'pausado' ELSE 'humano' END,
       modo_hasta = CASE WHEN modo = 'pausado' AND modo_hasta IS NULL THEN NULL
                         ELSE now() + make_interval(hours => $2) END
     WHERE id = $1`, [contacto.id, MODO_HUMANO_ECO_H]);
  return { modo_humano: true };
}

// --- Canal admin (fase 1: órdenes fijas, sin modelo) ----------------------------------------------------------------

async function canalAdmin(admin, conv, texto, d) {
  const t = String(texto || '').trim();
  const responder = (mensaje) => d.enviar({ contacto: admin, conversacionId: conv.id, texto: mensaje, autor: 'sistema' });
  // John acaba de abrir su ventana: primero los avisos que esperaban. Si su mensaje no es una orden (por ejemplo,
  // contesta a la plantilla con "ver"), no hace falta la ayuda.
  const entregados = await entregarPendientesJohn(admin, conv, d);
  const esOrden = /^(para todo|(pausa|reanuda)\s+\S+|estado)\s*$/i.test(t) || CONFIRMO.test(t) || CANCELO.test(t);
  if (entregados && !esOrden) return { admin: 'pendientes entregados', entregados };
  let respuesta;
  let reanudado = null;

  if (/^para\s+todo\s*[.!]*$/i.test(t)) {
    await consulta(`UPDATE bot_settings SET valor = 'false' WHERE clave = 'bot_activo'`);
    const cola = await consulta(
      `UPDATE wa_outbox SET estado = 'cancelado', ultimo_error = 'PARA TODO'
       WHERE estado IN ('borrador', 'pendiente_confirmacion', 'confirmado') RETURNING id`);
    await consulta(`UPDATE wa_batches SET estado = 'cancelado' WHERE estado IN ('propuesto', 'confirmado')`);
    respuesta = `Hecho: el bot está parado y no contestará a nadie. Envíos cancelados: ${cola.length}. Para volver a encenderlo: REANUDA TODO.`;
  } else if (CONFIRMO.test(t)) {
    const [, codigo, pin] = t.match(CONFIRMO);
    respuesta = await confirmarAccion({ codigo, pin, d: { ...d, responderPendientes } });
  } else if (CANCELO.test(t)) {
    respuesta = await cancelarAccion(t.match(CANCELO)[1]);
  } else if (/^reanuda\s+todo\s*[.!]?\s*$/i.test(t)) {
    respuesta = await proponerReactivacion(t);
  } else if (/^(pausa|reanuda)\s+\S+/i.test(t)) {
    const [orden, ...resto] = t.split(/\s+/);
    const tel = normalizarTelefono(resto.join(''));
    if (!tel) respuesta = 'No entiendo ese teléfono. Ejemplo: PAUSA +34600000000';
    else {
      const pausa = /^pausa$/i.test(orden);
      const c = await uno(
        `UPDATE wa_contacts SET modo = $2, modo_hasta = CASE WHEN $2 = 'bot' THEN now() END WHERE phone_e164 = $1 RETURNING id, phone_e164`,
        [tel, pausa ? 'pausado' : 'bot']);
      if (c && !pausa) {
        await consulta(
          `UPDATE wa_conversations SET estado = 'abierta' WHERE estado = 'escalada'
             AND contact_id = (SELECT id FROM wa_contacts WHERE phone_e164 = $1)`, [tel]);
      }
      respuesta = !c ? `No hay ninguna conversación con ${tel}.`
        : pausa ? `Hecho: el bot no contestará a ${tel} hasta que escribas REANUDA ${tel}.`
          : `Hecho: el bot vuelve a contestar a ${tel}. Si tiene algo sin contestar, se lo contesta ahora.`;
      if (c && !pausa) reanudado = c.id;
    }
  } else if (/^estado\s*$/i.test(t)) {
    const e = await uno(
      `SELECT (SELECT valor FROM bot_settings WHERE clave = 'bot_activo') AS activo,
              (SELECT count(*) FROM wa_contacts WHERE modo <> 'bot' AND (modo_hasta IS NULL OR modo_hasta > now())) AS en_humano,
              (SELECT count(*) FROM wa_conversations WHERE estado = 'escalada') AS escaladas,
              (SELECT count(*) FROM wa_messages WHERE direccion = 'salida' AND estado = 'fallido' AND created_at > now() - interval '24 hours') AS fallidos`);
    respuesta = `Bot ${e.activo === 'false' ? 'PARADO' : 'activo'}. Conversaciones en manos de John o en pausa: ${e.en_humano}. Escaladas abiertas: ${e.escaladas}. Envíos fallidos en 24 h: ${e.fallidos}.`;
  } else {
    return turnoAdmin(admin, conv, t, d);
  }
  const envio = await responder(respuesta);
  const pendiente = reanudado ? await responderPendientes(reanudado, d) : null;
  return { admin: true, respondido: envio.ok, pendiente };
}
