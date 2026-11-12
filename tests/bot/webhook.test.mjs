// Webhook de WhatsApp de punta a punta contra la rama de desarrollo de Neon (criterios 2, 3, 4, 7, 8 y 9 de la
// fase 1 y el interruptor bot_activo). YCloud y Claude se simulan: no sale ninguna petición a internet salvo a Neon.
// Crea contactos de prueba con teléfonos +34699… y los borra al terminar (con el rol de migraciones, porque
// rukc_app no puede borrar consentimientos).
// Uso: npm run bot:test   (necesita DATABASE_URL y DATABASE_URL_MIGRACIONES en .env)
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from '@neondatabase/serverless';
import { firmar } from '../../lib/whatsapp/signature.js';

if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');
const sufijo = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
const ADMIN = `+34699${sufijo()}`;
const SECRETO = 'whsec_prueba_bot';
Object.assign(process.env, {
  YCLOUD_WEBHOOK_SECRET: SECRETO, YCLOUD_API_KEY: 'clave_simulada', YCLOUD_PHONE_E164: '+34602072802', ADMIN_PHONE_E164: ADMIN,
  BOT_MODEL_CONVERSATION: 'modelo-simulado', BOT_MODEL_CLASSIFIER: 'modelo-simulado',
});
const { manejar } = await import('../../api/wa/webhook.js');
const { AVISO_IA, TEXTO_FALLO } = await import('../../lib/bot/turn.js');
const { TEXTO_CORTE, TEXTO_URGENCIA } = await import('../../lib/whatsapp/entrante.js');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = async (t, p) => (await pool.query(t, p)).rows;
const telefonos = [ADMIN];
const nuevoTelefono = () => { const t = `+34699${sufijo()}`; telefonos.push(t); return t; };

// --- YCloud simulado -------------------------------------------------------------------------------------------
let envios = [];
let n = 0;
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.ycloud.com/')) return fetchReal(url, init);
  if (u.endsWith('/typing')) return Response.json({ success: true });
  const cuerpo = JSON.parse(init.body);
  n += 1;
  const r = { id: `yc_prueba_${Date.now()}_${n}`, wamid: `wamid.prueba.${Date.now()}.${n}`, status: 'accepted', ...cuerpo };
  envios.push(r);
  return Response.json(r);
};
const enviadosA = (tel) => envios.filter((e) => e.to === tel);

// --- Claude simulado ---------------------------------------------------------------------------------------------
const respuesta = (content, stop_reason = 'end_turn') => ({ stop_reason, content, usage: { input_tokens: 10, output_tokens: 5 } });
const texto = (t) => respuesta([{ type: 'text', text: t }]);
const usoHerramienta = (name, input, id = `tu_${Math.random()}`) => ({ type: 'tool_use', id, name, input });
let llamadasLlm = 0;
let ultimosMensajes = null;
const llm = {
  async crear(params) {
    llamadasLlm += 1;
    ultimosMensajes = params.messages;
    const ultimo = params.messages.at(-1);
    if (Array.isArray(ultimo.content)) return texto('Esto lo tiene que ver John, ya se lo he pasado y te contesta él.');
    // Los mensajes seguidos del contacto llegan juntos: cuenta el último.
    const t = ultimo.content.toLowerCase().split('\n').at(-1);
    if (t.includes('devolv')) return respuesta([usoHerramienta('escalar_a_john', { tipo: 'devolucion_o_cambio', motivo: 'pide reembolso', resumen: 'Quiere la devolución de la reserva.', urgencia: 'normal' })], 'tool_use');
    if (t.includes('una persona')) return respuesta([usoHerramienta('escalar_a_john', { tipo: 'hablar_con_persona', motivo: 'pide hablar con una persona', resumen: 'Quiere hablar con John.', urgencia: 'normal' })], 'tool_use');
    if (t.includes('muchas herramientas')) {
      return respuesta([1, 2, 3, 4, 5].map((i) => usoHerramienta('consultar_rondas', { solo_abiertas: true }, `tu_${i}`)), 'tool_use');
    }
    if (t.includes('lento')) return new Promise(() => {});
    if (t.includes('paella')) return texto('[FT] De eso no te puedo ayudar, yo solo llevo lo de RUKC.');
    return texto('Qué tal crack! Cada ronda son 99 €, con 30 € de reserva.');
  },
};
// Clasificador de tema simulado (Haiku): todo lo que hable de paella es fuera de tema.
const clasificados = [];
const clasificar = async ({ texto }) => { clasificados.push(texto); return !/paella/i.test(texto); };
// Detector de urgencias simulado (Haiku): sangre o desmayo.
const urgencia = async ({ texto }) => /sangr|desmay/i.test(texto);
const deps = { llm, esperar: true, esperaAgruparMs: 0, resumir: async () => 'Resumen simulado.', clasificar, urgencia, limiteMs: 500 };

