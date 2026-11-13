// Textos en español del feedback anónimo, por id de pregunta (estructura en preguntas.js). Para otro idioma, copia
// este archivo (textos.en.js) con las mismas claves: la lógica no cambia.
// {proxima_ronda}, {ronda}, {abre} y {cierra} se rellenan con la configuración de la ronda (rondas.js).

export const TEXTOS = {
  ui: {
    titulo: 'Feedback de la carrera',
    intro: 'Soy John. Este formulario es para saber qué ha funcionado hoy y qué no. Lo que más me sirve es saber qué falló, aunque sea algo que hice yo. Es anónimo: no te pide el nombre y no puedo saber quién responde. Al terminar puedes apuntarte al sorteo en un formulario aparte. Entra todo el que envíe el formulario, responda lo que responda. Con lo que me contéis, publicaré en el grupo qué voy a cambiar. Son unos 5 minutos.',
    empezar: 'Empezar',
    siguiente: 'Siguiente',
    anterior: 'Atrás',
    enviar: 'Enviar respuestas',
    enviando: 'Enviando…',
    opcional: '(opcional)',
    varias: 'Puedes marcar varias.',
    maximo: 'Marca como máximo {n}.',
    otro_placeholder: 'Cuéntanos cuál',
    texto_placeholder: 'Escribe aquí si quieres',
    falta: 'Responde a esta pregunta para seguir.',
    falta_pantalla: 'Falta responder alguna pregunta de esta pantalla.',
    paso: 'Paso {n} de {total}',
    cargando: 'Cargando…',
    error_red: 'No se han podido enviar. Revisa la conexión e inténtalo de nuevo.',
    gracias_t: 'Respuestas enviadas',
    gracias: 'Gracias. Tus respuestas ya están guardadas y no van unidas a tus datos. Si quieres entrar en el sorteo, deja tu nombre y tu WhatsApp en este otro formulario:',
    ir_sorteo: 'Ir al sorteo',
    ya_respondido_t: 'Ya has respondido',
    ya_respondido: 'Ya has enviado tus respuestas de esta ronda desde este dispositivo. Gracias. Si quieres entrar en el sorteo, deja tu nombre y tu WhatsApp en este otro formulario:',
    cerrado_t: 'Formulario cerrado',
    cerrado_antes: 'El formulario de la {ronda} todavía no está abierto. Se abre el {abre}.',
    cerrado_despues: 'El formulario de la {ronda} se cerró el {cierra}. Gracias a todos los que respondisteis.',
  },

  sorteo: {
    titulo: 'Sorteo de la {ronda}',
    intro: 'Sorteo de la {ronda}. Deja tu nombre y tu WhatsApp para participar. Estos datos se guardan aparte de tus respuestas y solo sirven para el sorteo.',
    nombre: 'Nombre y apellidos',
    whatsapp: 'WhatsApp',
    whatsapp_ayuda: 'Por ejemplo, 600 11 22 33. Si no es un número español, ponlo con el prefijo (+44...).',
    privacidad_antes: 'He leído la ',
    privacidad_enlace: 'política de privacidad',
    enviar: 'Participar',
    hecho_t: 'Hecho',
    hecho: 'Ya estás dentro del sorteo. Suerte.',
    falta_nombre: 'Escribe tu nombre y apellidos.',
    falta_whatsapp: 'Revisa el número de WhatsApp.',
    falta_privacidad: 'Tienes que marcar que has leído la política de privacidad.',
  },

  bloques: {
    B1: 'Sobre ti',
    B2: 'Tu primera carrera',
    B3: 'La jornada',
    M1: 'Formación',
    B5: 'Organización y trato',
    B6: 'Tu carrera anterior',
    B7: 'Para terminar',
  },

  preguntas: {
    C1: { texto: '¿Cuántas carreras de RaceUp llevas, contando la de hoy?',
      opciones: { primera: '1, era la primera', dos_tres: '2 o 3', cuatro_mas: '4 o más' } },
    C2: { texto: '¿En qué categoría has corrido hoy?', opciones: { ligeros: 'Ligeros', pesados: 'Pesados' } },
    C3: { texto: '¿Cómo tienes la inscripción?', opciones: { suelta: 'Carrera suelta', temporada: 'Temporada completa' } },

    N1: { texto: '¿Cómo conociste RaceUp?', opciones: {
      anuncio: 'Anuncio en Instagram o Facebook', organico: 'Una publicación o vídeo de RaceUp que no era un anuncio',
      amigo: 'Un amigo o conocido que ya corría', grupo: 'Vine con un grupo de amigos que se apuntó',
      circuito: 'Lo vi en el circuito', otro: 'Otro' } },
    N2: { texto: 'Antes de hoy, ¿cuántas veces habías corrido en karts?', opciones: {
      nunca: 'Nunca o casi nunca', algunas: 'Algunas veces', muchas_alquiler: 'Muchas veces en karts de alquiler',
      competicion: 'Tengo experiencia en karting de competición' } },
    N3: { texto: 'Antes de apuntarte, ¿qué fue lo que más te hizo dudar?', opciones: {
      precio: 'El precio', nivel: 'No sabía si tendría nivel', nadie: 'No conocía a nadie',
      seria: 'No sabía si la organización era seria', distancia: 'La distancia al circuito', fecha: 'La fecha',
      reserva: 'El proceso de reserva o pago', nada: 'Nada, lo tuve claro', otro: 'Otro' } },
    N4: { texto: '¿Qué fue lo que más pesó para que te apuntaras?', opciones: {
      igualdad: 'Karts iguales y lastre', reglamento: 'Reglamento y comisarios', liga: 'Que fuera una liga con clasificación',
      contenido: 'Las fotos y los vídeos', ambiente: 'El ambiente y la gente', precio: 'El precio', amigos: 'Que venían amigos',
      contacto: 'Hablar con la organización por WhatsApp o teléfono', otro: 'Otro' } },
    N5: { texto: 'Desde que nos viste hasta que pagaste la reserva, ¿hubo algún momento en el que estuviste a punto de no apuntarte?',
      opciones: { si: 'Sí', no: 'No' } },
    N5_seg: { texto: '¿Qué pasó?' },

    C4: { texto: '¿Hubo algo que no sabías al llegar al circuito y que te habría venido bien saber antes?', opciones: { no: 'No', si: 'Sí' } },
    C4_seg: { texto: '¿Qué te habría venido bien saber?', opciones: {
      hora: 'Hora de llegada', pago: 'Cuánto quedaba por pagar', pesaje: 'Cómo funcionan el pesaje y el lastre',
      ropa: 'Qué ropa o calzado llevar', llegar: 'Cómo llegar', formato: 'Cómo es el formato del día', otro: 'Otro' } },
    C5: { texto: 'Desde que llegaste hasta que saliste a pista por primera vez, ¿cuánto tiempo estuviste esperando sin hacer nada?',
      opciones: { menos_30: 'Menos de 30 min', de_30_60: 'De 30 a 60 min', de_1_2h: 'De 1 a 2 h', mas_2h: 'Más de 2 h' } },
    C6: { texto: '¿Cómo de claro te quedó cuánto lastre te tocaba llevar?', extremos: ['Nada claro', 'Totalmente claro'] },
    C6_seg: { texto: '¿Qué no quedó claro?' },
    C7: { texto: 'Si llevaste lastre, ¿el cinturón te molestó mientras pilotabas?',
      opciones: { no_lastre: 'No llevé lastre', no: 'No', poco: 'Un poco', bastante: 'Bastante' } },
    C7_seg: { texto: '¿Qué pasó?' },
    C8: { texto: '¿Tuviste que esperar a que quedara lastre libre?',
      opciones: { no_lastre: 'No llevé lastre', no: 'No', menos_10: 'Sí, menos de 10 min', mas_10: 'Sí, más de 10 min' } },
    C9: { texto: '¿Pudiste oír y seguir el briefing sin problema?', opciones: { si: 'Sí', a_medias: 'A medias', no: 'No' } },
    C9_seg: { texto: '¿Qué lo hizo difícil?', opciones: {
      ruido: 'Había ruido', no_veia: 'No veía bien', rapido: 'Fue muy rápido', idioma: 'No entiendo bien el español',
      tarde: 'Llegué tarde', otro: 'Otro' } },
    C10: { texto: 'Al salir a pista, ¿sabías qué significaba cada bandera que podías encontrarte?',
      opciones: { todas: 'Todas', mayoria: 'La mayoría', pocas: 'Pocas', ninguna: 'Ninguna' } },
    C11: { texto: '¿Notaste en algún momento que tu kart iba claramente peor o mejor que los demás?',
      opciones: { no: 'No', peor: 'Sí, peor', mejor: 'Sí, mejor', no_sabria: 'No sabría decirlo' } },
    C11_seg: { texto: '¿En qué lo notaste? Si te acuerdas, pon el número de kart y la tanda.' },
    C12: { texto: 'En tu categoría, ¿hasta qué punto crees que el resultado lo decidió el pilotaje y no el kart o el peso?',
      extremos: ['Sobre todo el kart o el peso', 'Sobre todo el pilotaje'] },
    C12_seg: { texto: '¿Qué pesó más que el pilotaje?', opciones: {
      karts: 'Diferencias entre karts', peso: 'Diferencias de peso', sorteo: 'El sorteo de karts',
      adelantar: 'El circuito no deja adelantar', otro: 'Otro' } },
    C13: { texto: '¿Te penalizaron o te advirtieron hoy?', opciones: { si: 'Sí', no: 'No' } },
    C14: { texto: '¿Te explicaron el motivo de forma que lo entendiste?',
      opciones: { si: 'Sí', no_del_todo: 'No del todo', no_explicaron: 'No me lo explicaron' } },
    C15: { texto: '¿Viste en pista alguna acción que creas que merecía sanción y no la tuvo?', opciones: { si: 'Sí', no: 'No' } },
    C15_seg: { texto: 'Describe la jugada y la vuelta, sin nombres.' },
    C16: { texto: '¿Cómo de coherentes te parecieron hoy las decisiones de los comisarios?',
      extremos: ['La misma acción se trató distinto según el piloto', 'El mismo criterio para todos'] },
    C16_seg: { texto: '¿Qué caso concreto lo muestra?' },
    C17: { texto: '¿Hubo algún momento de la jornada en el que no sabías qué estaba pasando o qué te tocaba hacer?',
      opciones: { no: 'No', si: 'Sí' } },
    C17_seg: { texto: '¿En qué momento?', opciones: {
      al_llegar: 'Al llegar', pesaje: 'En el pesaje', entre_tandas: 'Entre tandas', resultados: 'Esperando resultados',
      podio: 'En el podio', otro: 'Otro' } },
    C18: { texto: '¿Te llegó la hoja de tiempos entre tandas?', opciones: { si: 'Sí', no: 'No', no_sabia: 'No sabía que se repartía' } },
    C19: { texto: 'El tiempo total que estuviste en pista hoy te pareció…', opciones: { poco: 'Poco', justo: 'Justo', demasiado: 'Demasiado' } },
    C20: { texto: 'Pensando solo en lo que depende del circuito (karts, instalaciones, bar y personal), ¿cómo lo valoras hoy?',
      extremos: ['Muy mal', 'Muy bien'] },
    C20_seg: { texto: '¿Qué falló?', opciones: {
      karts: 'Estado de los karts', banos: 'Baños y vestuarios', bar: 'Bar y comida', personal: 'Trato del personal del circuito',
      espera: 'Zona de espera', otro: 'Otro' } },
    C21: { texto: '¿Te quedaste hasta el final, con el podio y la foto de grupo?', opciones: { si: 'Sí', no: 'No' } },
    C21_seg: { texto: '¿Por qué no te quedaste?', opciones: {
      largo: 'Se alargó demasiado', otro_plan: 'Tenía otro plan', no_sabia: 'No sabía que había podio y foto',
      no_interesaba: 'No me interesaba', otro: 'Otro' } },

    'M1.1': { texto: 'Cuando te apuntaste, ¿te dijeron que la inscripción incluía una formación en vídeo sobre seguridad, banderas, adelantamiento, trazada y frenada?',
      opciones: { si: 'Sí', no: 'No', no_recuerdo: 'No me acuerdo' } },
    'M1.2': { texto: 'Esa formación todavía no la hemos entregado: llegará en 2027. ¿Cómo te afecta que aún no esté?', opciones: {
      no_afecta: 'No me afecta', poco: 'Me molesta un poco', bastante: 'Me molesta bastante',
      no_cumplido: 'Siento que no se cumplió lo que me vendieron' } },
    'M1.2_seg': { texto: '¿Qué te parecería justo por nuestra parte mientras tanto?' },
    'M1.3': { texto: '¿Cuánto pesó la formación en tu decisión de apuntarte?',
      opciones: { nada: 'Nada', poco: 'Poco', bastante: 'Bastante', de_lo_que_mas: 'Fue de lo que más' } },
    'M1.4': { texto: 'Antes de tu primera carrera con nosotros, ¿qué te habría venido mejor tener explicado?', opciones: {
      banderas: 'Banderas y señales', adelantar: 'Cómo adelantar sin provocar un toque', trazada: 'Trazada', frenada: 'Frenada',
      salida: 'Cómo es la salida', normas: 'Normas y penalizaciones', lastre: 'Cómo usar el lastre', nada: 'Nada, ya lo sabía' } },
    'M1.5': { texto: '¿En qué formato es más probable que la veas?', opciones: {
      cortos: 'Vídeos cortos de 3 a 5 minutos', largo: 'Un vídeo largo', directo: 'Una sesión en directo antes de la carrera',
      igual: 'Me da igual' } },

    C22: { texto: '¿Cómo de bien organizada estuvo la jornada?', extremos: ['Muy mal', 'Muy bien'] },
    C22_seg: { texto: '¿Qué fallo concreto viste?' },
    C23: { texto: '¿Hubo algún momento en el que te sentiste mal atendido por la organización?', opciones: { no: 'No', si: 'Sí' } },
    C23_seg: { texto: '¿Qué pasó?' },

    C24: { texto: '¿Has visto las fotos o el vídeo de tu última carrera con nosotros?', opciones: { si: 'Sí', no: 'No' } },
    C24_seg: { texto: '¿Por qué no?', opciones: {
      no_sabia: 'No sabía dónde estaban', no_aviso: 'No me llegó el aviso', no_interesa: 'No me interesa', otro: 'Otro' } },
    C25: { texto: '¿Saliste en alguna foto o plano en el que te reconocieras?',
      opciones: { varias: 'Sí, en varias', una: 'Sí, en una', no: 'No', no_busque: 'No lo busqué' } },

    C26: { texto: '¿Piensas correr la próxima ronda ({proxima_ronda})?', opciones: {
      apuntado: 'Sí, ya estoy apuntado', me_apuntare: 'Sí, me apuntaré', no_se: 'Todavía no lo sé', no: 'No' } },
    C26_seg: { texto: '¿Qué te frena?', opciones: {
      precio: 'El precio', fecha: 'La fecha', circuito: 'El circuito o la distancia', no_disfrute: 'No disfruté la carrera',
      igualdad: 'La igualdad', comisarios: 'Los comisarios', ambiente: 'El ambiente', personales: 'Motivos personales', otro: 'Otro' } },
    C27: { texto: 'Del 0 al 10, ¿qué probabilidad hay de que recomiendes RaceUp a un amigo al que le guste el motor?',
      extremos: ['Ninguna', 'Seguro que sí'] },
    C27_seg: { texto: '¿Qué es lo principal que te ha faltado para darnos más nota?' },
    C28: { texto: 'Si pudieras cambiar una sola cosa para la próxima carrera, ¿cuál sería?' },
  },
};

/** Rellena {clave} con los valores dados. */
export const rellenar = (texto, valores = {}) => String(texto).replace(/\{(\w+)\}/g, (m, k) => (k in valores ? String(valores[k]) : m));
