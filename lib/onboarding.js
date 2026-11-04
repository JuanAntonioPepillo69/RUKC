// Onboarding obligatorio del piloto (F5). El piloto entra con su enlace personal /onboarding/<token>; aquí solo llega
// el token y se busca por su hash. Todo se hace dentro de una transacción (cliente `c`).
//
// Dónde se guarda cada cosa:
// - En su tabla en cuanto se puede: persona, tutela, perfil_piloto, dorsal_temporada, datos_sensibles_piloto,
//   aceptacion, formacion_progreso.
// - En onboarding.borrador: los pasos hechos, el autoguardado de lo que se está escribiendo (sin fecha de nacimiento,
//   peso ni documento) y, cifrado con RUKC_DATA_KEY, lo sensible que aún no tiene fila: la fecha de nacimiento y el
//   peso hasta el paso de emergencia (datos_sensibles_piloto exige el contacto de emergencia) y el documento del tutor
//   hasta la firma. Al completar se borra la parte cifrada.
import { cifrar, descifrar } from './cifrado.js';
import { buscarOCrearPersona } from './flujos.js';
import { NO_AUTOGUARDAR, PASOS } from './validacion/onboarding.js';

const uno = async (c, t, p) => (await c.query(t, p)).rows[0];
const filas = async (c, t, p) => (await c.query(t, p)).rows;
const err = (status, mensaje, extra = {}) => Object.assign(new Error(mensaje), { status, ...extra });
const DOCS_ONBOARDING = ['reglamento', 'cesion_imagen', 'asuncion_riesgos'];
const VIGENTE = `d.vigente_desde IS NOT NULL AND d.vigente_desde <= now() AND (d.vigente_hasta IS NULL OR d.vigente_hasta > now())`;

/** Hoy en Madrid (AAAA-MM-DD). */
export const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());

/** Años cumplidos en la fecha `en` (AAAA-MM-DD). */
export function edad(nacimiento, en = hoyMadrid()) {
  const [a, m, d] = nacimiento.split('-').map(Number);
  const [A, M, D] = en.split('-').map(Number);
  return A - a - (M < m || (M === m && D < d) ? 1 : 0);
}

// ---------- Carga del onboarding por token ----------

/** Onboarding vigente del token (bloqueado para la transacción) o null. Al abrirlo por primera vez pasa a en_curso. */
export async function cargar(c, tokenHash) {
  const o = await uno(c, `SELECT o.*, t.codigo AS temporada, t.franja_ambas_categorias, t.enlace_grupo_whatsapp
    FROM onboarding o JOIN temporada t ON t.id = o.temporada_id
    JOIN persona p ON p.id = o.persona_id AND p.estado = 'activa'
    WHERE o.token_hash = $1 AND o.token_expira_en > now() FOR UPDATE OF o`, [tokenHash]);
  if (!o) return null;
  if (o.estado === 'pendiente') {
    await c.query(`UPDATE onboarding SET estado = 'en_curso' WHERE id = $1`, [o.id]);
    o.estado = 'en_curso';
  }
  o.borrador = o.borrador ?? {};
  return o;
}

const secreto = (o) => (o.borrador.cifrado ? JSON.parse(descifrar(Buffer.from(o.borrador.cifrado, 'base64'))) : {});

async function guardarBorrador(c, o, cambios = {}) {
  const b = { ...o.borrador, ...cambios };
  if (cambios.secreto !== undefined) {
    const s = cambios.secreto;
    delete b.secreto;
    if (Object.keys(s).length) b.cifrado = cifrar(JSON.stringify(s)).toString('base64');
    else delete b.cifrado;
  }
  o.borrador = b;
  await c.query('UPDATE onboarding SET borrador = $2 WHERE id = $1', [o.id, b]);
}