// --- Avisos de YCloud ---------------------------------------------------------------------------------------------
let ev = 0;
const idEvento = () => `evt_prueba_${Date.now()}_${(ev += 1)}`;
const entrante = (from, body, extra = {}) => ({
  id: idEvento(), type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date().toISOString(),
  whatsappInboundMessage: {
    id: `in_${Date.now()}_${ev}`, wamid: `wamid.in.${Date.now()}.${ev}`, from, to: '+34602072802',
    customerProfile: { name: 'Prueba Bot' }, type: 'text', text: { body }, ...extra,
  },
});
const eco = (to, body, extra = {}) => ({
  id: idEvento(), type: 'whatsapp.smb.message.echoes', apiVersion: 'v2', createTime: new Date().toISOString(),
  whatsappMessage: { id: `echo_${Date.now()}_${ev}`, wamid: `wamid.echo.${Date.now()}.${ev}`, from: '+34602072802', to, type: 'text', text: { body }, status: 'sent', ...extra },
});
function peticion(evento, { firma = true, cuerpo } = {}) {
  const raw = cuerpo ?? JSON.stringify(evento);
  return new Request('https://raceupkc-pruebas.vercel.app/api/wa/webhook', {
    method: 'POST', body: raw,
    headers: { 'Content-Type': 'application/json', 'YCloud-Signature': firma ? firmar(raw, SECRETO) : firmar(raw, 'otro_secreto') },
  });
}
const enviarAviso = async (evento, opciones) => manejar(peticion(evento, opciones), deps);
const contacto = async (tel) => (await q('SELECT * FROM wa_contacts WHERE phone_e164 = $1', [tel]))[0];

before(async () => {
  await q(`UPDATE bot_settings SET valor = 'true' WHERE clave = 'bot_activo'`);
});

after(async () => {
  globalThis.fetch = fetchReal;
  await q(`UPDATE bot_settings SET valor = 'true' WHERE clave = 'bot_activo'`);
  await pool.end();
  const url = process.env.DATABASE_URL_MIGRACIONES;
  if (!url) return console.warn('Sin DATABASE_URL_MIGRACIONES: los contactos de prueba se quedan en la rama de desarrollo.');
  const limpia = new Pool({ connectionString: url });
  const ids = (await limpia.query('SELECT id FROM wa_contacts WHERE phone_e164 = ANY($1)', [telefonos])).rows.map((r) => r.id);
  for (const t of ['wa_consents', 'wa_outbox', 'wa_messages', 'wa_conversations']) {
    await limpia.query(`DELETE FROM ${t} WHERE contact_id = ANY($1::uuid[])`, [ids]);
  }
  await limpia.query('DELETE FROM wa_contacts WHERE id = ANY($1::uuid[])', [ids]);
  await limpia.query(`DELETE FROM wa_webhook_events WHERE provider_event_id LIKE 'evt_prueba_%'`);
  await limpia.end();
});

// --- Pruebas -----------------------------------------------------------------------------------------------------
test('criterio 2: firma inválida → 401 y no dispara nada', async () => {
  const tel = nuevoTelefono();
  const evento = entrante(tel, 'Hola');
  const res = await enviarAviso(evento, { firma: false });
  assert.equal(res.status, 401);
  assert.equal((await q('SELECT count(*)::int AS n FROM wa_webhook_events WHERE provider_event_id = $1', [evento.id]))[0].n, 0);
  assert.equal(await contacto(tel), undefined);
  assert.equal(enviadosA(tel).length, 0);

  const sinCabecera = await manejar(new Request('https://x.vercel.app/api/wa/webhook', { method: 'POST', body: JSON.stringify(evento) }), deps);
  assert.equal(sinCabecera.status, 401);
});

