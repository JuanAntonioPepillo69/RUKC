// Plantillas de WhatsApp aprobadas por Meta (especificación, sección 3e). En español (es), sin emojis.
// Cada una declara cuántas variables lleva su cuerpo y qué botón URL tiene (con su variable de sufijo).
// En la fase 1 no se envía ninguna plantilla: el bot solo responde con texto libre dentro de la ventana de 24 h.
// Las usarán la fase 2 (B1, B4, aviso a John) y la fase 3 (recordatorios y feedback).

export const PLANTILLAS = {
  rukc_reserva_confirmada:       { categoria: 'utility',   variables: 6, boton_url: true },
  rukc_reserva_confirmada_tutor: { categoria: 'utility',   variables: 7, boton_url: true },
  rukc_recordatorio_semana:      { categoria: 'utility',   variables: 6, respuestas_rapidas: ['Confirmo asistencia', 'Necesito hablar'] },
  rukc_recordatorio_manana:      { categoria: 'utility',   variables: 7 },
  rukc_feedback_ronda:           { categoria: 'utility',   variables: 2, boton_url: true },
  rukc_bizum_pendiente:          { categoria: 'utility',   variables: 3 },
  rukc_seguimiento_reserva:      { categoria: 'marketing', variables: 4, boton_url: true },
  rukc_nueva_ronda:              { categoria: 'marketing', variables: 5 },
  rukc_aviso_admin:              { categoria: 'utility',   variables: 2 },
  rukc_cambio_ronda:             { categoria: 'utility',   variables: 4 },
  rukc_ficha_piloto:             { categoria: 'utility',   variables: 2, boton_url: true },   // https://raceupkc.com/ficha/{{1}}
  // Imágenes semanales de inscritos, solo a John (lib/inscritos/envio.js). Cabecera de imagen; ver docs/inscritos.md.
  rukc_inscritos_semana:         { categoria: 'utility',   variables: 4, cabecera_imagen: true },
};

export const IDIOMA = 'es';

/**
 * Objeto `template` para el envío de YCloud a partir del nombre, las variables del cuerpo (en orden) y, si la
 * plantilla tiene botón URL, el sufijo de ese botón; si tiene cabecera de imagen, su enlace. Lanza un error si el número
 * de variables no cuadra.
 */
export function construirPlantilla(nombre, variables = [], { sufijoBoton, imagenCabecera } = {}) {
  const def = PLANTILLAS[nombre];
  if (!def) throw new Error(`Plantilla desconocida: ${nombre}`);
  if (variables.length !== def.variables) {
    throw new Error(`La plantilla ${nombre} lleva ${def.variables} variables y se han dado ${variables.length}.`);
  }
  if (variables.some((v) => v == null || String(v).trim() === '')) throw new Error(`Variable vacía en ${nombre}.`);
  const components = [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: String(v) })) }];
  if (def.cabecera_imagen) {
    if (!imagenCabecera) throw new Error(`La plantilla ${nombre} necesita el enlace de la imagen de cabecera.`);
    components.unshift({ type: 'header', parameters: [{ type: 'image', image: { link: String(imagenCabecera) } }] });
  }
  if (def.boton_url) {
    if (!sufijoBoton) throw new Error(`La plantilla ${nombre} necesita el sufijo del botón.`);
    components.push({ type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: String(sufijoBoton) }] });
  }
  return { name: nombre, language: { code: IDIOMA }, components };
}