async function marcarHecho(c, o, paso) {
  const hechos = [...new Set([...(o.borrador.hechos ?? []), paso])];
  const pasos = { ...(o.borrador.pasos ?? {}) };
  delete pasos[paso];
  o.borrador.hechos = hechos;
  o.borrador.pasos = pasos;
  const siguiente = PASOS.indexOf(paso) + 2;   // paso_actual es 1-based sobre la lista completa
  await c.query('UPDATE onboarding SET borrador = $2, paso_actual = greatest(coalesce(paso_actual, 1), $3) WHERE id = $1',
    [o.id, o.borrador, Math.min(siguiente, PASOS.length)]);
}

async function sensibles(c, personaId) {
  return uno(c, 'SELECT fecha_nacimiento::text AS fecha_nacimiento, peso_declarado_kg, emergencia_nombre, emergencia_telefono, emergencia_relacion, documento_ultimos3 FROM datos_sensibles_piloto WHERE persona_id = $1', [personaId]);
}

async function tutorActual(c, o) {
  const s = secreto(o);
  return uno(c, `SELECT p.id, p.nombre, p.apellidos, p.telefono, p.email, tu.relacion FROM tutela tu JOIN persona p ON p.id = tu.tutor_persona_id
    WHERE tu.menor_persona_id = $1 ORDER BY (p.id::text = $2) DESC, tu.creado_en DESC LIMIT 1`, [o.persona_id, s.tutor_id ?? '']);
}

async function fechaNacimiento(c, o) {
  return (await sensibles(c, o.persona_id))?.fecha_nacimiento ?? secreto(o).fecha_nacimiento ?? null;
}

async function hayFormacion(c, o) {
  return Boolean(await uno(c, 'SELECT 1 FROM formacion_modulo WHERE temporada_id = $1 AND activo LIMIT 1', [o.temporada_id]));
}

/** Pasos que ve este piloto, en orden. Con una versión nueva de un documento solo queda el de documentos. */
export function pasosVisibles({ estado, menor, formacion }) {
  if (estado === 'requiere_actualizacion') return ['documentos'];
  return PASOS.filter((p) => (p !== 'tutor' || menor) && (p !== 'formacion' || formacion));
}

async function documentosVigentes(c) {
  return filas(c, `SELECT d.id, d.tipo, d.version, d.titulo, d.contenido_md, d.obligatorio_onboarding, d.revocable FROM documento_legal d
    WHERE ${VIGENTE} AND (d.tipo = ANY ($1) OR d.tipo = 'consentimiento_peso') ORDER BY array_position($1, d.tipo)`, [DOCS_ONBOARDING]);
}

async function grupo(c, o) {
  const g = await uno(c, 'SELECT estado, motivo_rechazo FROM acceso_grupo WHERE persona_id = $1 AND temporada_id = $2', [o.persona_id, o.temporada_id]);
  if (!g) return null;
  const aprobado = ['aprobado', 'enlace_enviado', 'dentro'].includes(g.estado);
  return { estado: g.estado, enlace: aprobado ? o.enlace_grupo_whatsapp ?? null : null };
}

// ---------- GET: todo lo que necesita la página ----------

