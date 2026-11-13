// Imágenes semanales de inscritos (lib/inscritos): datos, textos para el grupo, enlaces firmados, imagen, hora del
// envío y envío a John por WhatsApp. Sin base de datos ni red: todo con dobles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parrilla, PLAZAS_IMAGEN } from '../lib/inscritos/datos.js';
import { textoGrupo, situacion, semanaIso, versiones } from '../lib/inscritos/textos.js';
import { enlaceImagen, firmaValida } from '../lib/inscritos/enlace.js';
import { generarPng } from '../lib/inscritos/imagen.js';
import { CASOS_PRUEBA, RONDA_PRUEBA, parrillaPrueba } from '../lib/inscritos/prueba.js';
import { enviarSemana } from '../lib/inscritos/envio.js';
import { esMomento, manejar } from '../api/inscritos/semanal.js';
import { construirPlantilla } from '../lib/whatsapp/templates.js';

process.env.CRON_SECRET = 'secreto-de-prueba-0123456789';
const RONDA = { id: '11111111-1111-4111-8111-111111111111', numero: 2, fecha: '2026-11-22', circuito: 'Karting Campillos', temporada: 'T2' };
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

// --- datos ------------------------------------------------------------------------------------------------------------
test('parrilla: orden alfabético, nombres limpios, plazas forzadas en la R2 y solo dorsal y nombre', async () => {
  const consultas: string[] = [];
  const q = async (sql: string) => {
    consultas.push(sql);
    if (sql.includes('FROM cupo_ronda')) return [{ id: 'cat', nombre: 'Pesados', plazas: 23 }];
    return [{ dorsal: 7, nombre: 'Vito  C.' }, { dorsal: null, nombre: 'abraham P.' }, { dorsal: 25, nombre: 'Miguel Ángel A.' }];
  };
  const c = await parrilla(RONDA, 'PES', q);
  assert.equal(c!.plazas, PLAZAS_IMAGEN['T2-R2'].PES);
  assert.equal(c!.plazas, 30);
  assert.deepEqual(c!.pilotos.map((p) => p.nombre), ['abraham P.', 'Miguel Ángel A.', 'Vito C.']);
  const sel = consultas[1].slice(0, consultas[1].indexOf('FROM'));
  for (const prohibido of ['email', 'telefono', 'fecha_nacimiento', 'peso']) assert.ok(!sel.includes(prohibido), prohibido);
  assert.match(consultas[1], /estado = ANY/);
});

test('parrilla: fuera de la R2 valen las plazas de la BD', async () => {
  const q = async (sql: string) => (sql.includes('FROM cupo_ronda') ? [{ id: 'cat', nombre: 'Ligeros', plazas: 29 }] : []);
  const c = await parrilla({ ...RONDA, numero: 4 }, 'LIG', q);
  assert.equal(c!.plazas, 29);
  assert.equal(c!.pilotos.length, 0);
});

// --- textos -----------------------------------------------------------------------------------------------------------
test('textos: situación según plazas y fecha', () => {
  const ahora = new Date('2026-11-04T18:00:00Z');
  assert.equal(situacion({ n: 0, plazas: 30, fecha: '2026-11-22' }, ahora), 'vacia');
  assert.equal(situacion({ n: 10, plazas: 30, fecha: '2026-11-22' }, ahora), 'abierta');
  assert.equal(situacion({ n: 10, plazas: 30, fecha: '2026-11-08' }, ahora), 'semana_carrera');
  assert.equal(situacion({ n: 26, plazas: 30, fecha: '2026-11-22' }, ahora), 'ultimas');
  assert.equal(situacion({ n: 30, plazas: 30, fecha: '2026-11-22' }, ahora), 'completa');
  assert.equal(situacion({ n: 31, plazas: 30, fecha: '2026-11-22' }, ahora), 'completa');
});