test('criterio 3: el mismo evento dos veces → una sola respuesta', async () => {
  const tel = nuevoTelefono();
  const evento = entrante(tel, 'Hola');
  const r1 = await enviarAviso(evento);
  const r2 = await enviarAviso(evento);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal((await r2.json()).duplicado, true);
  assert.equal(enviadosA(tel).length, 1);
});

test('criterio 4: el primer mensaje lleva el aviso de IA y el segundo no', async () => {
  const tel = nuevoTelefono();
  await enviarAviso(entrante(tel, 'Hola'));
  await enviarAviso(entrante(tel, 'Cuánto cuesta'));
  const [primero, segundo] = enviadosA(tel).map((e) => e.text.body);
  assert.ok(primero.startsWith(AVISO_IA), primero);
  assert.ok(!/asistente autom/i.test(segundo), segundo);
  assert.ok((await contacto(tel)).ai_disclosed_at);
  const mensajes = await q(`SELECT direccion, autor FROM wa_messages m JOIN wa_contacts c ON c.id = m.contact_id
    WHERE c.phone_e164 = $1 ORDER BY m.created_at`, [tel]);
  assert.deepEqual(mensajes.map((m) => `${m.direccion}:${m.autor}`), ['entrada:usuario', 'salida:bot', 'entrada:usuario', 'salida:bot']);
});

test('criterio 7 (cambiado por John): la devolución avisa a John una vez y el bot sigue con las demás dudas', async () => {
  const tel = nuevoTelefono();
  await enviarAviso(entrante(tel, 'Quiero que me devolváis la reserva'));
  assert.match(enviadosA(tel)[0].text.body, /John/);
  const aviso = enviadosA(ADMIN).at(-1);
  assert.ok(aviso, 'John no ha recibido el aviso');
  assert.match(aviso.text.body, /Escalado del bot/);
  assert.match(aviso.text.body, /pide reembolso/);
  assert.match(aviso.text.body, /sigue contestando sus otras dudas/);
  assert.match(aviso.text.body, new RegExp(`wa\.me/${tel.slice(1)}`));
  const c = await contacto(tel);
  assert.equal(c.modo, 'bot', 'una devolución no deja al contacto sin respuesta');
  const [conv] = await q(`SELECT estado, temas_escalados, resumen FROM wa_conversations WHERE contact_id = $1`, [c.id]);
  assert.equal(conv.estado, 'escalada');
  assert.deepEqual(conv.temas_escalados, ['devolucion_o_cambio']);
  assert.equal(conv.resumen, 'Resumen simulado.');

  // Otra duda: el bot contesta.
  await enviarAviso(entrante(tel, 'Y cuánto cuesta la ronda?'));
  assert.equal(enviadosA(tel).length, 2);
  assert.match(enviadosA(tel).at(-1).text.body, /99 €/);
  // Insiste con la devolución: no se vuelve a avisar a John.
  const avisos = enviadosA(ADMIN).length;
  await enviarAviso(entrante(tel, 'Entonces me devolvéis el dinero o no?'));
  assert.equal(enviadosA(tel).length, 3);
  assert.equal(enviadosA(ADMIN).length, avisos, 'un tema ya escalado no vuelve a avisar a John');
});

test('pedir hablar con una persona sí pasa la conversación a John y el bot calla', async () => {
  const tel = nuevoTelefono();
  await enviarAviso(entrante(tel, 'Quiero hablar con una persona'));
  assert.equal((await contacto(tel)).modo, 'humano');
  assert.match(enviadosA(ADMIN).at(-1).text.body, /REANUDA/);
  const antes = llamadasLlm;
  await enviarAviso(entrante(tel, 'Hola? Me contestáis?'));
  assert.equal(enviadosA(tel).length, 1, 'el bot ha vuelto a contestar');
  assert.equal(llamadasLlm, antes, 'se ha llamado a Claude en modo humano');
});

