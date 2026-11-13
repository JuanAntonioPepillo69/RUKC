// Motor del feedback anónimo (lib/feedback-anonimo/motor.js) con la configuración real de la R2: recorridos y reglas
// de las pruebas 1 a 5 de la tarea, y coherencia entre el banco de preguntas y el diccionario de textos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluar, validar, formVersion } from '../lib/feedback-anonimo/motor.js';
import { PREGUNTAS, BLOQUES } from '../src/config/feedback/preguntas.js';
import { TEXTOS } from '../src/config/feedback/textos.es.js';
import { rondaPorSlug, ventana, RONDAS } from '../src/config/feedback/rondas.js';

const R2 = rondaPorSlug('r2')!;

// Respuestas mínimas válidas para todo lo obligatorio que ve un piloto que repite y lleva lastre.
const BASE = {
  C1: 'dos_tres', C2: 'pesados', C3: 'temporada',
  C4: 'no', C5: 'de_30_60', C6: 5, C7: 'no', C8: 'no', C9: 'si', C10: 'todas', C11: 'no', C12: 5, C13: 'no', C15: 'no',
  C16: 5, C17: 'no', C18: 'si', C19: 'justo', C20: 5, C21: 'si',
  'M1.1': 'no', 'M1.4': ['trazada'], 'M1.5': 'cortos',
  C22: 5, C23: 'no', C24: 'si', C25: 'una', C26: 'me_apuntare', C27: 10,
};
const ve = (r: object) => evaluar(R2, r).visibles;

test('R2: configuración básica', () => {
  assert.equal(R2.round_id, 'T2-R2');
  assert.equal(formVersion(R2), '1-M1');
  assert.equal(ventana(R2, new Date('2026-11-22T16:59:59Z')), 'antes');   // 17:59:59 en Madrid
  assert.equal(ventana(R2, new Date('2026-11-22T17:00:00Z')), 'abierto');
  assert.equal(ventana(R2, new Date('2026-11-28T22:58:59Z')), 'abierto');
  assert.equal(ventana(R2, new Date('2026-11-28T22:59:00Z')), 'cerrado'); // 23:59 en Madrid
});

test('1. Primera carrera: ve N1 a N5 y no ve C24 ni C25', () => {
  const v = ve({ ...BASE, C1: 'primera' });
  for (const id of ['N1', 'N2', 'N3', 'N4', 'N5']) assert.ok(v.has(id), id);
  assert.ok(!v.has('C24') && !v.has('C25'));
  // En la R2 el bloque de primera carrera no repite M1.1 a M1.3 (M1 ya se muestra a todos, en su bloque).
  const b2 = evaluar(R2, { ...BASE, C1: 'primera' }).bloques.find((b) => b.id === 'B2')!;
  assert.deepEqual(b2.preguntas, ['N1', 'N2', 'N3', 'N4', 'N5']);
  // C24 y C25 enviadas por un piloto nuevo no se guardan.
  const a = validar(R2, { ...BASE, C1: 'primera', N1: 'amigo', N2: 'nunca', N3: ['precio'], N4: 'ambiente', N5: 'no' });
  assert.ok(!('C24' in a) && !('C25' in a));
});

test('2. Repite y no lleva lastre: no ve C8 (se guarda «No llevé lastre») y ve C24 y C25', () => {
  const r = { ...BASE, C7: 'no_lastre', C8: 'mas_10' };
  const v = ve(r);
  assert.ok(!v.has('C8'));
  assert.ok(v.has('C24') && v.has('C25'));
  for (const id of ['N1', 'N2', 'N3', 'N4', 'N5']) assert.ok(!v.has(id), id);
  assert.equal(validar(R2, r).C8, 'no_lastre');
});

test('3. Notas bajas: aparecen los seguimientos y se puede enviar con el texto vacío', () => {
  const r = { ...BASE, C6: 3, C12: 2, C16: 1, C20: 3, C22: 2, C27: 8 };
  const v = ve(r);
  for (const id of ['C6_seg', 'C16_seg', 'C22_seg', 'C27_seg']) assert.ok(v.has(id), id);   // texto: opcionales
  for (const id of ['C12_seg', 'C20_seg']) assert.ok(v.has(id), id);                         // múltiples tras filtro
  // Las de texto vacías no bloquean; las múltiples tras un filtro sí son obligatorias.
  assert.deepEqual(evaluar(R2, r).faltan.sort(), ['C12_seg', 'C20_seg']);
  const a = validar(R2, { ...r, C12_seg: ['peso'], C20_seg: ['bar'], C6_seg: '', C16_seg: '   ' });
  assert.ok(!('C6_seg' in a) && !('C16_seg' in a) && !('C22_seg' in a) && !('C27_seg' in a));
  // Con 4 y 9 no aparecen.
  const alto = ve({ ...BASE, C6: 4, C27: 9 });
  assert.ok(!alto.has('C6_seg') && !alto.has('C27_seg'));
});

