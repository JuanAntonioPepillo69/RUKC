// B1 · Confirmación de plaza por WhatsApp cuando una reserva queda pagada (Stripe o Bizum confirmado).
// Plantillas aprobadas: rukc_reserva_confirmada (al piloto) y rukc_reserva_confirmada_tutor (al tutor).
// - Piloto mayor de edad: al piloto; si no dejó teléfono, a quien pagó, con la variante "la plaza de <piloto>".
// - Piloto menor (inscripcion.es_menor o tutela registrada): al tutor (o a quien pagó, si no es el piloto) con la
//   variante de tutor, y también al menor si dejó su teléfono (decisión de John, 2026-11-12).
// - Nunca a quien se dio de baja del todo. Una sola vez por inscripción y teléfono (wa_outbox, clave B1:<inscripción>:<tel>).
// El botón "Unirme al grupo" lleva a https://raceupkc.com/grupo/<token>, que firma la inscripción (sin guardar nada):
// esa página manda al grupo si el acceso está aprobado y, si no, a la ficha del piloto (onboarding).
import crypto from 'node:crypto';
import { consulta } from '../db.js';
import { asegurarContacto, conversacionActual } from './entrante.js';
import { enviar as enviarYcloud } from './client.js';
import { construirPlantilla } from './templates.js';

const uno = async (t, p) => (await consulta(t, p))[0] ?? null;
export const URL_REGLAMENTO = 'https://raceupkc.com/reglamento';

// --- Token del botón del grupo -------------------------------------------------------------------------------------------
function claveGrupo() {
  const base = process.env.BETTER_AUTH_SECRET;
  if (!base) throw new Error('Falta BETTER_AUTH_SECRET para firmar el enlace del grupo');
  return crypto.createHmac('sha256', base).update('rukc:grupo:v1').digest();
}

/** Token de 44 caracteres: la inscripción (22) y su firma (22). No caduca: el acceso lo decide la página. */
export function tokenGrupo(inscripcionId) {
  const id = Buffer.from(String(inscripcionId).replace(/-/g, ''), 'hex');
  const firma = crypto.createHmac('sha256', claveGrupo()).update(id).digest().subarray(0, 16);
  return `${id.toString('base64url')}${firma.toString('base64url')}`;
}

