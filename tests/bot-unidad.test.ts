// Piezas del bot de WhatsApp que no necesitan base de datos ni red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { firmar, firmaValida } from '../lib/whatsapp/signature.js';
import { construirPlantilla } from '../lib/whatsapp/templates.js';
import { buscar, textoParaPrompt } from '../lib/bot/kb.js';
import { limpiarTexto, EMOJI } from '../lib/bot/turn.js';
import { martesAnterior } from '../lib/bot/datos.js';
import { DEFINICIONES } from '../lib/bot/tools.js';
import { BAJA_EXACTA, contenidoEntrante } from '../lib/whatsapp/entrante.js';
import { calendarioSemilla, htmlATexto, leerSemilla } from '../db/kb-sembrar.mjs';

test('firma de YCloud: válida, alterada, caducada y con otro secreto', () => {
  const cuerpo = '{"id":"evt_1","type":"whatsapp.inbound_message.received"}';
  const ahora = 1_800_000_000;
  const cabecera = firmar(cuerpo, 'secreto', ahora);
  assert.ok(firmaValida(cuerpo, cabecera, 'secreto', ahora));
  assert.ok(!firmaValida(`${cuerpo} `, cabecera, 'secreto', ahora));
  assert.ok(!firmaValida(cuerpo, cabecera, 'otro', ahora));
  assert.ok(!firmaValida(cuerpo, cabecera, 'secreto', ahora + 301));
  assert.ok(!firmaValida(cuerpo, null, 'secreto', ahora));
  assert.ok(!firmaValida(cuerpo, 't=abc,s=zz', 'secreto', ahora));
});

test('el bot público tiene exactamente las 9 herramientas de la especificación', () => {
  assert.deepEqual(DEFINICIONES.map((d) => d.name), ['buscar_conocimiento', 'consultar_rondas', 'consultar_mi_inscripcion',
    'generar_enlace_reserva', 'enviar_enlace', 'registrar_lead', 'registrar_consentimiento_comercial', 'registrar_baja', 'escalar_a_john']);
  for (const d of DEFINICIONES) {
    assert.equal(d.input_schema.additionalProperties, false, d.name);
    assert.deepEqual([...d.input_schema.required].sort(), Object.keys(d.input_schema.properties).sort(), d.name);
  }
});

test('semilla: no carga líneas con [JOHN: ...] y el calendario sale entero', () => {
  const texto = fs.readFileSync(new URL('../docs/kb-semilla.md', import.meta.url), 'utf8');
  const { docs, descartadas } = leerSemilla(texto);
  assert.ok(descartadas.length > 0);
  for (const d of docs) assert.ok(!/\[JOHN:/i.test(d.contenido_md), d.slug);
  assert.ok(docs.find((d) => d.slug === 'precios').contenido_md.includes('99 €'));
  const cal = calendarioSemilla(texto);
  assert.equal(cal.length, 8);
  assert.deepEqual(cal[2], { numero: 3, fecha: '2026-12-12', circuito: 'Kart&Fun Málaga' });
});

test('base de conocimiento: el reglamento completo queda fuera del prompt y se encuentra buscando', () => {
  const docs = [
    { slug: 'precios', titulo: 'Precios', categoria: 'precios', fuente: 'john', contenido_md: '- Cada ronda cuesta 99 €.' },
    { slug: 'web_reglamento', titulo: 'Reglamento', categoria: 'reglamento', fuente: 'reglamento', contenido_md: '## Banderas\n\nLa bandera azul indica que te van a doblar.' },
  ];
  const prompt = textoParaPrompt(docs);
  assert.match(prompt, /99 €/);
  assert.doesNotMatch(prompt, /bandera azul/);
  assert.equal(buscar(docs, 'qué significa la bandera azul')[0].slug, 'web_reglamento');
});

test('limpieza: sin emojis ni markdown', () => {
  const t = limpiarTexto('**Qué tal crack!** 🏁🔥\n- Cada ronda 99 €\n\n\n\nVamos 👍🏽');
  assert.equal(t, 'Qué tal crack!\nCada ronda 99 €\n\nVamos');
  assert.equal((t.match(EMOJI) ?? []).length, 0);
});

test('cierre de inscripción: martes anterior a la ronda', () => {
  assert.equal(martesAnterior('2026-12-12'), '2026-12-08');
  assert.equal(martesAnterior('2026-11-22'), '2026-11-17');
  assert.equal(martesAnterior('2026-12-08'), '2026-12-01');
});

test('BAJA exacta y contenido de mensajes no de texto', () => {
  for (const t of ['BAJA', 'baja', ' Stop. ', 'darme de baja']) assert.ok(BAJA_EXACTA.test(t), t);
  for (const t of ['bajada de precio?', 'stop a las 10?', 'quiero la baja del precio']) assert.ok(!BAJA_EXACTA.test(t), t);
  assert.equal(contenidoEntrante({ type: 'interactive', interactive: { button_reply: { title: 'Confirmo asistencia' } } }).cuerpo, 'Confirmo asistencia');
  assert.match(contenidoEntrante({ type: 'image', image: { caption: 'justificante' } }).cuerpo, /imagen: justificante/);
});

test('PIN del canal admin: hash y comprobación', async () => {
  const { hashPin, pinValido } = await import('../lib/bot/pin.js');
  const h = hashPin('123456');
  assert.ok(pinValido('123456', h));
  assert.ok(!pinValido('123457', h));
  assert.ok(!pinValido('123456', ''));
  assert.notEqual(hashPin('123456'), h);
});

test('plantillas: número de variables y botón', () => {
  const p = construirPlantilla('rukc_feedback_ronda', ['Álvaro', 'R3'], { sufijoBoton: 'token' });
  assert.equal(p.components[1].parameters[0].text, 'token');
  assert.throws(() => construirPlantilla('rukc_feedback_ronda', ['Álvaro']));
});

test('html a texto: quita scripts y menús, conserva títulos y enlaces', () => {
  const t = htmlATexto('<nav>Menú</nav><main><h2>Precio</h2><p>99&nbsp;€ <a href="https://raceupkc.com/x">aquí</a></p><script>x()</script></main>');
  assert.equal(t, '### Precio\n99 € aquí (https://raceupkc.com/x)');
});