test('4. C13 = No oculta C14; M1.1 = No oculta M1.2 y M1.3', () => {
  assert.ok(!ve({ ...BASE, C13: 'no' }).has('C14'));
  assert.ok(ve({ ...BASE, C13: 'si' }).has('C14'));
  const no = ve({ ...BASE, 'M1.1': 'no' });
  assert.ok(!no.has('M1.2') && !no.has('M1.3'));
  const si = ve({ ...BASE, 'M1.1': 'si' });
  assert.ok(si.has('M1.2') && si.has('M1.3'));
  assert.ok(ve({ ...BASE, 'M1.1': 'si', 'M1.2': 'no_cumplido' }).has('M1.2_seg'));
});

test('5. Una pregunta que se mostró y luego se ocultó no se guarda (en cadena)', () => {
  // Respondió C13 = Sí y C14, luego cambió C13 a No.
  const a = validar(R2, { ...BASE, C13: 'no', C14: 'si' });
  assert.ok(!('C14' in a));
  // M1.1 = Sí con M1.2 = «bastante» y su texto; luego M1.1 = No: se caen M1.2, M1.2_seg y M1.3.
  const b = validar(R2, { ...BASE, 'M1.1': 'no', 'M1.2': 'bastante', 'M1.2_seg': 'algo', 'M1.3': 'poco' });
  assert.ok(!('M1.2' in b) && !('M1.2_seg' in b) && !('M1.3' in b));
  // Era primera carrera y cambió a «2 o 3»: el bloque N entero se descarta.
  const c = validar(R2, { ...BASE, N1: 'otro', N1_otro: 'TikTok', N5: 'si', N5_seg: 'x' });
  assert.ok(!Object.keys(c).some((k) => k.startsWith('N')));
  // «Otro» con texto que deja de ser «Otro».
  const d = validar(R2, { ...BASE, C1: 'primera', N1: 'amigo', N1_otro: 'TikTok', N2: 'nunca', N3: ['nada'], N4: 'precio', N5: 'no' });
  assert.ok(!('N1_otro' in d));
});

test('Otra ronda con M2 y la formación sin entregar: el bloque de primera carrera añade M1.1 a M1.3', () => {
  const r3 = { ...R2, modulo: 'M2' };
  const ev = evaluar(r3, { ...BASE, C1: 'primera', 'M1.1': 'si' });
  assert.deepEqual(ev.bloques.find((b) => b.id === 'B2')!.preguntas, ['N1', 'N2', 'N3', 'N4', 'N5', 'M1.1', 'M1.2', 'M1.3']);
  assert.ok(!ev.bloques.some((b) => b.id === 'M1'));
  assert.ok(!evaluar({ ...r3, formacion_entregada: true }, { ...BASE, C1: 'primera' }).visibles.has('M1.1'));
  assert.ok(!evaluar(r3, BASE).visibles.has('M1.1'));   // quien repite no las ve
  assert.equal(formVersion(r3), '1-M2');
});

test('Obligatorias, máximos, exclusivas y claves desconocidas', () => {
  assert.throws(() => validar(R2, { ...BASE, C5: undefined }), (e: any) => e.status === 400 && e.campo === 'C5');
  assert.throws(() => validar(R2, { ...BASE, C6: 6 }), (e: any) => e.campo === 'C6');
  assert.throws(() => validar(R2, { ...BASE, 'M1.4': ['trazada', 'frenada', 'salida', 'normas'] }), (e: any) => e.campo === 'M1.4');
  assert.throws(() => validar(R2, { ...BASE, 'M1.4': ['nada', 'trazada'] }), (e: any) => e.campo === 'M1.4');
  assert.throws(() => validar(R2, { ...BASE, ip: '1.2.3.4' }), (e: any) => e.status === 400);
  assert.throws(() => validar(R2, { ...BASE, C28: 'x'.repeat(2001) }), (e: any) => e.campo === 'C28');
  // C28 (texto) es opcional; con «Otro» el texto corto también.
  const a = validar(R2, { ...BASE, C4: 'si', C4_seg: ['otro'], C28: '  Más tandas ' });
  assert.equal(a.C28, 'Más tandas');
  assert.deepEqual(a.C4_seg, ['otro']);
  assert.ok(!('C4_seg_otro' in a));
});

test('Banco y diccionario: cada pregunta y opción tiene su texto, y los bloques solo citan preguntas que existen', () => {
  for (const [id, p] of Object.entries(PREGUNTAS) as [string, any][]) {
    const t = (TEXTOS.preguntas as any)[id];
    assert.ok(t?.texto, `Falta el texto de ${id}`);
    for (const o of p.opciones ?? []) assert.ok(t.opciones?.[o], `Falta el texto de la opción ${id}.${o}`);
    if (p.tipo === 'escala') assert.equal(t.extremos?.length, 2, `Faltan los extremos de ${id}`);
    for (const o of p.alFinal ?? []) assert.ok(p.opciones.includes(o), `${id}: alFinal con una opción que no existe`);
    if (p.otro) assert.ok(p.opciones.includes('otro'), `${id}: otro sin opción «otro»`);
  }
  for (const b of BLOQUES) {
    for (const x of b.preguntas) assert.ok(PREGUNTAS[typeof x === 'string' ? x : x.id], `${b.id} cita ${JSON.stringify(x)}`);
    assert.ok((TEXTOS.bloques as any)[b.id], `Falta el título del bloque ${b.id}`);
  }
  for (const r of RONDAS) assert.match(r.round_id, /^T\d+-R\d+$/);
});
