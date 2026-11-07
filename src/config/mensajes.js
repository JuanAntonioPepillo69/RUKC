// Mensajes de WhatsApp que se preparan desde el panel. Edítalos aquí: un solo archivo para todos.
// Sin emojis. {nombre} es el nombre de pila; los enlaces y códigos los rellena el panel.
// JavaScript (no TypeScript) para que lo puedan importar las funciones de api/.

export const MENSAJES = {
  /** Lead nuevo o que hay que retomar. */
  lead: ({ nombre }) =>
    `Hola ${nombre}, soy John, de RUKC. Te escribo por tu interés en la Temporada 2. ¿Te cuento cómo funciona y te reservo plaza para la próxima ronda?`,

  /** Borrador del formulario sin terminar. */
  recuperar_borrador: ({ nombre, ronda }) =>
    `Hola ${nombre}, soy John, de RUKC. He visto que empezaste la reserva${ronda ? ` de la R${ronda}` : ''} y no llegaste a terminarla. ¿Te ayudo con algo? Puedes completarla aquí: https://raceupkc.com/inscripcion${ronda ? `?ronda=${ronda}` : ''}`,

  /** Pago que no se completó (tarjeta caducada o Bizum sin confirmar). */
  recuperar_pago: ({ nombre, ronda, codigo }) =>
    `Hola ${nombre}, soy John, de RUKC. Tu reserva ${codigo}${ronda ? ` para la R${ronda}` : ''} se quedó sin pagar. Si quieres mantener la plaza, puedes terminarla aquí: https://raceupkc.com/inscripcion${ronda ? `?ronda=${ronda}` : ''}`,

  /** Confirmación de la reserva con el enlace al onboarding. */
  confirmacion: ({ nombre, ronda, circuito, enlace }) =>
    `Hola ${nombre}, tu plaza para la R${ronda} en ${circuito} está reservada. El siguiente paso es completar tu ficha de piloto (datos, contacto de emergencia y documentos). Es obligatoria para correr: ${enlace}`,

  /** Recordatorio de lo que queda por pagar. */
  saldo_pendiente: ({ nombre, ronda, importe }) =>
    `Hola ${nombre}, te recuerdo que de la R${ronda} quedan ${importe} € por pagar. Puedes hacerlo en el circuito el día de la carrera o por Bizum. Cualquier duda, aquí estoy.`,

  /** Enlace nuevo a la ficha de piloto (onboarding). */
  onboarding: ({ nombre, enlace }) =>
    `Hola ${nombre}, soy John, de RUKC. Te dejo el enlace para completar tu ficha de piloto (datos, contacto de emergencia y documentos). Es obligatoria para correr: ${enlace}`,

  /** Recordatorio de la ficha de piloto a quien no la ha terminado (el enlace anterior deja de valer). */
  onboarding_recordatorio: ({ nombre, enlace }) =>
    `Hola ${nombre}, soy John, de RUKC. Te recuerdo que tienes pendiente tu ficha de piloto: son unos minutos y es obligatoria para correr. Te dejo el enlace otra vez: ${enlace}`,

  /** Acceso aprobado al grupo de pilotos. */
  grupo: ({ nombre, enlace }) =>
    `Hola ${nombre}, tu ficha de piloto está completa. Este es el enlace al grupo de WhatsApp de pilotos de la temporada: ${enlace}`,

  /** Feedback de una ronda celebrada. */
  feedback: ({ nombre, ronda, dias, enlace }) =>
    `Hola ${nombre}, gracias por correr la R${ronda} con RUKC. ¿Nos cuentas qué tal? Son un par de minutos y nos ayuda a mejorar la siguiente ronda. El enlace vale ${dias} días: ${enlace}`,

  /** Recordatorio del feedback (el enlace anterior deja de valer). */
  feedback_recordatorio: ({ nombre, ronda, dias, enlace }) =>
    `Hola ${nombre}, te recuerdo el feedback de la R${ronda}. Si tienes un par de minutos, nos ayuda mucho. Te dejo el enlace otra vez (vale ${dias} días más): ${enlace}`,

  /** Bizum recibido y confirmado. */
  bizum_confirmado: ({ nombre, codigo }) =>
    `Hola ${nombre}, hemos recibido tu Bizum de la reserva ${codigo}. Tu plaza queda confirmada.`,
};
