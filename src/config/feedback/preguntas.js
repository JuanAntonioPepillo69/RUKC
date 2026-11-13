// Banco de preguntas del feedback anónimo post-carrera (/feedback/<ronda>). Solo estructura: los textos van en
// textos.es.js, por id de pregunta. La configuración de cada ronda (fechas, módulo rotativo...) va en rondas.js.
//
// Si cambias preguntas u opciones, sube BANCO_VERSION: form_version = `${BANCO_VERSION}-${módulo}` (p. ej. "1-M1")
// queda guardado con cada respuesta y dice con qué preguntas se respondió.
//
// Pregunta:
//   tipo       unica · multiple · escala · texto. Todas son obligatorias menos las de texto (y las automáticas).
//   opciones   claves de las opciones (se guardan estas claves; el texto sale del diccionario).
//   aleatorio  las opciones se muestran en orden aleatorio, salvo las de alFinal, que van al final en el orden escrito.
//   alFinal    "Otro", "Nada", "Ninguno", "Me da igual".
//   exclusiva  opción que, al marcarla, desmarca las demás (y al revés).
//   max        máximo de opciones en las múltiples.
//   otro       true: la opción "otro" abre un campo de texto corto opcional, que se guarda como `<id>_otro`.
//   escala     [mínimo, máximo].
//   si         condición para mostrarla (ver motor.js). Las condiciones solo miran preguntas anteriores.
//   auto       { si, valor }: si se cumple, no se muestra y se guarda ese valor.
// Bloque: una pantalla. `si` lo muestra u oculta entero; `modulo` lo muestra solo en las rondas con ese módulo.
// En la lista de preguntas de un bloque, { id, si } añade una condición más a esa pregunta solo en ese bloque.

export const BANCO_VERSION = '1';

const SI_NO = ['si', 'no'];
const NO_SI = ['no', 'si'];
const sigue = (p, en) => ({ p, en });

