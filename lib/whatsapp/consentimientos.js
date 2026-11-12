// Consentimientos del formulario de inscripción v2 (fase 2; FORM_V2), en wa_consents con su versión de texto:
// - operativo: el aviso (no es casilla) "Te escribiremos por WhatsApp para confirmar tu plaza y avisarte de tu ronda.
//   Responde BAJA para dejar de recibirlos." Se registra como informado al enviar el formulario.
// - comercial: solo si se marca la casilla opcional "Quiero que RUKC me avise por WhatsApp de próximas rondas y novedades."
// Si el piloto es menor, las casillas las marca el tutor (otorgado_por = tutor). Nunca lanza.
import { consulta } from '../db.js';
import { asegurarContacto } from './entrante.js';
import { TEXTOS_FORMULARIO_V2 } from './textos-formulario.js';

export { AVISO_WHATSAPP, CASILLA_NOVEDADES, TEXTOS_FORMULARIO_V2 } from './textos-formulario.js';

/** Registra los consentimientos de una solicitud enviada con el formulario v2 (una vez por solicitud y tipo). */
export async function registrarConsentimientosFormulario(s) {
  try {
    if (!s?.pagador_telefono) return { nota: 'sin teléfono' };
    const contacto = await asegurarContacto(s.pagador_telefono, s.pagador_nombre ?? null, false);
    const otorgadoPor = s.piloto_menor ? 'tutor' : 'titular';
    const evidencia = `solicitud ${s.codigo}`;
    const tipos = ['operativo', ...(s.acepta_whatsapp_novedades ? ['comercial'] : [])];
    const creados = [];
    for (const tipo of tipos) {
      const [ya] = await consulta(
        `SELECT 1 FROM wa_consents WHERE contact_id = $1 AND tipo = $2 AND accion = 'otorga' AND evidencia = $3 AND texto_version = $4`,
        [contacto.id, tipo, evidencia, TEXTOS_FORMULARIO_V2]);
      if (ya) continue;
      await consulta(
        `INSERT INTO wa_consents (contact_id, tipo, accion, fuente, otorgado_por, texto_version, evidencia)
         VALUES ($1, $2, 'otorga', 'formulario_web', $3, $4, $5)`,
        [contacto.id, tipo, otorgadoPor, TEXTOS_FORMULARIO_V2, evidencia]);
      creados.push(tipo);
    }
    return { creados };
  } catch (e) {
    console.error('consentimientos formulario', e.message);
    return { error: e.message };
  }
}
