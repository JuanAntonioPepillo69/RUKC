// GET /api/checkout/estado · lo consulta la página de éxito (/inscripcion/confirmada) con el token del borrador
// (Authorization: Bearer <token>). Devuelve el estado de la solicitud y, solo si está pagada, el enlace al onboarding.
// El enlace se genera en el momento (token nuevo; en la base de datos solo queda su hash) y solo mientras el
// administrador no haya enviado ya otro por WhatsApp. Diseño: F1 paso 8.
import { conTransaccion } from '../../lib/db.js';
import { ipCliente, json, origenWeb } from '../../lib/http.js';
import { hashToken, nuevoToken, tokenDeCabecera } from '../../lib/tokens.js';

export async function GET(request) {
  const token = tokenDeCabecera(request);
  if (!token) return json({ error: 'Falta el token.' }, 401);
  try {
    const r = await conTransaccion(async (c) => {
      const { rows: [s] } = await c.query(
        `SELECT s.id, s.codigo, s.estado, s.pedido_id, s.temporada_id FROM solicitud_inscripcion s
         WHERE s.borrador_token_hash = $1`, [hashToken(token)]);
      if (!s) return null;
      if (s.estado !== 'pagada') return { estado: s.estado, codigo: s.codigo };
      const { rows: [o] } = await c.query(
        `SELECT o.id, o.estado, o.enlace_enviado_en FROM inscripcion i
         JOIN onboarding o ON o.persona_id = i.piloto_persona_id AND o.temporada_id = $2
         WHERE i.pedido_id = $1 ORDER BY i.creado_en LIMIT 1 FOR UPDATE OF o`, [s.pedido_id, s.temporada_id]);
      if (!o || o.estado === 'completado' || o.enlace_enviado_en) {
        return { estado: s.estado, codigo: s.codigo, onboarding: o?.estado ?? null, onboarding_url: null };
      }
      const nuevo = nuevoToken();
      await c.query('UPDATE onboarding SET token_hash = $2 WHERE id = $1', [o.id, hashToken(nuevo)]);
      return { estado: s.estado, codigo: s.codigo, onboarding: o.estado, onboarding_url: `${origenWeb(request)}/onboarding/${nuevo}` };
    }, { actor: 'publico', ip: ipCliente(request) });
    if (!r) return json({ error: 'No encontramos la solicitud.' }, 404);
    return json(r);
  } catch (e) {
    console.error('checkout/estado', e.message);
    return json({ error: 'No se ha podido consultar el pago.' }, 500);
  }
}
