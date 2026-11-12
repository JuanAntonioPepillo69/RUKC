// POST /api/checkout · el piloto pulsa "Pagar". Token del borrador en Authorization: Bearer <token>.
// 1. Valida la solicitud guardada y comprueba el cupo: cerrado → mensaje y lista de espera; lleno pero abierto → sigue
//    (la inscripción se marcará con sobrecupo).
// 2. Pasa la solicitud a enviada con las versiones de los documentos aceptados.
// 3. Tarjeta: sesión de Stripe por el importe de reserva, caduca a los 30 min, metadatos solo con solicitud_id.
//    Bizum: número, titular, importe y código RK-XXXX; el enlace de WhatsApp lleva solo el código.
// 4. Lead a Meta solo si hay consentimiento de medición.
// Diseño: F1 paso 5 y F2 paso 2.
import { enviarEvento, userData } from '../_meta.js';
import { BIZUM } from '../../src/config/reserva.js';
import { SITE } from '../../src/config/site.js';
import { VERSIONES_WEB, fechaCorta, leerCatalogo } from '../../lib/catalogo.js';
import { conTransaccion } from '../../lib/db.js';
import { dentroDelLimite, hashIp, ipCliente, json, leerJson, origenValido, origenWeb } from '../../lib/http.js';
import { stripe } from '../../lib/stripe.js';
import { hashToken, tokenDeCabecera } from '../../lib/tokens.js';
import { faltaParaPagar, mensajeError, pedirPago } from '../../lib/validacion/solicitud.js';
import { registrarConsentimientosFormulario } from '../../lib/whatsapp/consentimientos.js';

const CADUCIDAD_S = 30 * 60 + 60;   // Stripe exige al menos 30 min; un minuto de margen

const whatsapp = (texto) => `https://wa.me/${SITE.whatsapp.number}?text=${encodeURIComponent(texto)}`;

/** Estado del cupo para la categoría elegida ('no_se': vale si alguna categoría de la ronda está abierta). */
function estadoCupo(cupos, categoria) {
  if (categoria === 'no_se') return cupos.some((c) => c.estado_inscripcion === 'abierta') ? 'abierta'
    : cupos.some((c) => c.estado_inscripcion === 'lista_espera') ? 'lista_espera' : 'cerrada';
  return cupos.find((c) => c.codigo === categoria)?.estado_inscripcion ?? 'cerrada';
}

/** Parámetros de la sesión de Checkout. Ningún dato personal en los metadatos: solo solicitud_id. */
export function parametrosSesion(s, origen, ahora = Date.now()) {
  return new URLSearchParams({
    mode: 'payment',
    locale: 'es',
    customer_email: s.pagador_email,
    client_reference_id: s.id,
    expires_at: String(Math.floor(ahora / 1000) + CADUCIDAD_S),
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(s.importe_reserva_cent),
    'line_items[0][price_data][product_data][name]': `Reserva de plaza · R${s.ronda_numero} ${s.circuito} (${fechaCorta(s.ronda_fecha)})`,
    'line_items[0][price_data][product_data][description]': 'Se descuenta del precio de la carrera. Condiciones en raceupkc.com/condiciones-reserva',
    'payment_intent_data[description]': `Reserva ${s.codigo}`,
    'metadata[solicitud_id]': s.id,
    'payment_intent_data[metadata][solicitud_id]': s.id,
    success_url: `${origen}/inscripcion/confirmada`,
    cancel_url: `${origen}/inscripcion?cancelado=1`,
  });
}

async function enviarLead(s, request) {
  if (!s.consentimiento_medicion || !process.env.META_CAPI_TOKEN) return;
  try {
    await enviarEvento({
      event_name: 'Lead',
      event_time: Math.floor(Date.now() / 1000),
      event_id: `lead_${s.id}`,
      action_source: 'website',
      event_source_url: 'https://raceupkc.com/inscripcion',
      user_data: userData({ email: s.pagador_email, telefono: s.pagador_telefono, ip: ipCliente(request),
        ua: request.headers.get('user-agent'), fbp: s.fbp, fbc: s.fbc }),
      custom_data: { content_name: 'Reserva T2', ronda: `R${s.ronda_numero}`, metodo: s.metodo_elegido },
    });
  } catch (e) {
    console.error('Lead Meta', e.message);
  }
}