test('textos: sin emojis, en una línea y distintos dos semanas seguidas', () => {
  for (const s of ['vacia', 'abierta', 'semana_carrera', 'ultimas', 'completa']) {
    for (const f of versiones(s)) {
      const t = f({ cat: 'Pesados', ronda: 2, circuito: 'Karting Campillos', fecha: 'domingo 22 de noviembre', n: 24, plazas: 30, libres: 6 });
      assert.ok(!EMOJI.test(t), t);
      assert.ok(!/[\n\t]| {5}/.test(t), t);
    }
  }
  const d = { categoria: 'LIG', categoriaNombre: 'Ligeros', ronda: 3, circuito: 'Kart&Fun Málaga', fecha: '2026-12-12', n: 10, plazas: 30 };
  const a = textoGrupo(d, new Date('2026-11-18T18:00:00Z'));
  const b = textoGrupo(d, new Date('2026-11-25T18:00:00Z'));
  assert.equal(semanaIso(new Date('2026-11-25T18:00:00Z')) - semanaIso(new Date('2026-11-18T18:00:00Z')), 1);
  assert.notEqual(a.texto, b.texto);
  assert.notEqual(textoGrupo({ ...d, categoria: 'PES', categoriaNombre: 'Pesados' }, new Date('2026-11-18T18:00:00Z')).texto.replace('Pesados', 'Ligeros'), a.texto);
});

// --- enlaces firmados ---------------------------------------------------------------------------------------------------
test('enlace: firma válida, caducada, manipulada y demasiado larga', () => {
  const ahora = Date.parse('2026-11-18T18:00:00Z');
  const url = new URL(enlaceImagen('https://raceupkc.com', RONDA.id, 'PES', { ahora }));
  const p = Object.fromEntries(url.searchParams);
  assert.equal(url.pathname, '/api/inscritos/imagen');
  assert.ok(firmaValida(p, ahora));
  assert.ok(!firmaValida(p, ahora + 8 * 24 * 3600e3));                  // caducado
  assert.ok(!firmaValida({ ...p, categoria: 'LIG' }, ahora));           // otra categoría
  assert.ok(!firmaValida({ ...p, exp: String(Number(p.exp) + 1) }, ahora));
  assert.ok(!firmaValida({ ...p, firma: p.firma.slice(0, 63) }, ahora));
  assert.ok(!firmaValida({ ...p, ronda: 'x' }, ahora));
  assert.ok(!url.search.includes(process.env.CRON_SECRET!));
});

// --- imagen -------------------------------------------------------------------------------------------------------------
const tamPng = (b: Uint8Array) => {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return [v.getUint32(16), v.getUint32(20)];
};
test('imagen: 1080x1350 con 0, 1, 25, 50 y nombres largos', async () => {
  for (const caso of CASOS_PRUEBA) {
    const c = parrillaPrueba(caso, 'PES');
    const png = await generarPng({ ronda: RONDA_PRUEBA, categoria: c.categoria, nombreCategoria: c.nombre, plazas: c.plazas, pilotos: c.pilotos });
    assert.deepEqual(tamPng(png), [1080, 1350], caso);
    assert.ok(png.length < 5 * 1024 * 1024, caso);   // límite de imágenes de WhatsApp
  }
});

// --- hora del envío -----------------------------------------------------------------------------------------------------
test('cron: solo a las 19:00 de Madrid del miércoles, en invierno y en verano', () => {
  assert.ok(esMomento(new Date('2026-11-18T18:00:00Z')));    // CET: 18 UTC = 19 Madrid
  assert.ok(!esMomento(new Date('2026-11-18T17:00:00Z')));
  assert.ok(esMomento(new Date('2027-04-21T17:00:00Z')));    // CEST: 17 UTC = 19 Madrid
  assert.ok(!esMomento(new Date('2027-04-21T18:00:00Z')));
  assert.ok(!esMomento(new Date('2026-11-19T18:00:00Z')));   // jueves
});

test('endpoint semanal: sin token 401; fuera de hora no hace nada', async () => {
  const r1 = await manejar(new Request('https://raceupkc.com/api/inscritos/semanal'));
  assert.equal(r1.status, 401);
  const r2 = await manejar(new Request('https://raceupkc.com/api/inscritos/semanal', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }),
    { ahora: new Date('2026-11-19T18:00:00Z') });
  assert.equal((await r2.json()).enviado, false);
});

