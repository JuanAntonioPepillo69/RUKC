// Preguntas frecuentes (/preguntas-frecuentes; las DESTACADAS, también en la portada). Salen de lo que más preguntaron los pilotos por WhatsApp del 12 al
// 18/11/2026 y se contestan con la base de conocimiento del bot (docs/kb) y el reglamento. Decisiones de John del
// 18/11: el dorsal es tuyo toda la temporada aunque dejes de correr; con la ficha completada no hace falta llevar el
// documento de riesgos en papel; la lista de espera va por WhatsApp y por orden de llegada. Del 18/11, además: basta con
// haber llevado un kart alguna vez; unas 3 horas en el circuito y unos 30-35 minutos en pista; karts de 4 tiempos, los
// habituales de cada circuito; el público entra gratis; precio de la temporada completa publicado; la cancelación no
// promete crédito (lo que manda son las condiciones de la reserva).
// Las respuestas son HTML (solo enlaces y <strong>); para los datos estructurados de Google se quitan las etiquetas.
import { BIZUM, RESERVA, TEMPORADA_COMPLETA as TC } from './reserva.js';

const resto = RESERVA.precioCarrera - RESERVA.importe;
const bizum = BIZUM.numero ? `por Bizum al ${BIZUM.numero}` : 'por Bizum';
const fechaHasta = new Date(`${TC.hasta}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
const temporada = `La temporada completa también se puede reservar, por WhatsApp: su precio baja a medida que pasan rondas. Hasta el ${fechaHasta}, las ${TC.rondas} rondas que quedan cuestan ${TC.precio} €.`;

/** Las que salen también en la portada: dudas que frenan antes de apuntarse y que no contesta Cómo funciona. */
export const DESTACADAS = ['¿Necesito experiencia?', '¿Qué karts se usan?', '¿Puede venir gente a verme?', '¿Hay edad mínima?', 'No puedo ir, ¿pierdo la reserva? ¿Puedo cederla?'];

export const PREGUNTAS = [
  {
    bloque: 'Antes de apuntarte',
    preguntas: [
      {
        p: '¿Necesito experiencia?',
        r: 'No hace falta haber competido nunca. Lo que sí pedimos es que hayas llevado un kart al menos una vez, porque en la carrera vas a rodar junto a otros pilotos. Si nunca te has subido a uno, haz antes una tanda en cualquier circuito.',
      },
      {
        p: '¿Qué karts se usan?',
        r: 'Siempre de 4 tiempos y, normalmente, el kart de alquiler habitual de cada circuito: ni el más básico ni el de competición. El modelo cambia según el circuito, pero en cada carrera todos corréis con el mismo tipo de kart, asignado por sorteo.',
      },
      {
        p: '¿Cuánto dura una carrera?',
        r: 'Unas 3 horas en el circuito, del briefing al podio, y unos 30 a 35 minutos en pista entre entrenamiento, clasificación y final. Llega al menos una hora antes del briefing para la acreditación y el pesaje.',
      },
      {
        p: '¿Puede venir gente a verme?',
        r: 'Sí, y es gratis en todos los circuitos. Familia y amigos son bienvenidos.',
      },
    ],
  },
  {
    bloque: 'Reserva y pago',
    preguntas: [
      {
        p: '¿Cuánto cuesta y cómo se paga?',
        r: `Cada ronda cuesta ${RESERVA.precioCarrera} €. Reservas tu plaza en la web con ${RESERVA.importe} €, con tarjeta o Bizum, y se descuentan del precio. Los ${resto} € restantes se pagan en el circuito el día de la carrera, en efectivo si puedes. Si no, ${bizum} como tarde el día anterior, mandando el justificante por WhatsApp. ${temporada}`,
      },
      {
        p: 'He pagado por Bizum, ¿ya tengo la plaza?',
        r: `Con Bizum, la plaza queda reservada cuando comprobamos que ha llegado. Envíalo al ${BIZUM.numero || 'número que indica la web'}: es el número de RUKC, aunque en tu móvil salga con otro nombre. Después mándanos la captura por WhatsApp y te llega la confirmación de plaza por ahí. Con tarjeta, la confirmación es inmediata. Si rellenaste el formulario dos veces, no te preocupes: solo cuenta una reserva.`,
      },
      {
        p: '¿Hasta cuándo me puedo inscribir? ¿Y si está completo?',
        r: 'La inscripción de cada ronda cierra el martes anterior a la carrera, o antes si se llenan las plazas de tu categoría. Si tu categoría está completa o cerrada, apúntate a la lista de espera escribiéndonos por WhatsApp: si se libera una plaza, avisamos por orden de llegada y tienes un plazo para reservarla.',
      },
    ],
  },
  {
    bloque: 'Antes de la carrera',
    preguntas: [
      {
        p: 'Ya me inscribí, ¿por qué tengo que rellenar la ficha de piloto?',
        r: 'La inscripción reserva tu plaza. La ficha de piloto se rellena una vez por temporada: tus datos, un contacto de emergencia, tu dorsal y las autorizaciones, entre ellas la asunción de riesgos. Es obligatoria para correr. El enlace te llega por WhatsApp después de reservar; si no lo encuentras o no te deja rellenarla, escríbenos y te lo mandamos.',
      },
      {
        p: '¿Tengo que llevar firmado el documento de riesgos?',
        r: 'No. La asunción de riesgos se acepta en la ficha de piloto. Con la ficha completada, el día de la carrera solo necesitas tu documento de identidad.',
      },
      {
        p: '¿Me puedo quedar el mismo dorsal toda la temporada?',
        r: 'Sí. El dorsal que eliges en tu primera ronda es tuyo toda la temporada, aunque dejes de correr alguna ronda. Nadie más lo puede coger.',
      },
      {
        p: '¿Cómo entro en el grupo de pilotos?',
        r: 'En la confirmación de plaza que te llega por WhatsApp tienes el botón «Unirme al grupo». El grupo es solo para pilotos con plaza y cada solicitud la aprueba el equipo, así que puede tardar un poco. Si pasa un día y sigue pendiente, escríbenos.',
      },
    ],
  },
  {
    bloque: 'El día de la carrera',
    preguntas: [
      {
        p: '¿A qué hora tengo que llegar?',
        r: 'Depende de la ronda y de tu categoría: Ligeros y Pesados pueden tener horas distintas. Te mandamos la hora exacta por WhatsApp una semana antes y la víspera. La acreditación y el pesaje son al menos una hora antes del briefing, que empieza a su hora y no espera a nadie.',
      },
      {
        p: '¿Qué tengo que llevar?',
        r: `Ropa cómoda y calzado cerrado, sin prendas sueltas, y el pelo largo recogido. El casco lo pone el circuito; mono y guantes son opcionales. Trae tu documento de identidad y los ${resto} € restantes en efectivo. Si corres en Ligeros y tienes lastre propio, tráelo: nos ayuda mucho.`,
      },
      {
        p: 'Peso poco, ¿cómo funciona el lastre?',
        r: 'Ligeros corre con un mínimo de 70 kg y Pesados con 85 kg. Se pesa con la ropa y el calzado con los que vas a correr, más 1,5 kg fijos por el casco. Lo que falte se completa con lastre: cinturón de plomo a la altura de la cadera o bolsillos cerrados, como máximo 10 kg sobre el cuerpo. La organización pone hasta 2 kg; si necesitas más, te avisamos para que traigas el tuyo. Si dudas de tu categoría, pregúntanos.',
      },
      {
        p: '¿Hay edad mínima?',
        r: 'La pone cada circuito: en la mayoría es de 16 años. Un menor solo puede correr si demuestra experiencia en ese circuito; lo inscribe su padre, madre o tutor, que tiene que estar presente todo el evento.',
      },
    ],
  },
  {
    bloque: 'Cambios',
    preguntas: [
      {
        p: 'No puedo ir, ¿pierdo la reserva? ¿Puedo cederla?',
        r: 'La reserva no se devuelve, como dicen las <a href="/condiciones-reserva">condiciones de la reserva</a>. Lo que sí puedes hacer es ceder tu plaza a otro piloto, avisándonos hasta 48 horas antes: él rellena la inscripción y su ficha. Si sabes que no puedes ir, escríbenos por WhatsApp cuanto antes.',
      },
      {
        p: '¿Cuándo es la próxima ronda?',
        r: 'Tienes el calendario completo de la temporada, con fechas y circuitos, en la <a href="/season-2">página de la Temporada 2</a>. Ahí también están los resultados y la clasificación de cada categoría.',
      },
    ],
  },
];

/** Texto plano de una respuesta (sin etiquetas), para los datos estructurados. */
export const textoPlano = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