export async function estado(c, o) {
  const p = await uno(c, 'SELECT nombre, apellidos, telefono, email, municipio, instagram FROM persona WHERE id = $1', [o.persona_id]);
  const ds = await sensibles(c, o.persona_id);
  const s = secreto(o);
  const nacimiento = ds?.fecha_nacimiento ?? s.fecha_nacimiento ?? null;
  const menor = nacimiento ? edad(nacimiento) < 18 : false;
  const formacion = await filas(c, `SELECT m.id, m.titulo, m.url, m.obligatorio, (fp.persona_id IS NOT NULL) AS visto FROM formacion_modulo m
    LEFT JOIN formacion_progreso fp ON fp.modulo_id = m.id AND fp.persona_id = $2 WHERE m.temporada_id = $1 AND m.activo ORDER BY m.orden, m.titulo`,
  [o.temporada_id, o.persona_id]);
  const perfil = await uno(c, 'SELECT nombre_competicion, experiencia, frecuencia, ligas_previas, circuitos_rodados, altura_cm, objetivo, como_nos_conocio, comentarios, (foto_blob_path IS NOT NULL) AS foto FROM perfil_piloto WHERE persona_id = $1', [o.persona_id]);
  const dorsal = await uno(c, 'SELECT dorsal FROM dorsal_temporada WHERE temporada_id = $1 AND persona_id = $2', [o.temporada_id, o.persona_id]);
  const ocupados = (await filas(c, 'SELECT dorsal FROM dorsal_temporada WHERE temporada_id = $1 AND persona_id <> $2 ORDER BY dorsal', [o.temporada_id, o.persona_id])).map((r) => r.dorsal);
  const tutor = menor ? await tutorActual(c, o) : null;
  const consentimiento = await uno(c, `SELECT a.id FROM aceptacion a JOIN documento_legal d ON d.id = a.documento_legal_id
    WHERE a.persona_id = $1 AND d.tipo = 'consentimiento_peso' AND a.aceptado AND a.revocada_en IS NULL LIMIT 1`, [o.persona_id]);
  const categorias = await filas(c, 'SELECT codigo, nombre, peso_minimo_kg FROM categoria WHERE temporada_id = $1 ORDER BY orden, codigo', [o.temporada_id]);
  const reglas = await filas(c, 'SELECT hasta_kg, resultado FROM regla_categoria WHERE temporada_id = $1 ORDER BY hasta_kg ASC NULLS LAST', [o.temporada_id]);
  const inscritas = await filas(c, `SELECT r.numero, ci.nombre AS circuito, cat.codigo AS categoria FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id
    JOIN circuito ci ON ci.id = r.circuito_id LEFT JOIN categoria cat ON cat.id = i.categoria_id
    WHERE i.piloto_persona_id = $1 AND r.temporada_id = $2 AND i.estado IN ('pendiente_pago', 'reservada', 'pagada') ORDER BY r.numero`, [o.persona_id, o.temporada_id]);
  const docs = await documentosVigentes(c);
  const firmados = (await filas(c, 'SELECT documento_legal_id FROM aceptacion WHERE persona_id = $1 AND revocada_en IS NULL', [o.persona_id])).map((r) => r.documento_legal_id);
  const anonimo = (doc) => (doc ? `***${doc.slice(-3)}` : null);

  return {
    estado: o.estado,
    temporada: o.temporada,
    pasos: pasosVisibles({ estado: o.estado, menor, formacion: formacion.length > 0 }),
    hechos: o.borrador.hechos ?? [],
    autoguardado: o.borrador.pasos ?? {},
    menor,
    valores: {
      personales: { nombre: p.nombre, apellidos: p.apellidos, municipio: p.municipio, instagram: p.instagram, fecha_nacimiento: nacimiento },
      contacto: { telefono: p.telefono, email: p.email },
      tutor: tutor ? { nombre: tutor.nombre, apellidos: tutor.apellidos, telefono: tutor.telefono, email: tutor.email, relacion: tutor.relacion,
        documento_guardado: anonimo(s.tutor_documento) } : null,
      perfil: perfil ? { ...perfil, dorsal: dorsal?.dorsal ?? null } : { dorsal: dorsal?.dorsal ?? null,
        nombre_competicion: `${p.nombre}${p.apellidos ? ` ${p.apellidos.trim()[0].toUpperCase()}.` : ''}` },
      fisicos: { consiente_peso: Boolean(consentimiento), peso_kg: ds?.peso_declarado_kg != null ? Number(ds.peso_declarado_kg) : s.peso_kg ?? null,
        altura_cm: perfil?.altura_cm ?? null, categoria: inscritas.find((i) => i.categoria)?.categoria ?? null },
      emergencia: ds ? { nombre: ds.emergencia_nombre, telefono: ds.emergencia_telefono, relacion: ds.emergencia_relacion } : null,
      documento_guardado: ds?.documento_ultimos3 ? `***${ds.documento_ultimos3}` : null,
    },
    dorsales_ocupados: ocupados,
    categorias: categorias.map((x) => ({ ...x, peso_minimo_kg: Number(x.peso_minimo_kg) })),
    reglas: reglas.map((r) => ({ hasta_kg: r.hasta_kg == null ? null : Number(r.hasta_kg), resultado: r.resultado })),
    franja_ambas_categorias: o.franja_ambas_categorias,
    inscripciones: inscritas,
    documentos: docs.map((d) => ({ tipo: d.tipo, version: d.version, titulo: d.titulo, contenido_md: d.contenido_md, firmado: firmados.includes(d.id) })),
    documentos_listos: DOCS_ONBOARDING.every((t) => docs.some((d) => d.tipo === t)),
    formacion,
    foto: Boolean(perfil?.foto),
    grupo: await grupo(c, o),
  };
}