// --- envío ---------------------------------------------------------------------------------------------------------------
function dobles({ abierta = true, plantillaFalla = false, yaEnviado = false } = {}) {
  const enviados: any[] = [], avisos: any[] = [], sql: string[] = [];
  const d = {
    proximaRonda: async () => RONDA,
    parrilla: async (_r: unknown, c: string) => ({ categoria: c, nombre: c === 'LIG' ? 'Ligeros' : 'Pesados', plazas: 30,
      pilotos: c === 'LIG' ? [{ dorsal: 19, nombre: 'Adam V.' }] : Array.from({ length: 26 }, (_, i) => ({ dorsal: i + 1, nombre: `Piloto ${i}` })) }),
    sinCategoria: async () => 2,
    contactoJohn: async () => ({ contacto: { id: 'john', phone_e164: '+34600000000' }, abierta }),
    consulta: async (t: string) => { sql.push(t); return t.startsWith('INSERT') ? (yaEnviado ? [] : [{ id: 'cerrojo' }]) : []; },
    enviar: async (m: any) => { enviados.push(m); return m.plantilla && plantillaFalla ? { ok: false, error: 'template not found' } : { ok: true, id: 'msg' }; },
    enviarAJohn: async (m: any) => { avisos.push(m); return { ok: true, id: 'aviso' }; },
  };
  return { d, enviados, avisos, sql };
}
const AHORA = new Date('2026-11-18T18:00:00Z');

test('envío: ventana abierta → dos imágenes con el texto del grupo de pie', async () => {
  const { d, enviados, avisos } = dobles();
  const r = await enviarSemana({ origen: 'https://raceupkc.com', ahora: AHORA, d });
  assert.equal(r.enviado, true);
  assert.equal(enviados.length, 2);
  for (const m of enviados) {
    assert.ok(m.imagen.link.startsWith('https://raceupkc.com/api/inscritos/imagen?'));
    assert.ok(firmaValida(Object.fromEntries(new URL(m.imagen.link).searchParams), AHORA.getTime()));
    assert.ok(m.imagen.caption.length > 20);
  }
  assert.match(enviados[1].imagen.caption, /4 plazas|Últimas 4|quedan 4/i);   // Pesados 26/30 → últimas plazas
  assert.equal(avisos.length, 1);                                                // aviso de los 2 sin categoría
  assert.match(avisos[0].texto, /2 inscritos con pago no tienen categoría/);
});

test('envío: ventana cerrada → plantilla con imagen; si falla, aviso con enlace', async () => {
  const a = dobles({ abierta: false });
  await enviarSemana({ origen: 'https://raceupkc.com', ahora: AHORA, d: a.d });
  assert.equal(a.enviados[0].plantilla.name, 'rukc_inscritos_semana');
  assert.equal(a.enviados[0].plantilla.components[0].type, 'header');
  assert.equal(a.enviados[0].plantilla.components[1].parameters.length, 4);

  const b = dobles({ abierta: false, plantillaFalla: true });
  const r = await enviarSemana({ origen: 'https://raceupkc.com', ahora: AHORA, d: b.d });
  assert.deepEqual(r.resultados.map((x: any) => x.via), ['aviso con enlace', 'aviso con enlace']);
  assert.match(b.avisos[0].texto, /https:\/\/raceupkc\.com\/api\/inscritos\/imagen\?/);
});

test('envío: una sola vez por día salvo forzar; simular no envía', async () => {
  const a = dobles({ yaEnviado: true });
  const r = await enviarSemana({ origen: 'https://raceupkc.com', ahora: AHORA, d: a.d });
  assert.equal(a.enviados.length, 0);
  assert.deepEqual(r.resultados.map((x: any) => x.estado), ['ya enviado hoy', 'ya enviado hoy']);

  const b = dobles();
  const s = await enviarSemana({ origen: 'https://raceupkc.com', ahora: AHORA, simular: true, d: b.d });
  assert.equal(b.enviados.length + b.sql.length, 0);
  assert.equal(s.piezas.length, 2);
});

test('plantilla rukc_inscritos_semana: exige imagen de cabecera', () => {
  assert.throws(() => construirPlantilla('rukc_inscritos_semana', ['a', 'b', 'c', 'd']));
  const p = construirPlantilla('rukc_inscritos_semana', ['a', 'b', 'c', 'd'], { imagenCabecera: 'https://x/y.png' });
  assert.deepEqual(p.components[0], { type: 'header', parameters: [{ type: 'image', image: { link: 'https://x/y.png' } }] });
});