test('criterio 8 (cambiado por John): si John contesta desde la app, el bot calla 3 h desde su último mensaje', async () => {
  const tel = nuevoTelefono();
  await enviarAviso(entrante(tel, 'Quiero hablar con una persona'));
  await enviarAviso(eco(tel, 'Hola, soy John, te cuento yo'));
  let c = await contacto(tel);
  assert.equal(c.modo, 'humano');
  const horas = (fecha) => (new Date(fecha) - Date.now()) / 3.6e6;
  assert.ok(horas(c.modo_hasta) > 2.9 && horas(c.modo_hasta) <= 3.01, `modo_hasta a ${horas(c.modo_hasta)} h (el escalado de 24 h pasa a 3 h)`);
  const [conv] = await q(`SELECT estado FROM wa_conversations WHERE contact_id = $1`, [c.id]);
  assert.equal(conv.estado, 'abierta', 'con John en la conversación deja de estar pendiente');
  await enviarAviso(entrante(tel, 'Vale, gracias'));
  assert.equal(enviadosA(tel).length, 1);
  // Otro mensaje de John: las 3 h vuelven a contar desde ahí.
  const antes = new Date(c.modo_hasta);
  await new Promise((ok) => setTimeout(ok, 50));
  await enviarAviso(eco(tel, 'Te lo miro y te digo'));
  c = await contacto(tel);
  assert.ok(new Date(c.modo_hasta) > antes);
  const [m] = await q(`SELECT autor, cuerpo FROM wa_messages WHERE contact_id = $1 AND autor = 'john_app' ORDER BY created_at LIMIT 1`, [c.id]);
  assert.equal(m.cuerpo, 'Hola, soy John, te cuento yo');
});

test('el eco de un mensaje que envió el propio bot no lo silencia', async () => {
  const tel = nuevoTelefono();
  await enviarAviso(entrante(tel, 'Hola'));
  const propio = enviadosA(tel)[0];
  await enviarAviso(eco(tel, propio.text.body, { id: `otro_${Date.now()}`, wamid: propio.wamid }));
  assert.equal((await contacto(tel)).modo, 'bot');
});

test('criterio 9: BAJA confirma y queda en wa_contacts y wa_consents', async () => {
  const tel = nuevoTelefono();
  await enviarAviso(entrante(tel, 'Hola'));
  const antes = llamadasLlm;
  await enviarAviso(entrante(tel, 'BAJA'));
  assert.equal(llamadasLlm, antes, 'la baja no debe pasar por Claude');
  assert.match(enviadosA(tel).at(-1).text.body, /baja/i);
  const c = await contacto(tel);
  assert.equal(c.baja, 'total');
  const consentimientos = await q(`SELECT tipo, accion, fuente FROM wa_consents WHERE contact_id = $1 ORDER BY tipo`, [c.id]);
  assert.deepEqual(consentimientos, [
    { tipo: 'comercial', accion: 'revoca', fuente: 'whatsapp' },
    { tipo: 'operativo', accion: 'revoca', fuente: 'whatsapp' },
  ]);
  // La baja total corta los envíos de RUKC, no las respuestas a lo que el contacto escriba.
  await enviarAviso(entrante(tel, 'Una pregunta más'));
  assert.equal(enviadosA(tel).length, 3);
});

test('BAJA se respeta también en modo humano y con el bot apagado', async () => {
  const tel = nuevoTelefono();
  await enviarAviso(entrante(tel, 'Hola'));
  await enviarAviso(eco(tel, 'Te cuento yo'));
  assert.equal((await contacto(tel)).modo, 'humano');
  await enviarAviso(entrante(tel, 'Baja'));
  assert.equal((await contacto(tel)).baja, 'total');
  assert.match(enviadosA(tel).at(-1).text.body, /baja/i);

  const tel2 = nuevoTelefono();
  await enviarAviso(entrante(tel2, 'Hola'));
  await q(`UPDATE bot_settings SET valor = 'false' WHERE clave = 'bot_activo'`);
  try {
    await enviarAviso(entrante(tel2, 'BAJA'));
    assert.equal((await contacto(tel2)).baja, 'total');
    assert.equal(enviadosA(tel2).length, 1, 'con el bot apagado no se contesta');
  } finally {
    await q(`UPDATE bot_settings SET valor = 'true' WHERE clave = 'bot_activo'`);
  }
});