// Cuerpos aprobados (especificación 3e), con las variables en su orden. Sirven para enseñarle a John un ejemplo real en
// las propuestas (programador.js) y para que el bot sepa qué recibió el contacto: en el historial ve el texto, no solo
// el nombre de la plantilla (el 15/11 no sabía que el recordatorio de una semana pedía avisar de cambios).
export const CUERPOS = {
  rukc_reserva_confirmada: (v) => `Qué tal, ${v[0]}. Tu plaza para la ${v[1]} de RUKC está reservada: ${v[2]} en ${v[3]}.\nEl resto de la inscripción, ${v[4]} €, se paga en el circuito el día de la carrera.\nAntes de correr, échale un ojo al reglamento y a la formación: ${v[5]}\nUnos días antes te recordaremos la hora de llegada. Cualquier duda, escríbenos por aquí.\n[Botón: Unirme al grupo]`,
  rukc_reserva_confirmada_tutor: (v) => `Qué tal, ${v[0]}. La plaza de ${v[1]} para la ${v[2]} de RUKC está reservada: ${v[3]} en ${v[4]}.\nEl resto de la inscripción, ${v[5]} €, se paga en el circuito el día de la carrera.\nAntes de correr, échale un ojo al reglamento y a la formación: ${v[6]}\n[Botón: Unirme al grupo]`,
  rukc_recordatorio_semana: (v) => `Hola, ${v[0]}. Queda una semana para la ${v[1]} de RUKC: ${v[2]} en ${v[3]}.\nHay que estar en el circuito a las ${v[4]} para la acreditación y el pesaje. El resto de la inscripción, ${v[5]} €, se paga allí.\nSi hay algún cambio, avísanos respondiendo a este mensaje.\n[Botones: Confirmo asistencia · Necesito hablar]`,
  rukc_recordatorio_manana: (v) => `Hola, ${v[0]}. Mañana es la ${v[1]} de RUKC en ${v[2]}.\nLlegada a las ${v[3]} para la acreditación y el pesaje; el briefing empieza a las ${v[4]}.\nCómo llegar: ${v[5]}\nRecuerda el pago restante de ${v[6]} €. Nos vemos en pista.`,
  rukc_feedback_ronda: (v) => `Hola, ${v[0]}. Gracias por correr la ${v[1]} de RUKC.\nQueremos que cada ronda salga mejor que la anterior. ¿Nos cuentas qué tal fue? Es un formulario corto.\n[Botón: Dar mi opinión]`,
  rukc_bizum_pendiente: (v) => `Hola, ${v[0]}. Tu reserva para la ${v[1]} de RUKC está pendiente del Bizum de 30 €. Si ya lo hiciste, mándanos el justificante por aquí y te confirmamos la plaza. También puedes pagar con tarjeta desde este enlace: ${v[2]}`,
  rukc_seguimiento_reserva: (v) => `Qué tal, ${v[0]}. Vimos que empezaste la reserva para la ${v[1]} de RUKC (${v[2]}, ${v[3]}) y no llegó a completarse.\n¿Te surgió alguna duda? Responde por aquí y te ayudamos, o termina la reserva cuando quieras.\n[Botón: Terminar la reserva]`,
  rukc_ficha_piloto: (v) => `Hola, ${v[0]}. Para correr la ${v[1]} de RUKC falta completar la ficha de piloto: datos, contacto de emergencia y autorizaciones. Son unos minutos y es obligatoria para correr.\n[Botón: Completar mi ficha]`,
  rukc_nueva_ronda: (v) => `Qué tal, ${v[0]}. La próxima ronda de RUKC es la ${v[1]}: ${v[2]} en ${v[3]}.\nKarts sorteados, lastre y categorías por peso: aquí gana el que mejor conduce. La inscripción cierra el ${v[4]}.\n¿Te guardamos sitio?\n[Botones: Reservar plaza · Tengo dudas]`,
};

/** Texto de una plantilla ya enviada (cuerpo = components guardados en wa_messages), para el historial del bot. */
export function textoPlantilla(nombre, cuerpo) {
  let variables = [];
  try {
    const comps = typeof cuerpo === 'string' ? JSON.parse(cuerpo) : cuerpo;
    variables = (comps ?? []).find((c) => c.type === 'body')?.parameters?.map((p) => p.text) ?? [];
  } catch { /* cuerpo sin JSON: solo el nombre */ }
  const fn = CUERPOS[nombre];
  return fn && variables.length >= (PLANTILLAS[nombre]?.variables ?? 0) ? fn(variables) : `[Plantilla enviada: ${nombre}]`;
}
