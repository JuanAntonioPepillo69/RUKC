// Animación del grupo de pilotos (decisión de John del 18/11/2026, opción "semiautomática").
// La API oficial de WhatsApp no puede leer ni escribir en el grupo de pilotos (grupo creado desde la app, más de 8
// personas), así que el bot prepara cada mensaje a su hora y se lo manda a John por el canal admin; John lo copia y lo
// pega en el grupo. Calendario (hora de Madrid, CALENDARIO_GRUPO):
// - Todos los días, 10:00: mensaje del día (pregunta, reto, recordatorio o comentario), redactado por Claude.
// - Todos los días, 18:30: comentario de la tarde, solo si John ha reenviado al bot mensajes del grupo desde la mañana
//   (o los ha pegado con "GRUPO <texto>"). Sin movimiento, no sale nada.
// - Lunes, 12:00: recordatorio de la próxima carrera con fecha, horarios por categoría y pilotos inscritos (sin IA).
// - Martes, jueves y sábado, 17:00: un punto del reglamento, rotando por ARTICULOS (texto de kb_documents
//   web_reglamento, explicado por Claude).
// - Los carteles de inscritos siguen saliendo los miércoles por su cuenta (/api/inscritos/semanal).
// Cada publicación queda en wa_batches (automatizacion D3, sin ronda, vista_previa "[grupo:<tipo>:<fecha>] <texto>"):
// sirve para no repetirla y para que Claude no repita temas. Se para con PAUSA GRUPO (bot_settings.grupo_activo).
import { consulta } from '../db.js';
import { limpiarTexto } from '../bot/turn.js';

const uno = async (t, p) => (await consulta(t, p))[0] ?? null;

export const CALENDARIO_GRUPO = {
  diario: { hora: '10:00', limite: '13:00', titulo: 'mensaje del día' },
  tarde: { hora: '18:30', limite: '21:00', titulo: 'comentario de la tarde' },
  carrera: { dias: [1], hora: '12:00', limite: '20:00', titulo: 'recordatorio de la próxima carrera' },
  reglamento: { dias: [2, 4, 6], hora: '17:00', limite: '20:30', titulo: 'punto del reglamento' },
};
// Días de la semana en Madrid: 0 domingo … 6 sábado.
const DIA_SEMANA = { domingo: 0, lunes: 1, martes: 2, 'miércoles': 3, jueves: 4, viernes: 5, 'sábado': 6 };

// Artículos del reglamento que más afectan a los pilotos, en el orden en que van saliendo (y vuelta a empezar).
export const ARTICULOS = [
  '28', '33', '39', '17', '23 bis', '34', '19', '35', '46', '23 ter', '36', '29', '38', '21', '37', '47', '30', '19 bis',
  '40', '22', '45', '18', '48', '31 bis', '55', '23', '49', '18 bis', '56', '29 bis', '26', '31 quater', '32', '54', '57',
];
// Tipos del mensaje del día, por turnos, para que no salga siempre una pregunta.
export const TIPOS_DIARIO = [
  'una pregunta abierta a los pilotos para que contesten en el grupo',
  'un reto o una predicción para la próxima carrera (quién hará la pole, cuántos adelantamientos, etc.)',
  'un recordatorio práctico de lo que toca ahora (inscripción, ficha de piloto, horarios, qué llevar), según los días que faltan',
  'un consejo de pilotaje de karting de alquiler, corto y útil, rematado con una pregunta',
  'algo para hacer comunidad: experiencias, anécdotas de la última carrera o qué circuito prefieren',
];

const SISTEMA = `Escribes los mensajes que el equipo de RUKC (RaceUp Karting Championship, liga de karting de alquiler de la provincia de Málaga) publica en el grupo de WhatsApp de sus pilotos para dar vida al grupo.
Reglas:
- Español de España, hablando al grupo (vosotros), cercano, directo y con energía. Sin emojis, sin markdown, sin hashtags, sin listas con viñetas.
- Corto: de 2 a 5 líneas. Un solo mensaje. Si preguntas, una sola pregunta, al final.
- Datos (fechas, horas, plazas, precios, normas): solo los de <contexto>. Si un dato no está, no lo menciones. No inventes resultados, nombres ni anécdotas.
- No nombres a John ni a nadie del equipo. No prometas nada (premios, descuentos, cambios).
- No repitas el tema ni la pregunta de <publicaciones_anteriores>.
- Devuelve solo el texto del mensaje, sin comillas ni explicaciones.`;

