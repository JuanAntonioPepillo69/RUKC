// Runner de las 30 conversaciones de prueba (tests/bot/casos/casos.mjs) contra Claude real.
// Usa la base de conocimiento y las rondas de la rama de desarrollo de Neon; las inscripciones del contacto salen de
// cada caso y las herramientas de escritura no escriben (se registran).
// Criterio 10 de la fase 1: pasan al menos 28 de 30, con cero fallos en los casos de límite duro y cero emojis.
// Uso:  npm run bot:casos                       (los 30)
//       npm run bot:casos -- --solo=precio,peso_franja
//       npm run bot:casos -- --json=salida.json  (guarda el detalle)
//       npm run bot:casos -- --pensar            (con razonamiento adaptativo, para comparar)
// Necesita DATABASE_URL (.env) y ANTHROPIC_API_KEY (.env.bot, fuera de git). Coste aproximado: 0,5 a 1 $ por pasada.
import fs from 'node:fs';
import * as datosReales from '../../lib/bot/datos.js';
import { textoParaPrompt } from '../../lib/bot/kb.js';
import { llmAnthropic, MODELO_CONVERSACION } from '../../lib/bot/llm.js';
import { systemPublico } from '../../lib/bot/prompts.js';
import { EMOJI, ejecutarTurno } from '../../lib/bot/turn.js';
import { silencia } from '../../lib/bot/escalado.js';
import { CASOS } from './casos/casos.mjs';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Falta ANTHROPIC_API_KEY. Ponla en .env.bot (archivo local, fuera de git).');
  process.exit(1);
}
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const solo = arg('solo')?.split(',');
const salidaJson = arg('json');
const modelo = process.env.BOT_MODEL_CONVERSATION || MODELO_CONVERSACION;
const PARALELO = 3;
// --pensar: con razonamiento adaptativo (por defecto el bot va sin razonar entre llamadas, para gastar menos).
const pensar = process.argv.includes('--pensar');

const docs = await datosReales.documentosKb({ fresco: true });
const kbTexto = textoParaPrompt(docs);
const SIN_PLAZA = { inscripciones: [], bizum_pendientes: [], sin_pagar: [] };

/** Acceso a datos del caso: lecturas reales (KB, rondas) y escrituras simuladas. */
function datosDelCaso(caso, escrituras) {
  const ins = caso.inscripciones ?? SIN_PLAZA;
  const anota = (nombre) => async (...a) => { escrituras.push({ nombre, a: a.slice(1) }); return { nueva: true, baja: a[1] ?? 'total', envios_cancelados: 0 }; };
  return {
    ...datosReales,
    documentosKb: async () => docs,
    ...(caso.rondas ? { rondas: async ({ soloAbiertas = true } = {}) => caso.rondas.filter((r) => !soloAbiertas || r.inscripcion_abierta) } : {}),
    inscripcionesDe: async () => ins,
    tienePlaza: async () => ins.inscripciones.some((i) => ['reservada', 'pagada'].includes(i.estado)),
    enlaceGrupo: async () => 'https://chat.whatsapp.com/PRUEBA123',
    registrarLead: anota('registrarLead'),
    registrarConsentimiento: anota('registrarConsentimiento'),
    registrarBaja: anota('registrarBaja'),
    escalar: anota('escalar'),
  };
}

function comprobar(caso, r) {
  const e = caso.espera ?? {};
  const fallos = [];
  const usadas = r.llamadas.map((l) => l.nombre);
  for (const p of e.contiene ?? []) if (!p.test(r.texto)) fallos.push(`falta ${p}`);
  for (const p of e.no_contiene ?? []) if (p.test(r.texto)) fallos.push(`no debía contener ${p}`);
  for (const h of e.herramientas ?? []) if (!usadas.includes(h)) fallos.push(`no ha usado ${h}`);
  for (const h of e.no_herramientas ?? []) if (usadas.includes(h)) fallos.push(`ha usado ${h}`);
  if (e.escala === true && !r.escalado) fallos.push('no ha escalado');
  if (e.escala === false && r.escalado) fallos.push(`ha escalado (${r.escalado.motivo})`);
  if (e.euros) {
    const importes = [...r.texto.matchAll(/(\d+(?:[.,]\d+)?)\s?€/g)].map((m) => Number(m[1].replace(',', '.')));
    const raros = importes.filter((x) => !e.euros.includes(x));
    if (raros.length) fallos.push(`importes que no están en la base: ${raros.join(', ')} €`);
  }
  if (e.fuera_de_tema === true && !r.fueraDeTema) fallos.push('no lleva la marca de fuera de tema');
  if (e.fuera_de_tema === false && r.fueraDeTema) fallos.push('lleva la marca de fuera de tema');
  if (e.silencia !== undefined && r.escalado && silencia(r.escalado) !== e.silencia) {
    fallos.push(`escalado de tipo ${r.escalado.tipo}: ${e.silencia ? 'tenía que' : 'no tenía que'} callar al bot`);
  }
  if (r.fallo) fallos.push(`turno fallido (${r.fallo})`);
  const emojis = (r.texto.match(EMOJI) ?? []).length;
  const emojisModelo = (r.textoModelo?.match(EMOJI) ?? []).length;
  if (emojis) fallos.push(`${emojis} emoji(s) en la salida`);
  return { fallos, emojis, emojisModelo };
}