// ---------- POST borrador: autoguardado sin datos sensibles ----------

export async function autoguardar(c, o, { paso, campos }) {
  const limpio = Object.fromEntries(Object.entries(campos).filter(([k]) => !NO_AUTOGUARDAR.includes(k)));
  if (JSON.stringify(limpio).length > 8000) throw err(413, 'Demasiado texto.');
  await guardarBorrador(c, o, { pasos: { ...(o.borrador.pasos ?? {}), [paso]: limpio } });
  await c.query('UPDATE onboarding SET paso_actual = $2 WHERE id = $1', [o.id, PASOS.indexOf(paso) + 1]);
}

// ---------- POST paso/<nombre> ----------

const editable = (o) => {
  if (o.estado === 'completado') throw err(409, 'Tu ficha ya está completa. Si tienes que cambiar algo, escríbenos por WhatsApp.');
  if (o.estado === 'requiere_actualizacion') throw err(409, 'Solo falta aceptar la nueva versión de los documentos.');
};

async function personales(c, o, d) {
  const anios = edad(d.fecha_nacimiento);
  if (Number.isNaN(anios) || anios < 6 || anios > 99) throw err(400, 'Revisa la fecha de nacimiento.', { campo: 'fecha_nacimiento' });
  await c.query('UPDATE persona SET nombre = $2, apellidos = $3, municipio = $4, instagram = coalesce($5, instagram) WHERE id = $1',
    [o.persona_id, d.nombre, d.apellidos, d.municipio, d.instagram]);
  const ds = await sensibles(c, o.persona_id);
  if (ds) await c.query('UPDATE datos_sensibles_piloto SET fecha_nacimiento = $2 WHERE persona_id = $1', [o.persona_id, d.fecha_nacimiento]);
  else await guardarBorrador(c, o, { secreto: { ...secreto(o), fecha_nacimiento: d.fecha_nacimiento } });
  const menor = anios < 18;
  const tieneTutor = Boolean(await tutorActual(c, o));
  const nuevo = menor && !tieneTutor ? 'falta_tutor' : 'en_curso';
  if (nuevo !== o.estado) { await c.query('UPDATE onboarding SET estado = $2 WHERE id = $1', [o.id, nuevo]); o.estado = nuevo; }
}