test('charla fuera de tema: a la tercera, texto fijo una vez, silencio y vuelve cuando habla de RUKC', async () => {
  const tel = nuevoTelefono();
  await enviarAviso(entrante(tel, 'Hola'));
  await enviarAviso(entrante(tel, 'Receta de paella'));
  await enviarAviso(entrante(tel, 'Otra paella'));
  const enviados = enviadosA(tel);
  assert.equal(enviados.length, 3);
  for (const e of enviados) assert.doesNotMatch(e.text.body, /\[FT\]/);
  const avisosAntes = enviadosA(ADMIN).length;
  await enviarAviso(entrante(tel, 'Y la paella valenciana?'));
  assert.equal(enviadosA(tel).at(-1).text.body, TEXTO_CORTE);
  assert.equal((await contacto(tel)).modo, 'bot', 'el corte no pasa la conversación a John');
  assert.equal(enviadosA(ADMIN).length, avisosAntes + 1);
  assert.match(enviadosA(ADMIN).at(-1).text.body, /Aviso del bot/);
  assert.match(enviadosA(ADMIN).at(-1).text.body, /hasta que escriba algo de RUKC/);

  // Fuera de tema otra vez: lo decide el clasificador, sin llamar al bot normal y sin contestar.
  const antes = llamadasLlm;
  const clasificadosAntes = clasificados.length;
  await enviarAviso(entrante(tel, 'Más paella'));
  await enviarAviso(entrante(tel, 'paella paella'));
  assert.equal(enviadosA(tel).length, 4, 'el texto del corte se manda una sola vez');
  assert.equal(llamadasLlm, antes, 'durante el corte no se llama al bot normal');
  assert.deepEqual(clasificados.slice(clasificadosAntes), ['Más paella', 'paella paella']);

  // Algo de RUKC: vuelve a contestar.
  await enviarAviso(entrante(tel, 'Cuánto cuesta una ronda?'));
  assert.equal(enviadosA(tel).length, 5);
  assert.match(enviadosA(tel).at(-1).text.body, /99 €/);
  // Y ya no está en corte: el siguiente mensaje no pasa por el clasificador.
  const c2 = clasificados.length;
  await enviarAviso(entrante(tel, 'Y la reserva?'));
  assert.equal(clasificados.length, c2);
});

test('REANUDA: el bot no tiene en cuenta lo que el contacto escribió mientras la llevaba John', async () => {
  const tel = nuevoTelefono();
  await enviarAviso(entrante(tel, 'Hola'));
  await enviarAviso(entrante(tel, 'Quiero que me devolváis la reserva'));
  await enviarAviso(entrante(tel, 'Quiero hablar con una persona'));
  assert.equal((await contacto(tel)).modo, 'humano');
  await enviarAviso(entrante(tel, 'Sois unos inútiles'));
  await enviarAviso(entrante(tel, 'Contestad ya'));
  await enviarAviso(entrante(ADMIN, `REANUDA ${tel}`));
  assert.equal((await contacto(tel)).modo, 'bot');
  await enviarAviso(entrante(tel, 'Hola de nuevo'));
  const ultimo = ultimosMensajes.at(-1);
  assert.equal(ultimo.role, 'user');
  assert.equal(ultimo.content, 'Hola de nuevo');
  assert.ok(!JSON.stringify(ultimosMensajes).includes('inútiles'), 'lo escrito durante el modo humano no llega al bot');
  assert.ok(JSON.stringify(ultimosMensajes).includes('devolváis'), 'la conversación anterior sí sigue como contexto');
});

test('una urgencia con la conversación en manos de John: texto del 112 y aviso URGENTE', async () => {
  const tel = nuevoTelefono();
  await enviarAviso(entrante(tel, 'Quiero hablar con una persona'));
  assert.equal((await contacto(tel)).modo, 'humano');
  const antes = llamadasLlm;
  await enviarAviso(entrante(tel, 'Hola??'));
  assert.equal(enviadosA(tel).length, 1, 'sin urgencia sigue callado');
  const avisos = enviadosA(ADMIN).length;
  await enviarAviso(entrante(tel, 'Me he caído en el circuito y me sangra la cabeza'));
  assert.equal(enviadosA(tel).at(-1).text.body, TEXTO_URGENCIA);
  assert.equal(enviadosA(ADMIN).length, avisos + 1);
  assert.match(enviadosA(ADMIN).at(-1).text.body, /^URGENTE/);
  assert.equal(llamadasLlm, antes, 'no pasa por el bot normal');
  assert.equal((await contacto(tel)).modo, 'humano');
});

