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
};

export const IDIOMA = 'es';

/**
 * Objeto `template` para el envío de YCloud a partir del nombre, las variables del cuerpo (en orden) y, si la
 * plantilla tiene botón URL, el sufijo de ese botón. Lanza un error si el número de variables no cuadra.
 */
export function construirPlantilla(nombre, variables = [], { sufijoBoton } = {}) {
  const def = PLANTILLAS[nombre];
  if (!def) throw new Error(`Plantilla desconocida: ${nombre}`);
  if (variables.length !== def.variables) {
    throw new Error(`La plantilla ${nombre} lleva ${def.variables} variables y se han dado ${variables.length}.`);
  }
  if (variables.some((v) => v == null || String(v).trim() === '')) throw new Error(`Variable vacía en ${nombre}.`);
  const components = [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: String(v) })) }];
  if (def.boton_url) {
    if (!sufijoBoton) throw new Error(`La plantilla ${nombre} necesita el sufijo del botón.`);
    components.push({ type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: String(sufijoBoton) }] });
  }
  return { name: nombre, language: { code: IDIOMA }, components };
}
