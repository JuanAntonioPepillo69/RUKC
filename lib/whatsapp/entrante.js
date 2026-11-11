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
import { esDeRukc, llmAnthropic, modelos, resumirEscalado } from '../bot/llm.js';
import { ahoraMadrid, systemPublico } from '../bot/prompts.js';
import { AVISO_IA, ejecutarTurno } from '../bot/turn.js';
import { actualizarEstado, enviar, escribiendo, estadoLocal } from './client.js';

export const MODO_HUMANO_ECO_H = 12;
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
export const CONFIRMACION_BAJA = 'Hecho, te he dado de baja y no te enviaremos más mensajes. Si algún día nos escribes, te contestamos por aquí.';

const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const uno = async (t, p) => (await consulta(t, p))[0] ?? null;

/** Dependencias sustituibles en los tests. */
const PREDETERMINADAS = { llm: llmAnthropic, datos: datosBot, enviar, escribiendo, resumir: resumirEscalado, clasificar: esDeRukc, esperaAgruparMs: 1500 };

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

/** Historial de la conversación para Claude: entradas → user, salidas → assistant; turnos del mismo rol unidos. */
export async function montarHistorial(conversacionId) {
  const filas = await consulta(
    `SELECT * FROM (SELECT direccion, autor, tipo, plantilla, cuerpo, created_at FROM wa_messages
       WHERE conversation_id = $1 AND (direccion = 'entrada' OR estado IS DISTINCT FROM 'fallido')
       ORDER BY created_at DESC LIMIT $2) x ORDER BY created_at`, [conversacionId, MENSAJES_HISTORIAL]);
  const mensajes = [];
  for (const f of filas) {
    const role = f.direccion === 'entrada' ? 'user' : 'assistant';
    let texto = f.tipo === 'plantilla' ? `[Plantilla enviada: ${f.plantilla}]` : (f.cuerpo || '').trim();
    if (f.autor === 'john_app') texto = `[John, desde la app] ${texto}`;
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
  if (enModoHumano(contacto)) return { nota: `modo ${contacto.modo}` };
  if (conv.estado === 'escalada') await consulta(`UPDATE wa_conversations SET estado = 'abierta' WHERE id = $1`, [conv.id]);

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

  const { conversacion: modelo, clasificador } = await modelos();
  if (enCorte) {
    const deRukc = await d.clasificar({ modelo: clasificador, texto: cuerpo });
    if (deRukc === false) return { nota: 'cortada por fuera de tema: silencio' };
    d.escribiendo(m.id ?? m.wamid);
  }

  const historial = await montarHistorial(conv.id);
  if (!historial.length || historial.at(-1).role !== 'user') return { nota: 'nada que responder' };
  const docs = await d.datos.documentosKb();
  const ctx = { contacto, conversacionId: conv.id, mensajeId: guardado.id, datos: d.datos };
  const turno = await ejecutarTurno({
    llm: d.llm, modelo, historial, ctx, avisoIaPendiente, limiteMs: d.limiteMs,
    system: systemPublico({
      kbTexto: textoParaPrompt(docs), ahora: ahoraMadrid(), avisoIaPendiente,
      contacto: { nombre: contacto.display_name, rol: contacto.rol },
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
      : ['El bot no contestará en esta conversación durante 24 h. Contesta desde la app del número RUKC.',
        `Para devolvérsela al bot antes: REANUDA ${contacto.phone_e164}`]),
  ].join('\n');
  const adminContacto = await asegurarContacto(admin, null, true);
  return d.enviar({ contacto: adminContacto, texto, autor: 'sistema' });
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
  await consulta('UPDATE wa_conversations SET ultimo_mensaje_at = now() WHERE id = $1', [conv.id]);
  // Modo humano 12 h desde este mensaje (sin acortar una pausa más larga o indefinida).
  await consulta(
    `UPDATE wa_contacts SET
       modo = CASE WHEN modo = 'pausado' THEN 'pausado' ELSE 'humano' END,
       modo_hasta = CASE WHEN modo = 'pausado' AND modo_hasta IS NULL THEN NULL
                         ELSE greatest(coalesce(modo_hasta, now()), now() + make_interval(hours => $2)) END
     WHERE id = $1`, [contacto.id, MODO_HUMANO_ECO_H]);
  return { modo_humano: true };
}

// --- Canal admin (fase 1: órdenes fijas, sin modelo) ----------------------------------------------------------------
const AYUDA_ADMIN = 'Canal admin RUKC (fase 1). Órdenes: PARA TODO · PAUSA +34600000000 · REANUDA +34600000000 · ESTADO. El resto de órdenes llega en la fase 2.';

async function canalAdmin(admin, conv, texto, d) {
  const t = String(texto || '').trim();
  const responder = (mensaje) => d.enviar({ contacto: admin, conversacionId: conv.id, texto: mensaje, autor: 'sistema' });
  let respuesta;

  if (/^para\s+todo\s*[.!]*$/i.test(t)) {
    await consulta(`UPDATE bot_settings SET valor = 'false' WHERE clave = 'bot_activo'`);
    const cola = await consulta(
      `UPDATE wa_outbox SET estado = 'cancelado', ultimo_error = 'PARA TODO'
       WHERE estado IN ('borrador', 'pendiente_confirmacion', 'confirmado') RETURNING id`);
    await consulta(`UPDATE wa_batches SET estado = 'cancelado' WHERE estado IN ('propuesto', 'confirmado')`);
    respuesta = `Hecho: el bot está parado y no contestará a nadie. Envíos cancelados: ${cola.length}. Para reactivarlo en la fase 1: npm run bot:interruptor -- on`;
  } else if (/^(pausa|reanuda)\s+\S+/i.test(t)) {
    const [orden, ...resto] = t.split(/\s+/);
    const tel = normalizarTelefono(resto.join(''));
    if (!tel) respuesta = 'No entiendo ese teléfono. Ejemplo: PAUSA +34600000000';
    else {
      const pausa = /^pausa$/i.test(orden);
      const c = await uno(
        `UPDATE wa_contacts SET modo = $2, modo_hasta = NULL WHERE phone_e164 = $1 RETURNING phone_e164`, [tel, pausa ? 'pausado' : 'bot']);
      respuesta = !c ? `No hay ninguna conversación con ${tel}.`
        : pausa ? `Hecho: el bot no contestará a ${tel} hasta que escribas REANUDA ${tel}.`
          : `Hecho: el bot vuelve a contestar a ${tel}.`;
    }
  } else if (/^estado\s*$/i.test(t)) {
    const e = await uno(
      `SELECT (SELECT valor FROM bot_settings WHERE clave = 'bot_activo') AS activo,
              (SELECT count(*) FROM wa_contacts WHERE modo <> 'bot' AND (modo_hasta IS NULL OR modo_hasta > now())) AS en_humano,
              (SELECT count(*) FROM wa_conversations WHERE estado = 'escalada') AS escaladas,
              (SELECT count(*) FROM wa_messages WHERE direccion = 'salida' AND estado = 'fallido' AND created_at > now() - interval '24 hours') AS fallidos`);
    respuesta = `Bot ${e.activo === 'false' ? 'PARADO' : 'activo'}. Conversaciones en manos de John o en pausa: ${e.en_humano}. Escaladas abiertas: ${e.escaladas}. Envíos fallidos en 24 h: ${e.fallidos}.`;
  } else {
    respuesta = AYUDA_ADMIN;
  }
  const envio = await responder(respuesta);
  return { admin: true, respondido: envio.ok };
}
