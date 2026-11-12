// Herramientas del bot público (especificación, sección 3d). Son exactamente 9; el canal admin tendrá las suyas en
// otra lista (fase 2) y el bot público nunca las ve.
// Todas devuelven la misma forma: { status: ok | aviso | error, resumen, datos, siguiente_paso }.
// Cada herramienta recibe (entrada, ctx). ctx = { contacto, conversacionId, mensajeId, datos } donde `datos` es el
// módulo de acceso a datos (lib/bot/datos.js) o un sustituto en los tests.
import { silencia } from './escalado.js';
import { buscar } from './kb.js';

const r = (status, resumen, datos = null, siguiente_paso = null) => ({ status, resumen, datos, siguiente_paso });
const nulo = (tipo) => ({ type: [tipo, 'null'] });

const ENLACES_FIJOS = {
  reglamento: `https://raceupkc.com/reglamento`,
  condiciones: `https://raceupkc.com/condiciones-reserva`,
  privacidad: `https://raceupkc.com/privacidad`,
};

export const DEFINICIONES = [
  {
    name: 'buscar_conocimiento',
    description: 'Busca en la base de conocimiento de RUKC y en el reglamento completo. Úsala para cualquier dato de la liga, normas, puntos, banderas, sanciones, políticas o el día de carrera que no esté en <conocimiento>. Devuelve fragmentos con su slug.',
    input_schema: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Qué buscar, con palabras clave (por ejemplo "vuelta rápida puntos").' },
        categoria: { type: 'string', enum: ['todas', 'liga', 'categorias', 'precios', 'politicas', 'reglamento', 'dia_de_carrera', 'menores', 'enlaces', 'faq'], description: 'Limita la búsqueda a una categoría; "todas" si no sabes cuál.' },
      },
      required: ['consulta', 'categoria'],
      additionalProperties: false,
    },
  },
  {
    name: 'consultar_rondas',
    description: 'Rondas de la temporada con fecha, circuito, cierre de inscripción, horas de acreditación y briefing si están, y plazas libres por categoría. Úsala siempre que hables de fechas, plazas o cierres.',
    input_schema: {
      type: 'object',
      properties: { solo_abiertas: { type: 'boolean', description: 'true: solo rondas con la inscripción abierta. false: todas las de la temporada.' } },
      required: ['solo_abiertas'],
      additionalProperties: false,
    },
  },
  {
    name: 'consultar_mi_inscripcion',
    description: 'Reservas del contacto (o de su hijo o hija si es tutor) en la temporada: ronda, estado y lo que queda por pagar. Usa el teléfono del contacto; no pide nada.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'generar_enlace_reserva',
    description: 'Enlace a la página de reserva con la ronda ya marcada. Úsala cuando el contacto ha mostrado interés por una ronda concreta.',
    input_schema: {
      type: 'object',
      properties: { ronda_id: { type: 'string', description: 'ronda_id devuelto por consultar_rondas, o el número de ronda (por ejemplo "R3").' } },
      required: ['ronda_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'enviar_enlace',
    description: 'Devuelve la URL oficial de reglamento, condiciones, privacidad, formación, feedback o el grupo de pilotos. El grupo solo se da a quien tiene una plaza reservada o pagada: la herramienta lo comprueba.',
    input_schema: {
      type: 'object',
      properties: { tipo: { type: 'string', enum: ['reglamento', 'condiciones', 'privacidad', 'formacion', 'feedback', 'grupo'] } },
      required: ['tipo'],
      additionalProperties: false,
    },
  },
  {
    name: 'registrar_lead',
    description: 'Crea o actualiza la ficha del contacto como posible piloto. Úsala cuando muestre interés en correr y sepas algo útil (su nombre, qué busca, qué ronda le interesa o su experiencia). Nunca registres el peso.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { ...nulo('string'), description: 'Nombre que ha dado el contacto.' },
        interes: { ...nulo('string'), description: 'Qué busca, en pocas palabras.' },
        ronda_interes: { ...nulo('string'), description: 'Ronda que le interesa, por ejemplo "R3".' },
        experiencia: { ...nulo('string'), description: 'Experiencia en karts, en pocas palabras.' },
      },
      required: ['nombre', 'interes', 'ronda_interes', 'experiencia'],
      additionalProperties: false,
    },
  },
  {
    name: 'registrar_consentimiento_comercial',
    description: 'Registra si el contacto acepta o no que RUKC le avise por WhatsApp de próximas rondas y novedades. Solo cuando lo haya dicho expresamente en este chat.',
    input_schema: {
      type: 'object',
      properties: {
        acepta: { type: 'boolean' },
        cita: { type: 'string', description: 'Frase literal del contacto en la que lo dice.' },
      },
      required: ['acepta', 'cita'],
      additionalProperties: false,
    },
  },
  {
    name: 'registrar_baja',
    description: 'Da de baja al contacto. comercial: deja de recibir avisos de próximas rondas y novedades. total: no se le envía nada por iniciativa de RUKC (si escribe, se le sigue contestando).',
    input_schema: {
      type: 'object',
      properties: { tipo: { type: 'string', enum: ['comercial', 'total'] } },
      required: ['tipo'],
      additionalProperties: false,
    },
  },
  {
    name: 'escalar_a_john',
    description: 'Pasa un tema a John (organizador) y le avisa. Según el tipo, el bot sigue con las demás dudas o deja de contestar (el sistema lo decide). Úsala en todos los casos de <escalado>.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          enum: ['devolucion_o_cambio', 'descuento_o_a_medida', 'pago', 'categoria_o_peso', 'dato_no_encontrado', 'colaboracion',
            'hablar_con_persona', 'conflicto', 'urgencia', 'menor_sin_tutor', 'otro'],
          description: 'devolucion_o_cambio: reembolsos o cambios de ronda. descuento_o_a_medida: descuentos, precios de grupo, algo a medida. pago: un pago que no aparece o un justificante. categoria_o_peso: duda de categoría o de peso. dato_no_encontrado: no está en <conocimiento> ni en las herramientas. colaboracion: prensa, patrocinadores, circuitos. hablar_con_persona: lo pide de forma clara. conflicto: quejas, sanciones, resultados discutidos, enfados o insultos. urgencia: riesgo para la salud o la seguridad, accidentes o lesiones. menor_sin_tutor: escribe un menor sin tutor identificado.',
        },
        motivo: { type: 'string', description: 'Motivo corto, por ejemplo "pide reembolso".' },
        resumen: { type: 'string', description: 'Qué pide el contacto y qué datos ha dado, en 1 a 3 frases.' },
        urgencia: { type: 'string', enum: ['normal', 'alta'] },
      },
      required: ['tipo', 'motivo', 'resumen', 'urgencia'],
      additionalProperties: false,
    },
  },
].map((d) => ({ ...d, strict: true }));