export async function POST(request) {
  if (!origenValido(request)) return json({ error: 'Origen no permitido.' }, 403);
  const token = tokenDeCabecera(request);
  if (!token) return json({ error: 'Falta el borrador. Recarga la página.' }, 401);
  const cuerpo = pedirPago.safeParse(await leerJson(request));
  if (!cuerpo.success) return json({ error: mensajeError(cuerpo.error) }, 400);
  if (cuerpo.data.sitio_web) return json({ error: 'No se ha podido abrir el pago.' }, 400);
  const { metodo } = cuerpo.data;
  if (metodo === 'bizum' && !BIZUM.numero) return json({ error: 'El pago por Bizum no está disponible.' }, 400);

  let s;
  try {
    s = await conTransaccion(async (c) => {
      if (!(await dentroDelLimite(c, request, 'checkout'))) return { limite: true };
      const { rows: [sol] } = await c.query(
        `SELECT s.*, t.importe_reserva_cent, r.numero AS ronda_numero, r.fecha::text AS ronda_fecha, r.estado AS ronda_estado,
           ci.nombre AS circuito,
           (SELECT a.fbc FROM atribucion a WHERE a.solicitud_id = s.id AND a.fbc IS NOT NULL ORDER BY a.capturada_en DESC LIMIT 1) AS fbc,
           (SELECT a.fbp FROM atribucion a WHERE a.solicitud_id = s.id AND a.fbp IS NOT NULL ORDER BY a.capturada_en DESC LIMIT 1) AS fbp
         FROM solicitud_inscripcion s
         JOIN temporada t ON t.id = s.temporada_id
         LEFT JOIN ronda r ON r.id = s.ronda_id
         LEFT JOIN circuito ci ON ci.id = r.circuito_id
         WHERE s.borrador_token_hash = $1 FOR UPDATE OF s`, [hashToken(token)]);
      if (!sol) return { noExiste: true };
      if (sol.estado === 'pagada') return { pagada: true };
      if (!['borrador', 'enviada', 'pago_abandonado'].includes(sol.estado)) return { cerradaSolicitud: true };
      const falta = faltaParaPagar(sol);
      if (falta) return { falta };
      if (!['programada', 'aplazada'].includes(sol.ronda_estado)) return { falta: 'Esa ronda ya no admite inscripciones. Elige otra.' };

      const { rows: cupos } = await c.query(
        `SELECT cat.codigo, cr.estado_inscripcion FROM cupo_ronda cr JOIN categoria cat ON cat.id = cr.categoria_id
         WHERE cr.ronda_id = $1`, [sol.ronda_id]);
      const cupo = estadoCupo(cupos, sol.categoria_elegida);
      if (cupo !== 'abierta') return { cupo, sol };

      const versiones = (await leerCatalogo((t, p) => c.query(t, p).then((r) => r.rows)))?.documentos ?? VERSIONES_WEB;
      await c.query(
        `UPDATE solicitud_inscripcion
         SET metodo_elegido = $2, acepta_documentos = $3,
             estado = CASE WHEN estado = 'enviada' THEN estado ELSE 'enviada' END
         WHERE id = $1`,
        [sol.id, metodo, { ...versiones, aceptado_en: new Date().toISOString(), ip_hash: hashIp(ipCliente(request)) }]);
      return { sol: { ...sol, metodo_elegido: metodo } };
    }, { actor: 'publico', ip: ipCliente(request) });
  } catch (e) {
    console.error('checkout', e.message);
    return json({ error: 'No se ha podido preparar el pago. Inténtalo de nuevo en un momento.' }, 500);
  }

  if (s.limite) return json({ error: 'Demasiadas peticiones. Espera unos minutos.' }, 429);
  if (s.noExiste) return json({ error: 'No encontramos tu solicitud. Recarga la página.' }, 404);
  if (s.pagada) return json({ estado: 'pagada', error: 'Esta reserva ya está pagada.' }, 409);
  if (s.cerradaSolicitud) return json({ error: 'Esta solicitud ya no se puede pagar. Recarga la página.' }, 409);
  if (s.falta) return json({ error: s.falta }, 400);
  if (s.cupo) {
    const espera = s.cupo === 'lista_espera';
    return json({
      cerrada: true,
      error: espera
        ? 'Esta categoría está completa. Puedes apuntarte a la lista de espera y te avisamos si queda una plaza.'
        : 'La inscripción de esta ronda está cerrada en tu categoría. Si quieres, te apuntamos a la lista de espera.',
      lista_espera: whatsapp(`Hola, quiero apuntarme a la lista de espera de la R${s.sol.ronda_numero} (${s.sol.codigo}).`),
    }, 409);
  }

  const sol = s.sol;
  // Formulario v2: aviso de WhatsApp y casilla de novedades, con su versión de texto (no frena el pago si falla).
  if (cuerpo.data.textos) await registrarConsentimientosFormulario(sol);
  if (metodo === 'bizum') {
    await enviarLead(sol, request);
    return json({
      bizum: {
        numero: BIZUM.numero,
        titular: BIZUM.titular,
        importe_cent: sol.importe_reserva_cent,
        codigo: sol.codigo,
        whatsapp: whatsapp(`Hola, he enviado el Bizum de la reserva ${sol.codigo}. Te adjunto el justificante.`),
      },
    });
  }

  try {
    // Si había una sesión anterior todavía abierta, se cierra para que no se pueda pagar dos veces.
    if (sol.stripe_checkout_session_id && sol.checkout_expira_en && new Date(sol.checkout_expira_en) > new Date()) {
      await stripe(`checkout/sessions/${sol.stripe_checkout_session_id}/expire`, {}).catch(() => {});
    }
    const sesion = await stripe('checkout/sessions', parametrosSesion(sol, origenWeb(request)));
    await conTransaccion((c) => c.query(
      `UPDATE solicitud_inscripcion SET stripe_checkout_session_id = $2, checkout_expira_en = to_timestamp($3) WHERE id = $1`,
      [sol.id, sesion.id, sesion.expires_at]), { actor: 'publico' });
    await enviarLead(sol, request);
    return json({ url: sesion.url });
  } catch (e) {
    console.error('checkout Stripe', e.message);
    if (e.codigo === 'sin_configurar') {
      return json({ error: 'El pago con tarjeta todavía no está activo. Prueba con Bizum o escríbenos por WhatsApp.' }, 503);
    }
    return json({ error: 'No se ha podido abrir el pago. Inténtalo de nuevo en un momento.' }, 502);
  }
}