/** Id de la inscripción si el token es válido; si no, null. */
export function leerTokenGrupo(token) {
  const t = String(token ?? '');
  if (!/^[\w-]{44}$/.test(t)) return null;
  const id = Buffer.from(t.slice(0, 22), 'base64url');
  const firma = Buffer.from(t.slice(22), 'base64url');
  if (id.length !== 16 || firma.length !== 16) return null;
  const esperada = crypto.createHmac('sha256', claveGrupo()).update(id).digest().subarray(0, 16);
  if (!crypto.timingSafeEqual(firma, esperada)) return null;
  const h = id.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// --- Datos -----------------------------------------------------------------------------------------------------------------
const pila = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const euros = (cent) => {
  const v = Math.max(0, Number(cent) || 0) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
};
/** "2026-11-22" → "domingo 22 de noviembre" */
export const fechaLarga = (iso) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' })
  .format(new Date(`${iso}T12:00:00Z`));

async function datosInscripcion(inscripcionId) {
  return uno(
    `SELECT i.id, i.estado, i.es_menor, i.tutor_nombre, inscripcion_saldo_cent(i.id) AS saldo_cent,
            r.numero, r.fecha::text AS fecha, c.nombre AS circuito,
            pil.id AS piloto_id, pil.nombre AS piloto_nombre, pil.telefono AS piloto_tel,
            pag.id AS pagador_id, pag.nombre AS pagador_nombre, pag.telefono AS pagador_tel,
            tut.nombre AS tutor_registrado, tut.telefono AS tutor_tel
     FROM inscripcion i
     JOIN ronda r ON r.id = i.ronda_id JOIN circuito c ON c.id = r.circuito_id
     JOIN persona pil ON pil.id = i.piloto_persona_id
     JOIN pedido pe ON pe.id = i.pedido_id JOIN persona pag ON pag.id = pe.pagador_persona_id
     LEFT JOIN LATERAL (
       SELECT pt.nombre, pt.telefono FROM tutela tu JOIN persona pt ON pt.id = tu.tutor_persona_id
       WHERE tu.menor_persona_id = pil.id ORDER BY tu.creado_en LIMIT 1
     ) tut ON true
     WHERE i.id = $1`, [inscripcionId]);
}

/** A quién va cada mensaje: [{ telefono, nombre, plantilla, variables }]. */
export function destinatariosB1(x) {
  const comunes = { ronda: `R${x.numero}`, fecha: fechaLarga(x.fecha), circuito: x.circuito, resto: euros(x.saldo_cent) };
  const piloto = (tel) => ({
    telefono: tel, nombre: x.piloto_nombre, plantilla: 'rukc_reserva_confirmada',
    variables: [pila(x.piloto_nombre), comunes.ronda, comunes.fecha, comunes.circuito, comunes.resto, URL_REGLAMENTO],
  });
  const tutor = (tel, nombre) => ({
    telefono: tel, nombre, plantilla: 'rukc_reserva_confirmada_tutor',
    variables: [pila(nombre), pila(x.piloto_nombre), comunes.ronda, comunes.fecha, comunes.circuito, comunes.resto, URL_REGLAMENTO],
  });
  const pagaOtro = x.pagador_id !== x.piloto_id && x.pagador_tel;
  const menor = Boolean(x.es_menor || x.tutor_tel);
  const lista = [];
  if (menor) {
    const telTutor = x.tutor_tel || (pagaOtro ? x.pagador_tel : null);
    const nombreTutor = x.tutor_registrado || x.tutor_nombre || x.pagador_nombre;
    if (telTutor) lista.push(tutor(telTutor, nombreTutor));
    if (x.piloto_tel && x.piloto_tel !== telTutor) lista.push(piloto(x.piloto_tel));
  } else if (x.piloto_tel) {
    lista.push(piloto(x.piloto_tel));
  } else if (x.pagador_tel) {
    lista.push(tutor(x.pagador_tel, x.pagador_nombre));
  }
  return lista;
}

/**
 * Manda la confirmación de una inscripción reservada o pagada. Nunca lanza: devuelve lo que ha hecho con cada teléfono.
 * d: { enviar } para los tests.
 */
export async function enviarConfirmacionReserva(inscripcionId, d = {}) {
  const enviar = d.enviar ?? enviarYcloud;
  try {
    if (!process.env.YCLOUD_API_KEY) return { nota: 'sin YCLOUD_API_KEY' };
    const x = await datosInscripcion(inscripcionId);
    if (!x) return { nota: 'no existe la inscripción' };
    if (!['reservada', 'pagada'].includes(x.estado)) return { nota: `inscripción ${x.estado}` };
    const boton = tokenGrupo(x.id);
    const resultados = [];
    for (const dest of destinatariosB1(x)) {
      const contacto = await asegurarContacto(dest.telefono, dest.nombre ?? null, false);
      if (contacto.baja === 'total') { resultados.push({ telefono: dest.telefono, nota: 'dado de baja' }); continue; }
      const fila = await uno(
        `INSERT INTO wa_outbox (contact_id, automatizacion, ronda_id, plantilla, variables, enviar_at, estado, idempotency_key)
         SELECT $1, 'B1', i.ronda_id, $2, $3, now(), 'enviando', $4 FROM inscripcion i WHERE i.id = $5
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [contacto.id, dest.plantilla, JSON.stringify({ variables: dest.variables }), `B1:${x.id}:${dest.telefono}`, x.id]);
      if (!fila) { resultados.push({ telefono: dest.telefono, nota: 'ya enviada' }); continue; }
      const conv = await conversacionActual(contacto.id);
      const envio = await enviar({
        contacto, conversacionId: conv.id, autor: 'sistema',
        plantilla: construirPlantilla(dest.plantilla, dest.variables, { sufijoBoton: boton }),
      });
      await consulta(`UPDATE wa_outbox SET estado = $2, intentos = intentos + 1, message_id = $3, ultimo_error = $4 WHERE id = $1`,
        [fila.id, envio.ok ? 'enviado' : 'fallido', envio.id ?? null, envio.ok ? null : String(envio.error ?? 'error').slice(0, 300)]);
      resultados.push({ telefono: dest.telefono, plantilla: dest.plantilla, ok: envio.ok });
    }
    return { resultados };
  } catch (e) {
    console.error('B1 confirmación', inscripcionId, e.message);
    return { error: e.message };
  }
}

/** Confirmaciones de todas las inscripciones de un pedido (un pago puede cubrir varias). */
export async function enviarConfirmacionesPedido(pedidoId, d = {}) {
  try {
    const ins = await consulta(`SELECT id FROM inscripcion WHERE pedido_id = $1 AND estado IN ('reservada', 'pagada')`, [pedidoId]);
    const salida = [];
    for (const i of ins) salida.push({ inscripcion: i.id, ...(await enviarConfirmacionReserva(i.id, d)) });
    return salida;
  } catch (e) {
    console.error('B1 pedido', pedidoId, e.message);
    return [{ error: e.message }];
  }
}
