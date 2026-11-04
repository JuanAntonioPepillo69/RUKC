// Onboarding (F5) y grupo contra Neon desarrollo, llamando a /api/onboarding y /api/admin como lo haría Vercel.
// Usa los documentos vigentes (los del reglamento v1.1: npm run db:documentos); si no hay, activa los de prueba y guarda las fotos en
// RUKC_BLOB_LOCAL_DIR. Las aceptaciones no se pueden borrar: al terminar, las personas del test que firmaron quedan
// anonimizadas; el resto de sus datos se borra.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from '@neondatabase/serverless';
import { adminConSesion } from './ayuda-panel.mjs';
import { activarDocumentosPrueba } from '../documentos-prueba.mjs';
import { descifrar } from '../../lib/cifrado.js';
import { borrarFoto } from '../../lib/archivos.js';
import { hashToken, nuevoToken } from '../../lib/tokens.js';

for (const v of ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'RUKC_DATA_KEY', 'RUKC_BLOB_LOCAL_DIR']) if (!process.env[v]) throw new Error(`Falta ${v}`);
delete process.env.BLOB_READ_WRITE_TOKEN;   // las fotos del test van a la carpeta local
const { GET, POST } = await import('../../api/onboarding.js');
const { GET: adminGet } = await import('../../api/admin.js');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = async (t, p) => (await pool.query(t, p)).rows;
const tel = () => `+3469${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const BASE = process.env.BETTER_AUTH_URL;
const UA = 'Prueba onboarding/1.0';
const hace = (anios) => { const d = new Date(); d.setFullYear(d.getFullYear() - anios); d.setDate(d.getDate() - 10); return d.toISOString().slice(0, 10); };

/** Llama a /api/onboarding/<ruta> con el token. Devuelve { status, datos }. */
async function ob(token, ruta, cuerpo, tipo = 'application/json') {
  const u = new URL(`${BASE}/api/onboarding`);
  u.searchParams.set('ruta', ruta);
  const headers = { origin: BASE, 'x-forwarded-for': '10.9.9.9', 'user-agent': UA, ...(token ? { authorization: `Bearer ${token}` } : {}) };
  if (cuerpo !== undefined) headers['content-type'] = tipo;
  const res = await (cuerpo === undefined ? GET : POST)(new Request(u, {
    method: cuerpo === undefined ? 'GET' : 'POST', headers,
    body: cuerpo === undefined ? undefined : tipo === 'application/json' ? JSON.stringify(cuerpo) : cuerpo,
  }));
  const datos = res.headers.get('content-type')?.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, datos, tipo: res.headers.get('content-type') };
}
const ok = async (...a) => { const r = await ob(...a); assert.equal(r.status, 200, JSON.stringify(r.datos)); return r.datos; };

let admin, ronda, temporada, enlaceAntes, edadAntes;
const version = {};
const personas = [];
const fotos = [];

/** Piloto con una carrera pagada en efectivo desde el panel: tiene onboarding pendiente. Devuelve ids y token. */
async function nuevoPiloto(nombre) {
  const telefono = tel();
  const v = await admin.panel('ventas', {
    pagador: { nombre, telefono, email: `ob+${crypto.randomBytes(4).toString('hex')}@example.com` },
    lineas: [{ piloto: 'pagador', producto: 'carrera_suelta', ronda_id: ronda.id, categoria: null }],
    pagos: [{ metodo: 'efectivo', importe_cent: 9900, verificado: true, cobrado_por: 'Prueba' }],
  });
  const [i] = await q('SELECT id, piloto_persona_id FROM inscripcion WHERE pedido_id = $1', [v.pedido_id]);
  personas.push(i.piloto_persona_id);
  const token = nuevoToken();
  await q('UPDATE onboarding SET token_hash = $2 WHERE persona_id = $1', [i.piloto_persona_id, hashToken(token)]);
  return { persona: i.piloto_persona_id, inscripcion: i.id, telefono, token };
}

async function dorsalLibre() {
  const usados = new Set((await q('SELECT dorsal FROM dorsal_temporada WHERE temporada_id = $1', [temporada])).map((r) => r.dorsal));
  for (let n = 900; n < 1000; n++) if (!usados.has(n)) return n;
  throw new Error('Sin dorsales libres para el test');
}

before(async () => {
  const vigentes = await q(`SELECT tipo, version FROM documento_legal WHERE vigente_desde <= now() AND (vigente_hasta IS NULL OR vigente_hasta > now())`);
  if (!['reglamento', 'cesion_imagen', 'asuncion_riesgos'].every((t) => vigentes.some((v) => v.tipo === t))) await activarDocumentosPrueba(pool);
  for (const v of await q(`SELECT tipo, version FROM documento_legal WHERE vigente_desde <= now() AND (vigente_hasta IS NULL OR vigente_hasta > now())`)) version[v.tipo] = v.version;
  admin = await adminConSesion();
  const cat = await admin.panel('catalogo-venta');
  ronda = cat.rondas[0];
  [{ id: temporada, enlace_grupo_whatsapp: enlaceAntes }] = await q(`SELECT t.id, t.enlace_grupo_whatsapp FROM temporada t JOIN ronda r ON r.temporada_id = t.id WHERE r.id = $1`, [ronda.id]);
  [{ edad_minima: edadAntes }] = await q('SELECT ci.edad_minima FROM circuito ci JOIN ronda r ON r.circuito_id = ci.id WHERE r.id = $1', [ronda.id]);
});

after(async () => {
  await q('UPDATE temporada SET enlace_grupo_whatsapp = $2 WHERE id = $1', [temporada, enlaceAntes]);
  await q('UPDATE circuito SET edad_minima = $2 WHERE id = (SELECT circuito_id FROM ronda WHERE id = $1)', [ronda.id, edadAntes]);
  for (const f of fotos) await borrarFoto(f).catch(() => {});
  const tutores = (await q('SELECT tutor_persona_id FROM tutela WHERE menor_persona_id = ANY($1::uuid[])', [personas])).map((r) => r.tutor_persona_id);
  const todas = [...personas, ...tutores];
  const pedidos = (await q('SELECT id FROM pedido WHERE pagador_persona_id = ANY($1::uuid[])', [todas])).map((r) => r.id);
  const insc = (await q('SELECT id FROM inscripcion WHERE pedido_id = ANY($1::uuid[])', [pedidos])).map((r) => r.id);
  const pagos = (await q('SELECT id FROM pago WHERE pagador_persona_id = ANY($1::uuid[])', [todas])).map((r) => r.id);
  await q('DELETE FROM aplicacion_pago WHERE pago_id = ANY($1::uuid[]) OR inscripcion_id = ANY($2::uuid[])', [pagos, insc]);
  await q('DELETE FROM pago WHERE id = ANY($1::uuid[])', [pagos]);
  await q('DELETE FROM inscripcion WHERE id = ANY($1::uuid[])', [insc]);
  await q('DELETE FROM pedido WHERE id = ANY($1::uuid[])', [pedidos]);
  await q('DELETE FROM tutela WHERE menor_persona_id = ANY($1::uuid[])', [personas]);
  for (const t of ['onboarding', 'acceso_grupo', 'dorsal_temporada', 'formacion_progreso', 'perfil_piloto', 'datos_sensibles_piloto', 'consentimiento', 'interaccion', 'oportunidad', 'atribucion']) {
    await q(`DELETE FROM ${t} WHERE persona_id = ANY($1::uuid[])`, [todas]);
  }
  const firmaron = new Set((await q('SELECT DISTINCT unnest(ARRAY[persona_id, firmante_persona_id]) AS id FROM aceptacion WHERE persona_id = ANY($1::uuid[]) OR firmante_persona_id = ANY($1::uuid[])', [todas])).map((r) => r.id));
  await q(`UPDATE persona SET nombre = 'Anonimizada', apellidos = NULL, email = NULL, telefono = NULL, municipio = NULL, instagram = NULL, notas = NULL,
    estado = 'anonimizada', anonimizada_en = now() WHERE id = ANY($1::uuid[])`, [[...firmaron]]);
  await q('DELETE FROM persona WHERE id = ANY($1::uuid[]) AND NOT (id = ANY($2::uuid[]))', [todas, [...firmaron]]);
  const [u] = await q('SELECT id FROM auth_usuario WHERE email = $1', [admin.email]);
  if (u) await q('DELETE FROM auth_usuario WHERE id = $1', [u.id]);
  await q('UPDATE admin SET activo = false WHERE email = $1', [admin.email]);
  await pool.end();
});

let adulto;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(200), Buffer.from([0xff, 0xd9])]);

test('Adulto completa el onboarding: aceptaciones correctas, DNI ilegible en la tabla y acceso al grupo pendiente', async () => {
  adulto = await nuevoPiloto('Adulto Onboarding');
  const e0 = await ok(adulto.token, 'estado');
  assert.equal(e0.estado, 'en_curso', 'Al abrir el enlace pasa a en_curso');
  assert.ok(!e0.pasos.includes('tutor'));
  assert.ok(e0.documentos_listos);

  await ok(adulto.token, 'borrador', { paso: 'personales', campos: { nombre: 'Adulto', fecha_nacimiento: '1990-05-10', documento: '12345678Z' } });
  const [b0] = await q('SELECT borrador FROM onboarding WHERE persona_id = $1', [adulto.persona]);
  assert.deepEqual(b0.borrador.pasos.personales, { nombre: 'Adulto' }, 'El autoguardado no guarda fecha de nacimiento ni documento');

  await ok(adulto.token, 'paso/personales', { nombre: 'Adulto', apellidos: 'Onboarding Prueba', fecha_nacimiento: '1990-05-10', municipio: 'Málaga', instagram: '@adulto' });
  const [b1] = await q('SELECT borrador::text AS b FROM onboarding WHERE persona_id = $1', [adulto.persona]);
  assert.ok(!b1.b.includes('1990-05-10'), 'La fecha de nacimiento va cifrada hasta que existe su fila');

  const dorsal = await dorsalLibre();
  await ok(adulto.token, 'paso/perfil', { nombre_competicion: 'Adulto O.', dorsal, experiencia: 'amateur', frecuencia: 'mensual', ligas_previas: 'Liga X', circuitos_rodados: ['Campillos'] });

  const sinCat = await ob(adulto.token, 'paso/fisicos', { consiente_peso: true, peso_kg: 82.5, altura_cm: 180 });
  assert.equal(sinCat.status, 400, 'En la franja hay que elegir categoría');
  const f = await ok(adulto.token, 'paso/fisicos', { consiente_peso: true, peso_kg: 82.5, altura_cm: 180, categoria: 'PES' });
  assert.equal(f.categoria, 'PES');
  const [ins] = await q('SELECT cat.codigo, i.categoria_origen FROM inscripcion i JOIN categoria cat ON cat.id = i.categoria_id WHERE i.id = $1', [adulto.inscripcion]);
  assert.deepEqual(ins, { codigo: 'PES', categoria_origen: 'eleccion_franja' });
  const ligero = await ok(adulto.token, 'estado');
  assert.equal(ligero.valores.fisicos.peso_kg, 82.5);

  await ok(adulto.token, 'paso/emergencia', { nombre: 'Contacto Emergencia', telefono: '611222333', relacion: 'Pareja' });
  const [ds0] = await q('SELECT fecha_nacimiento::text AS f, peso_declarado_kg::float AS peso, emergencia_telefono FROM datos_sensibles_piloto WHERE persona_id = $1', [adulto.persona]);
  assert.deepEqual(ds0, { f: '1990-05-10', peso: 82.5, emergencia_telefono: '+34611222333' });

  const subida = await ok(adulto.token, 'foto', JPEG, 'image/jpeg');
  assert.ok(subida.ok);
  fotos.push((await q('SELECT foto_blob_path FROM perfil_piloto WHERE persona_id = $1', [adulto.persona]))[0].foto_blob_path);
  await ok(adulto.token, 'paso/foto', {});

  const docs = await ok(adulto.token, 'paso/documentos', { reglamento: true, riesgos: true, nombre: 'Adulto Onboarding Prueba', documento: '12345678-z', imagen: { anuncios: true } });
  assert.equal(docs.estado, 'completado');

  const acept = await q(`SELECT d.tipo, d.version, a.aceptado, a.opciones, a.contexto, a.ip, a.user_agent, a.nombre_tecleado, a.documento_ultimos3,
      a.firmante_persona_id = a.persona_id AS firma_el, a.documento_hash = d.hash_sha256 AS hash_ok
    FROM aceptacion a JOIN documento_legal d ON d.id = a.documento_legal_id WHERE a.persona_id = $1 ORDER BY d.tipo`, [adulto.persona]);
  assert.deepEqual(acept.map((a) => a.tipo), ['asuncion_riesgos', 'cesion_imagen', 'consentimiento_peso', 'reglamento']);
  for (const a of acept) {
    assert.equal(a.version, version[a.tipo], 'Versión vigente del documento');
    assert.equal(a.contexto, 'onboarding');
    assert.equal(a.ip, '10.9.9.9');
    assert.equal(a.user_agent, UA);
    assert.ok(a.firma_el && a.hash_ok && a.aceptado);
  }
  const imagen = acept.find((a) => a.tipo === 'cesion_imagen');
  assert.deepEqual(imagen.opciones, { anuncios: true }, 'Web y redes son cobertura informativa (Art. 60 a); solo anuncios lleva casilla');
  const riesgos = acept.find((a) => a.tipo === 'asuncion_riesgos');
  assert.equal(riesgos.nombre_tecleado, 'Adulto Onboarding Prueba');
  assert.equal(riesgos.documento_ultimos3, '78Z');

  const [ds] = await q('SELECT documento_tipo, documento_cifrado, documento_ultimos3 FROM datos_sensibles_piloto WHERE persona_id = $1', [adulto.persona]);
  assert.equal(ds.documento_tipo, 'dni');
  assert.equal(ds.documento_ultimos3, '78Z');
  const crudo = Buffer.from(ds.documento_cifrado);
  assert.ok(!crudo.toString('latin1').includes('12345678') && !crudo.toString('hex').includes(Buffer.from('12345678').toString('hex')), 'El DNI no se lee en la tabla');
  assert.equal(descifrar(crudo), '12345678Z', 'Con la clave sí se recupera');

  const [o] = await q('SELECT estado, completado_en IS NOT NULL AS fecha, borrador FROM onboarding WHERE persona_id = $1', [adulto.persona]);
  assert.equal(o.estado, 'completado');
  assert.ok(o.fecha && !o.borrador.cifrado, 'Al completar se borra la parte cifrada del borrador');
  const [g] = await q('SELECT estado FROM acceso_grupo WHERE persona_id = $1', [adulto.persona]);
  assert.equal(g.estado, 'pendiente_aprobacion');
  assert.ok((await admin.panel('hoy')).grupo.some((x) => x.persona_id === adulto.persona), 'El panel avisa del grupo por aprobar');
});

test('El enlace del grupo solo se muestra al piloto cuando está aprobado', async () => {
  await admin.panel('onboarding/enlace-grupo', { enlace: 'https://chat.whatsapp.com/PruebaGrupoRukc' });
  assert.equal((await ok(adulto.token, 'estado')).grupo.enlace, null);
  const { grupo } = await admin.panel('onboarding');
  const g = grupo.find((x) => x.persona_id === adulto.persona);
  await assert.rejects(admin.panel(`grupo/${g.id}/rechazar`, {}), (e) => e.status === 400, 'Rechazar exige motivo');
  await admin.panel(`grupo/${g.id}/aprobar`, {});
  assert.equal((await ok(adulto.token, 'estado')).grupo.enlace, 'https://chat.whatsapp.com/PruebaGrupoRukc');
  const envio = await admin.panel(`grupo/${g.id}/enviar`, {});
  assert.ok(envio.url.startsWith('https://wa.me/') && decodeURIComponent(envio.url).includes('chat.whatsapp.com/PruebaGrupoRukc'));
  await admin.panel(`grupo/${g.id}/dentro`, {});
  assert.equal((await q('SELECT estado FROM acceso_grupo WHERE id = $1', [g.id]))[0].estado, 'dentro');
});

test('Menor de 18: no se completa sin tutor, firma el tutor y no se guarda la cesión para anuncios', async () => {
  const m = await nuevoPiloto('Menor Onboarding');
  await ok(m.token, 'estado');
  const p = await ok(m.token, 'paso/personales', { nombre: 'Menor', apellidos: 'Onboarding', fecha_nacimiento: hace(15), municipio: 'Mijas' });
  assert.equal(p.estado, 'falta_tutor');
  assert.ok(p.ficha.menor && p.ficha.pasos.includes('tutor'));
  const sinTutor = await ob(m.token, 'paso/documentos', { reglamento: true, riesgos: true, nombre: 'Alguien', documento: '12345678Z', imagen: {} });
  assert.equal(sinTutor.status, 400);
  assert.match(sinTutor.datos.error, /tutor/);
  const [o0] = await q('SELECT estado FROM onboarding WHERE persona_id = $1', [m.persona]);
  assert.equal(o0.estado, 'falta_tutor');

  // El menor dio en la reserva el teléfono de su madre: el tutor se crea aparte, sin repetir ese teléfono.
  const t = await ok(m.token, 'paso/tutor', { nombre: 'Madre', apellidos: 'Del Menor', telefono: m.telefono, email: `madre+${Date.now()}@example.com`, relacion: 'madre', documento: 'X1234567L' });
  assert.equal(t.estado, 'en_curso');
  await ok(m.token, 'paso/perfil', { nombre_competicion: 'Menor O.', dorsal: await dorsalLibre(), experiencia: 'ninguna', frecuencia: 'ocasional' });
  const sinPeso = await ok(m.token, 'paso/fisicos', { consiente_peso: false });
  assert.deepEqual([sinPeso.categoria, sinPeso.categoria_origen], ['PES', 'sin_consentimiento_peso'], 'Sin consentimiento: Pesados con 10 kg (Art. 23 bis f)');
  const [cat] = await q('SELECT cat.codigo, i.categoria_origen FROM inscripcion i JOIN categoria cat ON cat.id = i.categoria_id WHERE i.id = $1', [m.inscripcion]);
  assert.deepEqual(cat, { codigo: 'PES', categoria_origen: 'sin_consentimiento_peso' });
  await ok(m.token, 'paso/emergencia', { nombre: 'Padre Del Menor', telefono: '622333444' });
  await ok(m.token, 'paso/foto', {});
  const distinto = await ob(m.token, 'paso/documentos', { reglamento: true, riesgos: true, nombre: 'Madre Del Menor', documento: '12345678Z', imagen: { anuncios: true } });
  assert.equal(distinto.status, 400, 'El documento de la firma tiene que ser el del tutor');
  const fin = await ok(m.token, 'paso/documentos', { reglamento: true, riesgos: true, nombre: 'Madre Del Menor', documento: 'X1234567L', imagen: { anuncios: true } });
  assert.equal(fin.estado, 'completado');

  const [tu] = await q('SELECT tutor_persona_id, relacion FROM tutela WHERE menor_persona_id = $1', [m.persona]);
  assert.equal(tu.relacion, 'madre');
  const acept = await q(`SELECT d.tipo, a.firmante_persona_id, a.opciones, a.documento_ultimos3 FROM aceptacion a JOIN documento_legal d ON d.id = a.documento_legal_id
    WHERE a.persona_id = $1 ORDER BY d.tipo`, [m.persona]);
  assert.deepEqual(acept.map((a) => a.tipo), ['asuncion_riesgos', 'cesion_imagen', 'reglamento'], 'Sin consentimiento de peso no hay aceptación de peso');
  assert.ok(acept.every((a) => a.firmante_persona_id === tu.tutor_persona_id && a.documento_ultimos3 === '67L'), 'Firma el tutor');
  assert.deepEqual(acept.find((a) => a.tipo === 'cesion_imagen').opciones, { anuncios: false }, 'Anuncios nunca para un menor, aunque llegue en la petición');
  const [ds] = await q('SELECT documento_cifrado, peso_declarado_kg FROM datos_sensibles_piloto WHERE persona_id = $1', [m.persona]);
  assert.equal(ds.documento_cifrado, null);
  assert.equal(ds.peso_declarado_kg, null);

  // Aviso de edad mínima del circuito en el panel.
  await q('UPDATE circuito SET edad_minima = 16 WHERE id = (SELECT circuito_id FROM ronda WHERE id = $1)', [ronda.id]);
  const { edad } = await admin.panel('onboarding');
  assert.ok(edad.some((e) => e.persona_id === m.persona && e.edad_en_ronda < 16));
  assert.ok(!edad.some((e) => e.persona_id === adulto.persona));
});

test('Enlace con token falso, caducado o sin token: 404 sin pistas', async () => {
  const falso = await ob(nuevoToken(), 'estado');
  const sin = await ob(null, 'estado');
  await q(`UPDATE onboarding SET token_expira_en = now() - interval '1 minute' WHERE persona_id = $1`, [adulto.persona]);
  const caducado = await ob(adulto.token, 'estado');
  await q(`UPDATE onboarding SET token_expira_en = now() + interval '200 days' WHERE persona_id = $1`, [adulto.persona]);
  for (const r of [falso, sin, caducado]) assert.deepEqual([r.status, r.datos], [404, { error: 'No encontrado.' }]);
  const escribir = await ob(nuevoToken(), 'paso/personales', { nombre: 'X' });
  assert.deepEqual([escribir.status, escribir.datos], [404, { error: 'No encontrado.' }]);
});

test('La foto no se puede abrir sin permiso', async () => {
  const propia = await ob(adulto.token, 'foto');
  assert.equal(propia.status, 200);
  assert.ok(propia.datos.equals(JPEG));
  assert.equal((await ob(null, 'foto')).status, 404);
  assert.equal((await ob(nuevoToken(), 'foto')).status, 404);
  const otro = await nuevoPiloto('Otro Piloto');
  assert.equal((await ob(otro.token, 'foto')).status, 404, 'Con el enlace de otro piloto no se ve');
  const sinSesion = await adminGet(new Request(`${BASE}/api/admin?ruta=${encodeURIComponent(`personas/${adulto.persona}/foto`)}`));
  assert.equal(sinSesion.status, 401);
  const conSesion = await admin.crudo(`personas/${adulto.persona}/foto`);
  assert.equal(conSesion.status, 200);
  assert.equal(conSesion.headers.get('cache-control'), 'private, no-store');
  assert.equal((await ob(adulto.token, 'foto', Buffer.from('no es una imagen'), 'image/jpeg')).status, 415);
});

test('Marcar asistió sin onboarding pide motivo', async () => {
  const p = await nuevoPiloto('Sin Onboarding');
  await assert.rejects(admin.panel(`inscripciones/${p.inscripcion}/asistencia`, { estado: 'asistio' }), (e) => e.status === 400 && e.datos.necesita_motivo === true);
  await assert.rejects(q(`UPDATE inscripcion SET estado = 'asistio' WHERE id = $1`, [p.inscripcion]), /onboarding/, 'La base de datos también lo impide');
  await admin.panel(`inscripciones/${p.inscripcion}/asistencia`, { estado: 'asistio', motivo: 'Firmó en papel en el circuito' });
  const [i] = await q('SELECT estado, motivo FROM inscripcion WHERE id = $1', [p.inscripcion]);
  assert.deepEqual(i, { estado: 'asistio', motivo: 'Firmó en papel en el circuito' });
  await admin.panel(`inscripciones/${adulto.inscripcion}/asistencia`, { estado: 'asistio' });
  const lista = await admin.panel(`rondas/${ronda.id}/acreditacion`);
  assert.equal(lista.inscripciones.find((x) => x.id === adulto.inscripcion).estado, 'asistio', 'Con el onboarding completado no pide motivo');
});