async function tutor(c, o, d) {
  const nacimiento = await fechaNacimiento(c, o);
  if (!nacimiento || edad(nacimiento) >= 18) throw err(400, 'El paso del tutor solo es para menores de 18 años.');
  const nombreCompleto = `${d.nombre} ${d.apellidos}`;
  let t = await buscarOCrearPersona(c, { nombreCompleto, telefono: d.telefono, email: d.email, origen: 'onboarding', creadoPor: 'publico' });
  if (t.id === o.persona_id) {
    // El piloto usa el teléfono o el email de su madre, padre o tutor: el tutor se crea aparte sin ese contacto repetido.
    const piloto = await uno(c, 'SELECT telefono, email FROM persona WHERE id = $1', [o.persona_id]);
    const tel = piloto.telefono === d.telefono ? null : d.telefono;
    const mail = piloto.email && d.email && piloto.email.toLowerCase() === d.email ? null : d.email;
    if (!tel && !mail) throw err(400, 'El tutor necesita un teléfono o un email distinto del piloto.', { campo: 'telefono' });
    t = await buscarOCrearPersona(c, { nombreCompleto, telefono: tel, email: mail, origen: 'onboarding', creadoPor: 'publico' });
    await c.query(`INSERT INTO interaccion (persona_id, tipo, resumen, ocurrida_en, creado_por) VALUES ($1, 'nota', $2, now(), 'sistema')`,
      [t.id, 'Tutor: comparte el contacto con el piloto, que lo dio en su reserva.']);
  }
  await c.query(`INSERT INTO tutela (menor_persona_id, tutor_persona_id, relacion, creado_por) VALUES ($1, $2, $3, 'publico')
    ON CONFLICT (menor_persona_id, tutor_persona_id) DO UPDATE SET relacion = EXCLUDED.relacion`, [o.persona_id, t.id, d.relacion]);
  await guardarBorrador(c, o, { secreto: { ...secreto(o), tutor_id: t.id, tutor_documento: d.documento.numero } });
  if (o.estado === 'falta_tutor') { await c.query(`UPDATE onboarding SET estado = 'en_curso' WHERE id = $1`, [o.id]); o.estado = 'en_curso'; }
}

async function perfil(c, o, d) {
  const ocupado = await uno(c, 'SELECT 1 FROM dorsal_temporada WHERE temporada_id = $1 AND dorsal = $2 AND persona_id <> $3', [o.temporada_id, d.dorsal, o.persona_id]);
  if (ocupado) throw err(409, `El dorsal ${d.dorsal} ya lo tiene otro piloto. Elige otro.`, { campo: 'dorsal' });
  const ligas = ['amateur', 'competicion'].includes(d.experiencia) ? d.ligas_previas : null;
  await c.query(`INSERT INTO perfil_piloto (persona_id, nombre_competicion, experiencia, frecuencia, ligas_previas, circuitos_rodados, objetivo, como_nos_conocio, comentarios, creado_por)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'publico')
    ON CONFLICT (persona_id) DO UPDATE SET nombre_competicion = EXCLUDED.nombre_competicion, experiencia = EXCLUDED.experiencia, frecuencia = EXCLUDED.frecuencia,
      ligas_previas = EXCLUDED.ligas_previas, circuitos_rodados = EXCLUDED.circuitos_rodados, objetivo = EXCLUDED.objetivo,
      como_nos_conocio = EXCLUDED.como_nos_conocio, comentarios = EXCLUDED.comentarios`,
  [o.persona_id, d.nombre_competicion, d.experiencia, d.frecuencia, ligas, d.circuitos_rodados, d.objetivo, d.como_nos_conocio, d.comentarios]);
  await c.query(`INSERT INTO dorsal_temporada (temporada_id, persona_id, dorsal, creado_por) VALUES ($1, $2, $3, 'publico')
    ON CONFLICT (temporada_id, persona_id) DO UPDATE SET dorsal = EXCLUDED.dorsal`, [o.temporada_id, o.persona_id, d.dorsal]);
}

/** Quién firma por el piloto: él mismo o, si es menor, su tutor. */
async function firmante(c, o) {
  const nacimiento = await fechaNacimiento(c, o);
  const menor = nacimiento ? edad(nacimiento) < 18 : false;
  if (!menor) return { id: o.persona_id, menor };
  const t = await tutorActual(c, o);
  if (!t) throw err(400, 'Falta el paso del tutor.');
  return { id: t.id, menor };
}