// --- Utilidades ------------------------------------------------------------------------------------------------------
function madrid(ahora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long',
  }).formatToParts(ahora).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`, dia: DIA_SEMANA[p.weekday] };
}
const clave = (tipo, fecha) => `[grupo:${tipo}:${fecha}]`;
const claveOmitida = (tipo, fecha) => `[grupo-omitido:${tipo}:${fecha}]`;
/** Desde cuándo cuentan los mensajes reenviados para el comentario de la tarde: hoy a las 6:00 (hora de Madrid). */
const inicioDelDia = (fecha) => new Date(new Date(`${fecha}T06:00:00Z`).getTime() - 60 * 60_000);
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 864e5);

async function activo() {
  const f = await uno(`SELECT valor FROM bot_settings WHERE clave = 'grupo_activo'`);
  return f?.valor !== 'false';
}

/** PAUSA GRUPO / REANUDA GRUPO (canal admin). */
export async function activarGrupo(si) {
  await consulta(
    `INSERT INTO bot_settings (clave, valor) VALUES ('grupo_activo', $1)
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now()`, [si ? 'true' : 'false']);
  return si
    ? 'Hecho: vuelven los mensajes para el grupo de pilotos (mensaje del día a las 10:00, reglamento martes, jueves y sábado, próxima carrera los lunes).'
    : 'Hecho: no te mandaré más mensajes para el grupo de pilotos hasta que escribas REANUDA GRUPO. Los carteles de inscritos de los miércoles siguen saliendo.';
}

/** Publicaciones anteriores para el grupo (las más recientes primero). */
export async function publicacionesAnteriores(limite = 20) {
  const filas = await consulta(
    `SELECT vista_previa, created_at FROM wa_batches
     WHERE automatizacion = 'D3' AND ronda_id IS NULL AND estado = 'enviado' AND vista_previa LIKE '[grupo:%'
     ORDER BY created_at DESC LIMIT $1`, [limite]);
  return filas.map((f) => {
    const [, tipo, fecha, texto] = f.vista_previa.match(/^\[grupo:([a-z]+):([0-9-]+)\]\s*([\s\S]*)$/) ?? [];
    return { tipo, fecha, texto };
  }).filter((x) => x.tipo);
}

// --- Contexto de la liga ------------------------------------------------------------------------------------------
/** Próxima ronda con horas y plazas por categoría, pilotos inscritos y el resto del calendario. */
export async function contextoLiga(ahora = new Date()) {
  const { rondas, fechaTexto } = await import('../bot/datos.js');
  const { proximaRonda, parrilla } = await import('../inscritos/datos.js');
  const hoy = madrid(ahora).fecha;
  const todas = (await rondas({ soloAbiertas: false })).filter((r) => ['programada', 'aplazada'].includes(r.estado) && r.fecha >= hoy);
  const prox = await proximaRonda(ahora);
  const r = prox ? todas.find((x) => x.ronda_id === prox.id) : null;
  let categorias = [];
  if (prox && r) {
    categorias = await Promise.all(['LIG', 'PES'].map(async (cat) => {
      const p = await parrilla(prox, cat).catch(() => null);
      const cupo = r.plazas_por_categoria.find((c) => c.categoria === p?.nombre);
      return p && {
        categoria: p.nombre, inscritos: p.pilotos.length, plazas: p.plazas, libres: Math.max(0, p.plazas - p.pilotos.length),
        hora_llegada: cupo?.hora_llegada ?? null, hora_briefing: cupo?.hora_briefing ?? null,
        pilotos: p.pilotos.map((x) => (x.dorsal ? `${x.nombre} (${x.dorsal})` : x.nombre)),
      };
    })).then((x) => x.filter(Boolean));
  }
  return {
    hoy: fechaTexto(hoy),
    proxima: r && {
      ronda: r.ronda, fecha: r.fecha, fecha_texto: r.fecha_texto, circuito: r.circuito, municipio: r.municipio,
      dias_que_faltan: diasEntre(hoy, r.fecha), cierre_inscripcion: r.cierre_inscripcion_texto,
      inscripcion_abierta: r.inscripcion_abierta, maps: r.maps_url, categorias,
    },
    calendario: todas.map((x) => `${x.ronda}: ${x.fecha_texto}, ${x.circuito}`),
  };
}

// --- Textos ----------------------------------------------------------------------------------------------------------
/** Recordatorio de la próxima carrera (sin IA): fecha, horarios por categoría, plazas y pilotos inscritos. */
export function textoCarrera(ctx) {
  const p = ctx.proxima;
  if (!p) return null;
  const lineas = [`Próxima carrera: la ${p.ronda}, el ${p.fecha_texto} en ${p.circuito}.`];
  for (const c of p.categorias) {
    const horas = c.hora_llegada ? `llegada a las ${c.hora_llegada}${c.hora_briefing ? `, briefing a las ${c.hora_briefing}` : ''}` : 'horario por confirmar';
    const libres = c.libres === 1 ? 'queda 1 plaza' : `quedan ${c.libres} plazas`;
    lineas.push(`${c.categoria}: ${horas}. ${c.inscritos === 1 ? '1 inscrito' : `${c.inscritos} inscritos`}${p.inscripcion_abierta ? `, ${libres}` : ''}.`);
  }
  lineas.push(p.inscripcion_abierta
    ? `La inscripción cierra el ${p.cierre_inscripcion}: raceupkc.com/inscripcion`
    : 'La inscripción ya está cerrada.');
  for (const c of p.categorias) {
    if (c.pilotos.length) lineas.push('', `Pilotos de ${c.categoria}: ${c.pilotos.join(', ')}`.replace(/\.?$/, '.'));
  }
  return lineas.join('\n');
}

/** Texto de un artículo del reglamento ("23 bis" → "Art. 23 bis. Título. …") sacado de kb_documents (web_reglamento). */
export async function articulo(numero) {
  const doc = await uno(`SELECT contenido_md FROM kb_documents WHERE slug = 'web_reglamento' AND activo`);
  const t = doc?.contenido_md ?? '';
  const inicio = t.indexOf(`\nArt. ${numero}. `);
  if (inicio < 0) return null;
  const resto = t.slice(inicio + 1);
  const fin = resto.slice(5).search(/\nArt\. \d+[a-z ]*\. |\nTítulo [IVXL]+\.|\nAnexo [A-F]\./);
  return (fin < 0 ? resto : resto.slice(0, fin + 5)).trim().slice(0, 3000);
}

async function redactar({ instruccion, contexto, d }) {
  const { modelos, llmAnthropic } = await import('../bot/llm.js');
  const llm = d.llm ?? llmAnthropic;
  const { conversacion: modelo } = await modelos();
  const anteriores = (await publicacionesAnteriores(15)).map((x) => `${x.fecha} (${x.tipo}): ${x.texto}`).join('\n') || 'ninguna';
  const res = await llm.crear({
    model: modelo,
    max_tokens: 800,
    output_config: { effort: 'low' },
    system: SISTEMA,
    messages: [{ role: 'user', content: `<contexto>\n${JSON.stringify(contexto)}\n</contexto>\n<publicaciones_anteriores>\n${anteriores}\n</publicaciones_anteriores>\n\n${instruccion}` }],
  }, { signal: AbortSignal.timeout(40_000), uso: 'admin' });
  if (res.stop_reason === 'refusal') return null;
  const texto = limpiarTexto(res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim().replace(/^["«]|["»]$/g, ''));
  return texto || null;
}

/** Mensajes del grupo que John ha reenviado al bot (o pegado con "GRUPO: <texto>") desde `desde`. */
export async function mensajesReenviados(desde) {
  const filas = await consulta(
    `SELECT cuerpo FROM wa_messages
     WHERE autor = 'john_admin' AND direccion = 'entrada' AND created_at > $1
       AND (raw->'context'->>'forwarded' = 'true' OR raw->'context'->>'frequently_forwarded' = 'true' OR cuerpo ~* '^\\s*grupo\\s*:\\s*\\S')
     ORDER BY created_at`, [desde]);
  return filas.map((f) => String(f.cuerpo || '').replace(/^\s*grupo\s*:\s*/i, '').trim()).filter(Boolean);
}

/** ¿Es un mensaje del grupo reenviado por John? (lo usa el canal admin para no pasárselo al asistente). */
export const esReenviado = (m) => Boolean(m?.context?.forwarded || m?.context?.frequently_forwarded);

// --- Planificador ------------------------------------------------------------------------------------------------------
/**
 * Qué publicaciones tocan ahora y no están hechas. Una publicación está hecha si ya salió, si se está preparando, si se
 * dejó sin publicar porque no tocaba (sin carrera cercana) o si ha fallado 3 veces hoy.
 */
async function pendientes(ahora) {
  const { fecha, hora, dia } = madrid(ahora);
  const tocan = Object.entries(CALENDARIO_GRUPO)
    .filter(([, c]) => (!c.dias || c.dias.includes(dia)) && hora >= c.hora && hora < c.limite)
    .map(([tipo]) => tipo);
  const salida = [];
  for (const tipo of tocan) {
    const filas = await consulta(
      `SELECT estado, vista_previa LIKE '[grupo-omitido:%' AS omitida FROM wa_batches
       WHERE automatizacion = 'D3' AND ronda_id IS NULL AND (vista_previa LIKE $1 OR vista_previa LIKE $2)`,
      [`${clave(tipo, fecha)}%`, `${claveOmitida(tipo, fecha)}%`]);
    if (filas.some((f) => f.omitida || f.estado !== 'cancelado')) continue;
    if (filas.length >= 3) continue;
    salida.push(tipo);
  }
  return { fecha, tipos: salida };
}

/** Prepara el texto de una publicación. null si no toca (sin próxima carrera, sin movimiento en el grupo…). */
export async function prepararPublicacion(tipo, { ahora = new Date(), d = {} } = {}) {
  const ctx = await contextoLiga(ahora);
  if (tipo === 'carrera') {
    if (!ctx.proxima || ctx.proxima.dias_que_faltan > 45) return { nota: 'sin carrera cercana' };
    return { texto: textoCarrera(ctx) };
  }
  // Para la IA, sin la lista de nombres (no hace falta y así no los cita).
  const contexto = { ...ctx, proxima: ctx.proxima && { ...ctx.proxima, categorias: ctx.proxima.categorias.map(({ pilotos, ...c }) => c) } };
  if (tipo === 'reglamento') {
    const hechas = (await consulta(
      `SELECT count(*)::int AS n FROM wa_batches WHERE automatizacion = 'D3' AND ronda_id IS NULL AND estado = 'enviado' AND vista_previa LIKE '[grupo:reglamento:%'`))[0].n;
    const numero = ARTICULOS[hechas % ARTICULOS.length];
    const art = await articulo(numero);
    if (!art) return { nota: `no encuentro el Art. ${numero} en el reglamento` };
    const texto = await redactar({ d, contexto, instruccion: `Escribe un mensaje que recuerde este punto del reglamento a los pilotos: qué dice, en palabras sencillas y con un ejemplo de pista si ayuda. Cita el artículo (por ejemplo "Art. ${numero}"). No añadas nada que no diga el texto.\n<articulo>\n${art}\n</articulo>` });
    return texto ? { texto, articulo: numero } : { nota: 'Claude no ha devuelto texto' };
  }
  if (tipo === 'tarde') {
    const grupo = await mensajesReenviados(inicioDelDia(madrid(ahora).fecha));
    if (!grupo.length) return { nota: 'sin movimiento en el grupo' };
    const texto = await redactar({ d, contexto, instruccion: `Esto es lo último que se ha hablado hoy en el grupo (mensajes reenviados por el equipo):\n<grupo>\n${grupo.slice(-30).join('\n')}\n</grupo>\nEscribe un comentario que siga esa conversación: reacciona a lo que han dicho y, si encaja, lanza una pregunta para que sigan hablando. Si la conversación es de un tema delicado (una queja, un problema de pago, un conflicto), no lo comentes: escribe en su lugar un mensaje neutro para animar el grupo.` });
    return texto ? { texto, mensajes: grupo.length } : { nota: 'Claude no ha devuelto texto' };
  }
  // diario
  const n = (await consulta(
    `SELECT count(*)::int AS n FROM wa_batches WHERE automatizacion = 'D3' AND ronda_id IS NULL AND estado = 'enviado' AND vista_previa LIKE '[grupo:diario:%'`))[0].n;
  const tipoDia = TIPOS_DIARIO[n % TIPOS_DIARIO.length];
  const faltan = ctx.proxima?.dias_que_faltan;
  const momento = faltan == null ? 'No hay ninguna carrera programada pronto.'
    : faltan === 0 ? 'Hoy es día de carrera.'
      : faltan <= 7 ? `Quedan ${faltan} días para la próxima carrera: el mensaje puede ir sobre la preparación.`
        : `Quedan ${faltan} días para la próxima carrera.`;
  const texto = await redactar({ d, contexto, instruccion: `Escribe el mensaje del día para el grupo. Hoy toca: ${tipoDia}. ${momento}` });
  return texto ? { texto, tipo_dia: tipoDia } : { nota: 'Claude no ha devuelto texto' };
}

/**
 * Cron (/api/wa/programador, cada 5 minutos): prepara lo que toque y se lo manda a John. d: { ahora, llm, enviar }.
 * Nunca lanza.
 */
export async function planificarGrupo(d = {}) {
  try {
    if (!(await activo())) return { nota: 'grupo en pausa' };
    const ahora = d.ahora ?? new Date();
    const { fecha, tipos } = await pendientes(ahora);
    const salida = [];
    const { enviarAJohn } = await import('./entrante.js');
    for (const tipo of tipos) {
      // Comentario de la tarde: sin mensajes del grupo reenviados hoy no hay nada que hacer (se vuelve a mirar en la
      // siguiente pasada, hasta las 21:00, por si John reenvía algo más tarde).
      if (tipo === 'tarde' && !(await mensajesReenviados(inicioDelDia(fecha))).length) continue;
      // Se reserva antes de preparar (estado confirmado), para que dos pasadas seguidas no lo hagan dos veces.
      const fila = await uno(
        `INSERT INTO wa_batches (automatizacion, num_destinatarios, vista_previa, estado) VALUES ('D3', 0, $1, 'confirmado') RETURNING id`,
        [clave(tipo, fecha)]);
      let res;
      try {
        res = await prepararPublicacion(tipo, { ahora, d });
      } catch (e) {
        res = { nota: `error: ${e.message}`, fallo: true };
      }
      if (!res.texto) {
        // Un fallo (Claude, reglamento) se reintenta en la siguiente pasada, hasta 3 veces. Si no tocaba publicar (sin
        // carrera cercana), queda como omitida: no cuenta para la rotación ni para las publicaciones anteriores.
        const fallo = res.fallo || /Claude no|no encuentro/.test(res.nota ?? '');
        await consulta(`UPDATE wa_batches SET estado = $2, vista_previa = $3 WHERE id = $1`,
          [fila.id, fallo ? 'cancelado' : 'enviado', fallo ? `${clave(tipo, fecha)} (${res.nota})` : `${claveOmitida(tipo, fecha)} ${res.nota}`]);
        salida.push({ tipo, nota: res.nota });
        continue;
      }
      await consulta(`UPDATE wa_batches SET estado = 'enviado', vista_previa = $2 WHERE id = $1`, [fila.id, `${clave(tipo, fecha)} ${res.texto}`]);
      const titulo = CALENDARIO_GRUPO[tipo].titulo;
      await enviarAJohn({ texto: `Para el grupo de pilotos, ${titulo}${res.articulo ? ` (Art. ${res.articulo})` : ''}. Copia el mensaje siguiente y pégalo en el grupo:`, automatizacion: 'D3', d });
      await enviarAJohn({ texto: res.texto, automatizacion: 'D3', avisar: false, d });
      salida.push({ tipo, enviado: true });
    }
    return { grupo: salida };
  } catch (e) {
    console.error('grupo', e.message);
    return { error: e.message };
  }
}