export const NOMBRES = DEFINICIONES.map((d) => d.name);

// Búsqueda en internet (herramienta de servidor de Anthropic: se ejecuta en su lado y el resultado llega en la misma
// respuesta). Una búsqueda por turno como mucho, para el tiempo y dudas del día de carrera (ver <internet> en el prompt).
// Versión básica a propósito: la de filtrado dinámico (20260209) añade unos 5.700 tokens a cada petición y ejecuta
// código, y tardaba casi los 20 s del turno; la básica añade unos 2.500.
export const BUSQUEDA_WEB = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 1,
  user_location: { type: 'approximate', city: 'Málaga', region: 'Andalucía', country: 'ES', timezone: 'Europe/Madrid' },
};
export const HERRAMIENTAS_PUBLICAS = [...DEFINICIONES, BUSQUEDA_WEB];

const IMPLEMENTACIONES = {
  async buscar_conocimiento({ consulta, categoria }, { datos }) {
    const docs = await datos.documentosKb();
    let fragmentos = buscar(docs, consulta, { categoria: categoria && categoria !== 'todas' ? categoria : null });
    if (!fragmentos.length && categoria && categoria !== 'todas') fragmentos = buscar(docs, consulta);
    if (!fragmentos.length) {
      return r('aviso', 'No hay nada sobre eso en la base de conocimiento.', { fragmentos: [] },
        'No lo supongas: di que lo confirmas con John y usa escalar_a_john.');
    }
    return r('ok', `${fragmentos.length} fragmento(s) encontrados.`, { fragmentos });
  },

  async consultar_rondas({ solo_abiertas }, { datos }) {
    const rondas = await datos.rondas({ soloAbiertas: solo_abiertas !== false });
    if (!rondas.length) {
      return r('aviso', solo_abiertas ? 'Ahora mismo no hay rondas con la inscripción abierta.' : 'No hay rondas en la temporada.',
        { rondas: [] }, solo_abiertas ? 'Puedes consultar todas con solo_abiertas=false.' : null);
    }
    return r('ok', `${rondas.length} ronda(s).`, { rondas },
      'Fechas, cierres y plazas, tal cual salen aquí. Si una hora es null, no está publicada: no la inventes.');
  },

  async consultar_mi_inscripcion(_, { contacto, datos }) {
    const res = await datos.inscripcionesDe(contacto.phone_e164);
    if (!res.inscripciones.length && !res.bizum_pendientes.length) {
      return r('ok', 'No hay ninguna reserva asociada a este teléfono.', res,
        'Si dice que ya pagó o que reservó con otro teléfono, escala a John.');
    }
    return r('ok', `${res.inscripciones.length} inscripción(es) y ${res.bizum_pendientes.length} Bizum pendiente(s) de comprobar.`, res);
  },

  async generar_enlace_reserva({ ronda_id }, { datos }) {
    const ronda = await datos.rondaPorReferencia(ronda_id);
    if (!ronda) return r('error', 'No encuentro esa ronda.', null, 'Consulta las rondas con consultar_rondas y usa su ronda_id.');
    const url = `https://raceupkc.com/inscripcion?ronda=${ronda.numero}&utm_source=whatsapp&utm_medium=bot`;
    return r('ok', `Enlace de reserva para la R${ronda.numero}.`, { ronda: `R${ronda.numero}`, fecha: ronda.fecha, circuito: ronda.circuito, url });
  },

  async enviar_enlace({ tipo }, { contacto, datos }) {
    if (ENLACES_FIJOS[tipo]) return r('ok', `Enlace de ${tipo}.`, { url: ENLACES_FIJOS[tipo] });
    if (tipo === 'grupo') {
      if (!(await datos.tienePlaza(contacto.phone_e164))) {
        return r('aviso', 'Este contacto no tiene plaza reservada ni pagada: el enlace del grupo no se puede dar.', null,
          'Explica que el grupo es para pilotos con plaza y ofrece reservar. No des ningún enlace de grupo.');
      }
      const url = await datos.enlaceGrupo();
      if (!url) return r('aviso', 'El enlace del grupo aún no está configurado.', null, 'Di que John se lo pasa y usa escalar_a_john.');
      return r('ok', 'Enlace del grupo de pilotos.', { url });
    }
    // formacion y feedback: solo si están en la base de conocimiento.
    const docs = await datos.documentosKb();
    const patron = tipo === 'formacion' ? /formaci[oó]n[^\n]*?(https?:\/\/\S+)/i : /feedback[^\n]*?(https?:\/\/\S+)/i;
    const url = docs.map((d) => d.contenido_md.match(patron)?.[1]).find(Boolean)?.replace(/[).,]+$/, '');
    if (!url) return r('aviso', `El enlace de ${tipo} no está publicado todavía.`, null, 'No lo inventes: di que John se lo pasa y usa escalar_a_john.');
    return r('ok', `Enlace de ${tipo}.`, { url });
  },

  async registrar_lead(entrada, { contacto, datos }) {
    const limpio = Object.fromEntries(Object.entries(entrada).map(([k, v]) => [k, typeof v === 'string' ? v.trim().slice(0, 200) || null : null]));
    const res = await datos.registrarLead(contacto, limpio);
    return r('ok', res.nueva ? 'Ficha de lead creada.' : 'Ficha de lead actualizada.', null);
  },

  async registrar_consentimiento_comercial({ acepta, cita }, { contacto, mensajeId, datos }) {
    await datos.registrarConsentimiento(contacto, {
      tipo: 'comercial', accion: acepta ? 'otorga' : 'revoca', texto_version: 'whatsapp-chat-v1',
      evidencia: `${mensajeId ?? 'sin-id'} · «${String(cita).slice(0, 200)}»`,
    });
    return r('ok', acepta ? 'Consentimiento comercial registrado.' : 'Registrado que no quiere avisos comerciales.');
  },

  async registrar_baja({ tipo }, { contacto, mensajeId, datos }) {
    const res = await datos.registrarBaja(contacto, tipo === 'total' ? 'total' : 'comercial', mensajeId ?? null);
    return r('ok', `Baja ${res.baja} registrada.`, res, 'Confírmalo en una frase, sin intentar retenerle.');
  },

  async escalar_a_john({ tipo, motivo, resumen, urgencia }, ctx) {
    const urg = urgencia === 'alta' ? 'alta' : 'normal';
    const res = await ctx.datos.escalar(ctx.contacto, ctx.conversacionId, { tipo, motivo, resumen, urgencia: urg });
    const calla = res?.silencia ?? silencia({ tipo, urgencia: urg });
    const nuevo = res?.nuevo !== false;
    // Un tema ya escalado no vuelve a avisar a John (salvo los que silencian, que cortan la conversación).
    if (nuevo || calla) ctx.escalado = { tipo, motivo, resumen, urgencia: urg, silencia: calla };
    if (calla) {
      return r('ok', 'John está avisado. La conversación pasa a John y dejas de contestar.', null,
        'Díselo al contacto en una frase ("Esto lo tiene que ver John, ya se lo he pasado y te contesta él").');
    }
    return r('ok', nuevo ? 'John está avisado de este tema.' : 'Este tema ya lo tenía John; no se le vuelve a avisar.', null,
      'Di en una frase que ese tema lo ve John y te contesta él. Sigue ayudando con el resto de dudas, pero no negocies ni prometas nada de ese tema.');
  },
};

/** Ejecuta una herramienta por su nombre. Nunca lanza: los fallos vuelven como status "error". */
export async function ejecutarHerramienta(nombre, entrada, ctx) {
  const fn = IMPLEMENTACIONES[nombre];
  if (!fn) return r('error', `Herramienta desconocida: ${nombre}.`, null, 'No se puede reintentar: usa escalar_a_john.');
  try {
    return await fn(entrada ?? {}, ctx);
  } catch (e) {
    console.error('herramienta', nombre, e.message);
    return r('error', 'La herramienta ha fallado.', null, 'No reintentes: di que lo confirmas con John y usa escalar_a_john.');
  }
}