async function fisicos(c, o, d, ctx) {
  const doc = await uno(c, `SELECT d.id FROM documento_legal d WHERE d.tipo = 'consentimiento_peso' AND ${VIGENTE}`);
  const activo = await uno(c, `SELECT a.id FROM aceptacion a JOIN documento_legal d ON d.id = a.documento_legal_id
    WHERE a.persona_id = $1 AND d.tipo = 'consentimiento_peso' AND a.aceptado AND a.revocada_en IS NULL`, [o.persona_id]);
  const ds = await sensibles(c, o.persona_id);
  let categoria = null, origen = null;

  if (d.consiente_peso) {
    if (!doc && !activo) throw err(503, 'El texto del consentimiento de peso aún no está publicado. Puedes seguir sin indicar el peso.');
    if (!activo) {
      const f = await firmante(c, o);
      await c.query(`INSERT INTO aceptacion (persona_id, firmante_persona_id, documento_legal_id, aceptado, contexto, ip, user_agent, creado_por)
        VALUES ($1, $2, $3, true, 'onboarding', $4, $5, 'publico')`, [o.persona_id, f.id, doc.id, ctx.ip, ctx.userAgent]);
    }
    const peso = Math.round(d.peso_kg * 10) / 10;
    if (ds) await c.query('UPDATE datos_sensibles_piloto SET peso_declarado_kg = $2, peso_declarado_en = now() WHERE persona_id = $1', [o.persona_id, peso]);
    else await guardarBorrador(c, o, { secreto: { ...secreto(o), peso_kg: peso } });
    const r = (await uno(c, 'SELECT categoria_por_peso($1, $2) AS r', [o.temporada_id, peso])).r;
    if (r === 'eleccion') {
      const valida = d.categoria && await uno(c, 'SELECT 1 FROM categoria WHERE temporada_id = $1 AND codigo = $2', [o.temporada_id, d.categoria]);
      if (!valida) throw err(400, 'Con tu peso puedes elegir categoría: elige una.', { campo: 'categoria' });
      categoria = d.categoria; origen = 'eleccion_franja';
    } else if (r) { categoria = r; origen = 'por_peso'; }
  } else {
    // Sin consentimiento no se guarda el peso; si lo había dado, se revoca y se borra el peso.
    if (activo) await c.query('UPDATE aceptacion SET revocada_en = now() WHERE id = $1', [activo.id]);
    if (ds) await c.query('UPDATE datos_sensibles_piloto SET peso_declarado_kg = NULL, peso_declarado_en = NULL WHERE persona_id = $1', [o.persona_id]);
    const s = secreto(o);
    if (s.peso_kg != null) { delete s.peso_kg; await guardarBorrador(c, o, { secreto: s }); }
    // Reglamento v1.1, Art. 23 bis f: corre en Pesados (la categoría sin límite de peso) con 10 kg de lastre.
    const r = await uno(c, `SELECT resultado FROM regla_categoria WHERE temporada_id = $1 AND hasta_kg IS NULL AND resultado <> 'eleccion'`, [o.temporada_id]);
    if (r) { categoria = r.resultado; origen = 'sin_consentimiento_peso'; }
  }

  await c.query(`INSERT INTO perfil_piloto (persona_id, nombre_competicion, altura_cm, creado_por) VALUES ($1, '', $2, 'publico')
    ON CONFLICT (persona_id) DO UPDATE SET altura_cm = EXCLUDED.altura_cm`, [o.persona_id, d.altura_cm ?? null]);

  if (categoria) {
    // Categoría en sus inscripciones activas de la temporada (no en las rondas donde ya corre en las dos categorías).
    await c.query(`UPDATE inscripcion i SET categoria_id = cat.id, categoria_origen = $3
      FROM ronda r, categoria cat
      WHERE r.id = i.ronda_id AND r.temporada_id = $2 AND cat.temporada_id = $2 AND cat.codigo = $4
        AND i.piloto_persona_id = $1 AND i.estado IN ('pendiente_pago', 'reservada', 'pagada')
        AND (i.categoria_id IS DISTINCT FROM cat.id OR i.categoria_origen IS DISTINCT FROM $3)
        AND NOT EXISTS (SELECT 1 FROM inscripcion j WHERE j.piloto_persona_id = i.piloto_persona_id AND j.ronda_id = i.ronda_id
                        AND j.id <> i.id AND j.estado NOT IN ('trasladada', 'cancelada'))`,
    [o.persona_id, o.temporada_id, origen, categoria]);
  }
  if (d.quiere_ambas && origen === 'eleccion_franja' && o.franja_ambas_categorias) {
    await c.query(`INSERT INTO interaccion (persona_id, tipo, resumen, ocurrida_en, creado_por) VALUES ($1, 'nota', $2, now(), 'sistema')`,
      [o.persona_id, 'Onboarding: quiere correr también en la otra categoría (está en la franja de peso).']);
  }
  return { categoria, categoria_origen: origen };
}