export const PREGUNTAS = {
  // Bloque 1 · Segmentación
  C1: { tipo: 'unica', opciones: ['primera', 'dos_tres', 'cuatro_mas'] },
  C2: { tipo: 'unica', opciones: ['ligeros', 'pesados'] },
  C3: { tipo: 'unica', opciones: ['suelta', 'temporada'] },

  // Bloque 2 · Primera carrera
  N1: { tipo: 'unica', aleatorio: true, alFinal: ['otro'], otro: true,
    opciones: ['anuncio', 'organico', 'amigo', 'grupo', 'circuito', 'otro'] },
  N2: { tipo: 'unica', opciones: ['nunca', 'algunas', 'muchas_alquiler', 'competicion'] },
  N3: { tipo: 'multiple', max: 2, aleatorio: true, alFinal: ['nada', 'otro'], exclusiva: 'nada', otro: true,
    opciones: ['precio', 'nivel', 'nadie', 'seria', 'distancia', 'fecha', 'reserva', 'nada', 'otro'] },
  N4: { tipo: 'unica', aleatorio: true, alFinal: ['otro'], otro: true,
    opciones: ['igualdad', 'reglamento', 'liga', 'contenido', 'ambiente', 'precio', 'amigos', 'contacto', 'otro'] },
  N5: { tipo: 'unica', opciones: SI_NO },
  N5_seg: { tipo: 'texto', si: sigue('N5', ['si']) },

  // Bloque 3 · La jornada
  C4: { tipo: 'unica', opciones: NO_SI },
  C4_seg: { tipo: 'multiple', aleatorio: true, alFinal: ['otro'], otro: true, si: sigue('C4', ['si']),
    opciones: ['hora', 'pago', 'pesaje', 'ropa', 'llegar', 'formato', 'otro'] },
  C5: { tipo: 'unica', opciones: ['menos_30', 'de_30_60', 'de_1_2h', 'mas_2h'] },
  C6: { tipo: 'escala', escala: [1, 5] },
  C6_seg: { tipo: 'texto', si: { p: 'C6', max: 3 } },
  C7: { tipo: 'unica', opciones: ['no_lastre', 'no', 'poco', 'bastante'] },
  C7_seg: { tipo: 'texto', si: sigue('C7', ['bastante']) },
  C8: { tipo: 'unica', opciones: ['no_lastre', 'no', 'menos_10', 'mas_10'], auto: { si: sigue('C7', ['no_lastre']), valor: 'no_lastre' } },
  C9: { tipo: 'unica', opciones: ['si', 'a_medias', 'no'] },
  C9_seg: { tipo: 'multiple', aleatorio: true, alFinal: ['otro'], otro: true, si: sigue('C9', ['a_medias', 'no']),
    opciones: ['ruido', 'no_veia', 'rapido', 'idioma', 'tarde', 'otro'] },
  C10: { tipo: 'unica', opciones: ['todas', 'mayoria', 'pocas', 'ninguna'] },
  C11: { tipo: 'unica', opciones: ['no', 'peor', 'mejor', 'no_sabria'] },
  C11_seg: { tipo: 'texto', si: sigue('C11', ['peor', 'mejor']) },
  C12: { tipo: 'escala', escala: [1, 5] },
  C12_seg: { tipo: 'multiple', aleatorio: true, alFinal: ['otro'], otro: true, si: { p: 'C12', max: 3 },
    opciones: ['karts', 'peso', 'sorteo', 'adelantar', 'otro'] },
  C13: { tipo: 'unica', opciones: SI_NO },
  C14: { tipo: 'unica', opciones: ['si', 'no_del_todo', 'no_explicaron'], si: sigue('C13', ['si']) },
  C15: { tipo: 'unica', opciones: SI_NO },
  C15_seg: { tipo: 'texto', si: sigue('C15', ['si']) },
  C16: { tipo: 'escala', escala: [1, 5] },
  C16_seg: { tipo: 'texto', si: { p: 'C16', max: 3 } },
  C17: { tipo: 'unica', opciones: NO_SI },
  C17_seg: { tipo: 'multiple', otro: true, si: sigue('C17', ['si']),
    opciones: ['al_llegar', 'pesaje', 'entre_tandas', 'resultados', 'podio', 'otro'] },
  C18: { tipo: 'unica', opciones: ['si', 'no', 'no_sabia'] },
  C19: { tipo: 'unica', opciones: ['poco', 'justo', 'demasiado'] },
  C20: { tipo: 'escala', escala: [1, 5] },
  C20_seg: { tipo: 'multiple', aleatorio: true, alFinal: ['otro'], otro: true, si: { p: 'C20', max: 3 },
    opciones: ['karts', 'banos', 'bar', 'personal', 'espera', 'otro'] },
  C21: { tipo: 'unica', opciones: SI_NO },
  C21_seg: { tipo: 'multiple', aleatorio: true, alFinal: ['otro'], otro: true, si: sigue('C21', ['no']),
    opciones: ['largo', 'otro_plan', 'no_sabia', 'no_interesaba', 'otro'] },

  // Módulo rotativo M1 · Formación
  'M1.1': { tipo: 'unica', opciones: ['si', 'no', 'no_recuerdo'] },
  'M1.2': { tipo: 'unica', opciones: ['no_afecta', 'poco', 'bastante', 'no_cumplido'], si: sigue('M1.1', ['si']) },
  'M1.2_seg': { tipo: 'texto', si: sigue('M1.2', ['bastante', 'no_cumplido']) },
  'M1.3': { tipo: 'unica', opciones: ['nada', 'poco', 'bastante', 'de_lo_que_mas'], si: sigue('M1.1', ['si']) },
  'M1.4': { tipo: 'multiple', max: 3, aleatorio: true, alFinal: ['nada'], exclusiva: 'nada',
    opciones: ['banderas', 'adelantar', 'trazada', 'frenada', 'salida', 'normas', 'lastre', 'nada'] },
  'M1.5': { tipo: 'unica', aleatorio: true, alFinal: ['igual'], opciones: ['cortos', 'largo', 'directo', 'igual'] },

  // Bloque 5 · Organización y trato
  C22: { tipo: 'escala', escala: [1, 5] },
  C22_seg: { tipo: 'texto', si: { p: 'C22', max: 3 } },
  C23: { tipo: 'unica', opciones: NO_SI },
  C23_seg: { tipo: 'texto', si: sigue('C23', ['si']) },

  // Bloque 6 · Contenido de la carrera anterior
  C24: { tipo: 'unica', opciones: SI_NO },
  C24_seg: { tipo: 'multiple', aleatorio: true, alFinal: ['otro'], otro: true, si: sigue('C24', ['no']),
    opciones: ['no_sabia', 'no_aviso', 'no_interesa', 'otro'] },
  C25: { tipo: 'unica', opciones: ['varias', 'una', 'no', 'no_busque'], si: sigue('C24', ['si']) },

  // Bloque 7 · Vuelta y recomendación
  C26: { tipo: 'unica', opciones: ['apuntado', 'me_apuntare', 'no_se', 'no'] },
  C26_seg: { tipo: 'multiple', aleatorio: true, alFinal: ['otro'], otro: true, si: sigue('C26', ['no_se', 'no']),
    opciones: ['precio', 'fecha', 'circuito', 'no_disfrute', 'igualdad', 'comisarios', 'ambiente', 'personales', 'otro'] },
  C27: { tipo: 'escala', escala: [0, 10] },
  C27_seg: { tipo: 'texto', si: { p: 'C27', max: 8 } },
  C28: { tipo: 'texto' },
};

// Formación pendiente fuera de la R2: si la formación no se ha entregado y el módulo de la ronda no es M1, el bloque
// de primera carrera añade M1.1, M1.2 y M1.3.
const FORMACION_PENDIENTE = { y: [{ cfg: 'formacion_entregada', es: false }, { cfg: 'modulo', no: ['M1'] }] };

export const BLOQUES = [
  { id: 'B1', preguntas: ['C1', 'C2', 'C3'] },
  { id: 'B2', si: sigue('C1', ['primera']), preguntas: ['N1', 'N2', 'N3', 'N4', 'N5', 'N5_seg',
    { id: 'M1.1', si: FORMACION_PENDIENTE }, { id: 'M1.2', si: FORMACION_PENDIENTE }, { id: 'M1.3', si: FORMACION_PENDIENTE }] },
  { id: 'B3', preguntas: ['C4', 'C4_seg', 'C5', 'C6', 'C6_seg', 'C7', 'C7_seg', 'C8', 'C9', 'C9_seg', 'C10', 'C11', 'C11_seg',
    'C12', 'C12_seg', 'C13', 'C14', 'C15', 'C15_seg', 'C16', 'C16_seg', 'C17', 'C17_seg', 'C18', 'C19', 'C20', 'C20_seg',
    'C21', 'C21_seg'] },
  { id: 'M1', modulo: 'M1', preguntas: ['M1.1', 'M1.2', 'M1.2_seg', 'M1.3', 'M1.4', 'M1.5'] },
  { id: 'B5', preguntas: ['C22', 'C22_seg', 'C23', 'C23_seg'] },
  { id: 'B6', si: sigue('C1', ['dos_tres', 'cuatro_mas']), preguntas: ['C24', 'C24_seg', 'C25'] },
  { id: 'B7', preguntas: ['C26', 'C26_seg', 'C27', 'C27_seg', 'C28'] },
];