async function ejecutarCaso(caso) {
  const escrituras = [];
  const contacto = { id: '00000000-0000-0000-0000-000000000000', phone_e164: '+34600000000', display_name: caso.contacto?.nombre ?? null, rol: caso.contacto?.rol ?? 'lead' };
  const ctx = { contacto, conversacionId: null, mensajeId: null, datos: datosDelCaso(caso, escrituras) };
  const historial = [...(caso.historial ?? []), { role: 'user', content: caso.mensaje }];
  const r = await ejecutarTurno({
    llm: llmAnthropic, modelo, historial, ctx, avisoIaPendiente: Boolean(caso.aviso), ...(pensar ? { thinking: null } : {}),
    system: systemPublico({ kbTexto, contacto: { nombre: contacto.display_name, rol: contacto.rol }, avisoIaPendiente: Boolean(caso.aviso), temasEscalados: caso.temas ?? [], reservas: caso.inscripciones ?? SIN_PLAZA }),
  });
  return { caso, r, ...comprobar(caso, r), escrituras };
}

const casos = CASOS.filter((c) => !solo || solo.includes(c.id));
const resultados = [];
const cola = [...casos];
await Promise.all(Array.from({ length: PARALELO }, async () => {
  while (cola.length) {
    const caso = cola.shift();
    const res = await ejecutarCaso(caso);
    resultados.push(res);
    const marca = res.fallos.length ? 'FALLA' : 'ok   ';
    console.log(`${marca} ${caso.limite ? '[límite] ' : ''}${caso.id} · ${(res.r.ms / 1000).toFixed(1)} s · ${res.r.llamadas.map((l) => l.nombre).join(', ') || 'sin herramientas'}`);
    console.log(`      «${res.r.texto.replace(/\n/g, ' / ')}»`);
    for (const f of res.fallos) console.log(`      ✗ ${f}`);
  }
}));

resultados.sort((a, b) => CASOS.indexOf(a.caso) - CASOS.indexOf(b.caso));
const pasan = resultados.filter((x) => !x.fallos.length).length;
const fallosLimite = resultados.filter((x) => x.caso.limite && x.fallos.length);
const emojis = resultados.reduce((s, x) => s + x.emojis, 0);
const emojisModelo = resultados.reduce((s, x) => s + x.emojisModelo, 0);
const uso = resultados.reduce((s, x) => ({
  entrada: s.entrada + x.r.uso.entrada, salida: s.salida + x.r.uso.salida,
  cache_lectura: s.cache_lectura + x.r.uso.cache_lectura, cache_escritura: s.cache_escritura + x.r.uso.cache_escritura,
}), { entrada: 0, salida: 0, cache_lectura: 0, cache_escritura: 0 });
// Precios de Sonnet 5.5 por millón de tokens: 2 $ entrada, 10 $ salida, 0,10 $ lectura de caché, 2,5 $ escritura.
const coste = (uso.entrada * 2 + uso.salida * 10 + uso.cache_lectura * 0.1 + uso.cache_escritura * 2.5) / 1e6;
const tiempos = resultados.map((x) => x.r.ms).sort((a, b) => a - b);
const minimo = Math.ceil(casos.length * 28 / 30);
const ok = pasan >= minimo && !fallosLimite.length && !emojis;

console.log(`\n${pasan}/${casos.length} pasan (mínimo ${minimo}). Fallos en límites duros: ${fallosLimite.length}. Emojis en las salidas: ${emojis} (el modelo escribió ${emojisModelo} antes de limpiar).`);
console.log(`Tiempo por turno: mediana ${(tiempos[Math.floor(tiempos.length / 2)] / 1000).toFixed(1)} s, máximo ${(tiempos.at(-1) / 1000).toFixed(1)} s.`);
const busquedas = resultados.reduce((s, x) => s + x.r.llamadas.filter((l) => l.servidor).length, 0);
console.log(`Búsquedas en internet: ${busquedas} (se pagan aparte de los tokens).`);
console.log(`Salida media por turno: ${Math.round(uso.salida / resultados.length)} tokens.`);
console.log(`Tokens: ${uso.entrada} de entrada, ${uso.cache_lectura} leídos de caché, ${uso.cache_escritura} escritos en caché, ${uso.salida} de salida. Coste aproximado: ${coste.toFixed(3)} $.`);
console.log(ok ? 'CRITERIO 10: CUMPLE' : 'CRITERIO 10: NO CUMPLE');
if (salidaJson) {
  fs.writeFileSync(salidaJson, JSON.stringify(resultados.map((x) => ({
    id: x.caso.id, limite: Boolean(x.caso.limite), fallos: x.fallos, texto: x.r.texto, herramientas: x.r.llamadas, escalado: x.r.escalado, ms: x.r.ms, uso: x.r.uso,
  })), null, 2));
}
process.exit(ok ? 0 : 1);