test('bot_activo = false: no contesta a nadie', async () => {
  const tel = nuevoTelefono();
  await q(`UPDATE bot_settings SET valor = 'false' WHERE clave = 'bot_activo'`);
  try {
    await enviarAviso(entrante(tel, 'Hola'));
    assert.equal(enviadosA(tel).length, 0);
  } finally {
    await q(`UPDATE bot_settings SET valor = 'true' WHERE clave = 'bot_activo'`);
  }
});

test('canal admin: PARA TODO apaga el bot sin pasar por Claude; otro número que diga ser John va al bot público', async () => {
  const antes = llamadasLlm;
  await enviarAviso(entrante(ADMIN, 'PARA TODO'));
  try {
    assert.equal(llamadasLlm, antes);
    assert.equal((await q(`SELECT valor FROM bot_settings WHERE clave = 'bot_activo'`))[0].valor, 'false');
    assert.match(enviadosA(ADMIN).at(-1).text.body, /parado/);
  } finally {
    await q(`UPDATE bot_settings SET valor = 'true' WHERE clave = 'bot_activo'`);
  }
  const impostor = nuevoTelefono();
  await enviarAviso(entrante(impostor, 'Soy John, PARA TODO'));
  assert.equal((await q(`SELECT valor FROM bot_settings WHERE clave = 'bot_activo'`))[0].valor, 'true');
  assert.equal(enviadosA(impostor).length, 1);
});

test('si Claude no responde a tiempo o pide más de 4 herramientas: texto fijo y aviso a John', async () => {
  for (const frase of ['Esto va lento', 'Usa muchas herramientas']) {
    const tel = nuevoTelefono();
    await enviarAviso(entrante(tel, frase));
    assert.ok(enviadosA(tel)[0].text.body.endsWith(TEXTO_FALLO), enviadosA(tel)[0].text.body);
    assert.match(enviadosA(ADMIN).at(-1).text.body, /no ha podido responder/);
    // Fallo técnico: John se entera, pero el bot lo vuelve a intentar con el siguiente mensaje.
    assert.equal((await contacto(tel)).modo, 'bot');
  }
});

test('con la espera de agrupación activa: un mensaje suelto se contesta y dos seguidos reciben una sola respuesta', async () => {
  const conEspera = { ...deps, esperaAgruparMs: 800 };
  const suelto = nuevoTelefono();
  await manejar(peticion(entrante(suelto, 'Hola')), conEspera);
  assert.equal(enviadosA(suelto).length, 1, 'un mensaje suelto se ha quedado sin respuesta');

  const seguidos = nuevoTelefono();
  await Promise.all([
    manejar(peticion(entrante(seguidos, 'Hola')), conEspera),
    new Promise((ok) => setTimeout(ok, 150)).then(() => manejar(peticion(entrante(seguidos, 'Cuánto cuesta?')), conEspera)),
  ]);
  assert.equal(enviadosA(seguidos).length, 1);
});

test('whatsapp.message.updated actualiza el estado del mensaje enviado', async () => {
  const tel = nuevoTelefono();
  await enviarAviso(entrante(tel, 'Hola'));
  const enviado = enviadosA(tel)[0];
  await enviarAviso({ id: idEvento(), type: 'whatsapp.message.updated', whatsappMessage: { id: enviado.id, wamid: enviado.wamid, status: 'delivered', pricingCategory: 'service' } });
  await enviarAviso({ id: idEvento(), type: 'whatsapp.message.updated', whatsappMessage: { id: enviado.id, wamid: enviado.wamid, status: 'sent' } });
  const [m] = await q('SELECT estado, categoria_precio FROM wa_messages WHERE provider_message_id = $1', [enviado.id]);
  assert.deepEqual(m, { estado: 'entregado', categoria_precio: 'service' });
});