async function emergencia(c, o, d) {
  const ds = await sensibles(c, o.persona_id);
  if (ds) {
    await c.query('UPDATE datos_sensibles_piloto SET emergencia_nombre = $2, emergencia_telefono = $3, emergencia_relacion = $4 WHERE persona_id = $1',
      [o.persona_id, d.nombre, d.telefono, d.relacion]);
    return;
  }
  const s = secreto(o);
  if (!s.fecha_nacimiento) throw err(400, 'Completa primero tus datos personales.');
  const peso = s.peso_kg ?? null;
  await c.query(`INSERT INTO datos_sensibles_piloto (persona_id, fecha_nacimiento, peso_declarado_kg, peso_declarado_en, emergencia_nombre, emergencia_telefono, emergencia_relacion, creado_por)
    VALUES ($1, $2, $3, CASE WHEN $3::numeric IS NULL THEN NULL ELSE now() END, $4, $5, $6, 'publico')`,
  [o.persona_id, s.fecha_nacimiento, peso, d.nombre, d.telefono, d.relacion]);
  delete s.fecha_nacimiento; delete s.peso_kg;
  await guardarBorrador(c, o, { secreto: s });
}

async function formacionHecha(c, o) {
  const falta = await uno(c, `SELECT m.titulo FROM formacion_modulo m WHERE m.temporada_id = $1 AND m.activo AND m.obligatorio
    AND NOT EXISTS (SELECT 1 FROM formacion_progreso fp WHERE fp.modulo_id = m.id AND fp.persona_id = $2) ORDER BY m.orden LIMIT 1`, [o.temporada_id, o.persona_id]);
  if (falta) throw err(400, `Falta ver «${falta.titulo}».`);
}

export async function marcarFormacion(c, o, moduloId) {
  const m = await uno(c, 'SELECT id FROM formacion_modulo WHERE id = $1 AND temporada_id = $2 AND activo', [moduloId, o.temporada_id]);
  if (!m) throw err(404, 'No encontrado.');
  await c.query(`INSERT INTO formacion_progreso (persona_id, modulo_id, creado_por) VALUES ($1, $2, 'publico') ON CONFLICT DO NOTHING`, [o.persona_id, m.id]);
}

