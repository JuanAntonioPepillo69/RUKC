// Tipos de escalado. En los que silencian, John toma la conversación y el bot deja de contestar (24 h o hasta REANUDA).
// En el resto, el bot avisa a John y sigue contestando las demás dudas sin tocar ese tema. Decisión de John
// (2026-11-12): devoluciones, pagos, descuentos y similares no dejan al contacto sin respuesta para lo demás.
export const TIPOS_ESCALADO = ['devolucion_o_cambio', 'descuento_o_a_medida', 'pago', 'categoria_o_peso', 'dato_no_encontrado',
  'colaboracion', 'hablar_con_persona', 'conflicto', 'urgencia', 'menor_sin_tutor', 'fallo_tecnico', 'otro'];
export const TIPOS_QUE_SILENCIAN = ['hablar_con_persona', 'conflicto', 'urgencia', 'menor_sin_tutor'];
export const silencia = ({ tipo, urgencia } = {}) => TIPOS_QUE_SILENCIAN.includes(tipo) || urgencia === 'alta';