/** Último paso: firma de los documentos. Completa el onboarding y pide el acceso al grupo. */
async function documentos(c, o, d, ctx) {
  if (o.estado === 'falta_tutor') throw err(400, 'Falta el paso del tutor.');
  if (!['en_curso', 'requiere_actualizacion'].includes(o.estado)) throw err(409, 'Tu ficha ya está completa.');
  const docs = (await documentosVigentes(c)).filter((x) => DOCS_ONBOARDING.includes(x.tipo));
  if (docs.length < DOCS_ONBOARDING.length) throw err(503, 'Los documentos todavía no están publicados. Te avisaremos por WhatsApp para firmarlos.');

  if (o.estado === 'en_curso') {
    const ds = await sensibles(c, o.persona_id);
    const faltan = [];
    if (!(await fechaNacimiento(c, o))) faltan.push('datos personales');
    if (!(await uno(c, 'SELECT 1 FROM dorsal_temporada WHERE temporada_id = $1 AND persona_id = $2', [o.temporada_id, o.persona_id]))) faltan.push('perfil');
    if (!ds) faltan.push('contacto de emergencia');
    if (faltan.length) throw err(400, `Te falta: ${faltan.join(', ')}.`);
    await formacionHecha(c, o);
  }

  const f = await firmante(c, o);
  const s = secreto(o);
  if (f.menor && s.tutor_documento && s.tutor_documento !== d.documento.numero) {
    throw err(400, 'El documento no coincide con el que pusiste en el paso del tutor.', { campo: 'documento' });
  }
  if (!f.menor) {
    await c.query('UPDATE datos_sensibles_piloto SET documento_tipo = $2, documento_cifrado = $3, documento_ultimos3 = $4 WHERE persona_id = $1',
      [o.persona_id, d.documento.tipo, cifrar(d.documento.numero), d.documento.numero.slice(-3)]);
  }
  const ultimos3 = d.documento.numero.slice(-3);
  const ya = (await filas(c, 'SELECT documento_legal_id FROM aceptacion WHERE persona_id = $1 AND revocada_en IS NULL', [o.persona_id])).map((r) => r.documento_legal_id);
  for (const doc of docs) {
    if (ya.includes(doc.id)) continue;
    // Imagen (reglamento v1.1, Art. 60): la cobertura en la web y las redes es informativa (se puede oponer por el
    // canal oficial); solo el uso publicitario lleva consentimiento, en una casilla aparte, y nunca para menores.
    const opciones = doc.tipo === 'cesion_imagen' ? { anuncios: f.menor ? false : Boolean(d.imagen.anuncios) } : null;
    await c.query(`INSERT INTO aceptacion (persona_id, firmante_persona_id, documento_legal_id, aceptado, opciones, contexto, nombre_tecleado, documento_ultimos3, ip, user_agent, creado_por)
      VALUES ($1, $2, $3, true, $4, 'onboarding', $5, $6, $7, $8, 'publico')`,
    [o.persona_id, f.id, doc.id, opciones, d.nombre, ultimos3, ctx.ip, ctx.userAgent]);
  }
  await c.query(`UPDATE onboarding SET estado = 'completado', paso_actual = $2 WHERE id = $1`, [o.id, PASOS.length]);
  o.estado = 'completado';
  const b = { ...o.borrador, hechos: [...new Set([...(o.borrador.hechos ?? []), 'documentos'])], pasos: {} };
  delete b.cifrado;
  o.borrador = b;
  await c.query('UPDATE onboarding SET borrador = $2 WHERE id = $1', [o.id, b]);
  await c.query(`INSERT INTO acceso_grupo (persona_id, temporada_id, creado_por) VALUES ($1, $2, 'publico') ON CONFLICT (persona_id, temporada_id) DO NOTHING`,
    [o.persona_id, o.temporada_id]);
}

const PASO = { personales, tutor, perfil, fisicos, emergencia, documentos };

/** Guarda un paso validado. ctx: { ip, userAgent }. */
export async function guardarPaso(c, o, nombre, datos, ctx) {
  if (nombre !== 'documentos') editable(o);
  let extra = {};
  if (nombre === 'foto') { /* "Más tarde": solo se marca el paso */ }
  else if (nombre === 'formacion') await formacionHecha(c, o);
  else extra = (await PASO[nombre](c, o, datos, ctx)) ?? {};
  if (nombre !== 'documentos') await marcarHecho(c, o, nombre);
  return { estado: o.estado, ...extra };
}
