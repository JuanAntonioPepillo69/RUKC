// POST /api/solicitud  · crea el borrador del formulario en cuanto hay un teléfono o un email válido.
//                        Devuelve un token que el navegador guarda en sessionStorage para seguir editándolo.
// PATCH /api/solicitud · actualiza el borrador (token en la cabecera Authorization: Bearer <token>).
// Guarda la atribución (rukc_origen) y el consentimiento de medición. Límite de peticiones y campo trampa.
// Diseño: F1 pasos 1–4.
import { guardarAtribucion, limpiarOrigen } from '../lib/atribucion.js';
import { conTransaccion } from '../lib/db.js';
import { dentroDelLimite, hashIp, ipCliente, json, leerJson, origenValido } from '../lib/http.js';
import { hashToken, nuevoToken, tokenDeCabecera } from '../lib/tokens.js';
import { actualizarSolicitud, crearSolicitud, mensajeError } from '../lib/validacion/solicitud.js';

const COLUMNAS = ['ronda_id', 'categoria_elegida', 'pagador_nombre', 'pagador_email', 'pagador_telefono', 'piloto_es_pagador',
  'piloto_nombre', 'piloto_telefono', 'metodo_elegido', 'paso_actual', 'acepta_comunicaciones'];
const EDITABLE = ['borrador', 'enviada', 'pago_abandonado'];
// Quién corre, quién paga, qué ronda y qué categoría: una vez dado el código de Bizum, cambiarlos es otra reserva.
const DATOS_RESERVA = ['ronda_id', 'categoria_elegida', 'pagador_nombre', 'pagador_email', 'pagador_telefono', 'piloto_es_pagador',
  'piloto_nombre', 'piloto_telefono'];

/** La ronda tiene que ser de la temporada y estar por celebrar; si no, se ignora. */
async function rondaValida(c, rondaId, temporadaId) {
  if (!rondaId) return null;
  const { rows } = await c.query(
    `SELECT id FROM ronda WHERE id = $1 AND temporada_id = $2 AND estado IN ('programada', 'aplazada')`, [rondaId, temporadaId]);
  return rows[0]?.id ?? null;
}

const sinCambios = (e) => /solicitud_contacto/.test(e.message);

export async function POST(request) {
  if (!origenValido(request)) return json({ error: 'Origen no permitido.' }, 403);
  const cuerpo = crearSolicitud.safeParse(await leerJson(request));
  if (!cuerpo.success) return json({ error: mensajeError(cuerpo.error) }, 400);
  const { campos, origen = {}, consentimiento_medicion = false, fbc, fbp, sitio_web } = cuerpo.data;

  // Campo trampa: se responde como si todo fuera bien, sin guardar nada.
  if (sitio_web) return json({ token: nuevoToken(), codigo: 'RK-0000' }, 201);
  if (!campos.pagador_telefono && !campos.pagador_email) {
    return json({ error: 'Escribe un teléfono o un correo válido.' }, 400);
  }

  try {
    const token = nuevoToken();
    const r = await conTransaccion(async (c) => {
      if (!(await dentroDelLimite(c, request, 'solicitud'))) return { limite: true };
      const { rows: [t] } = await c.query(
        `SELECT id FROM temporada WHERE estado IN ('abierta', 'en_curso') ORDER BY inicio DESC NULLS LAST LIMIT 1`);
      if (!t) return { sinTemporada: true };
      const rondaId = await rondaValida(c, campos.ronda_id, t.id);
      const { rows: [persona] } = await c.query(
        `SELECT id FROM persona WHERE ($1::text IS NOT NULL AND telefono = $1) OR ($2::citext IS NOT NULL AND email = $2)
         ORDER BY (telefono = $1) DESC NULLS LAST LIMIT 1`, [campos.pagador_telefono ?? null, campos.pagador_email ?? null]);
      const { rows: [s] } = await c.query(
        `INSERT INTO solicitud_inscripcion (temporada_id, ronda_id, categoria_elegida, pagador_nombre, pagador_email,
           pagador_telefono, piloto_es_pagador, piloto_nombre, piloto_telefono, metodo_elegido, paso_actual,
           acepta_comunicaciones, consentimiento_medicion, persona_id, borrador_token_hash, ultimo_guardado_en,
           ip_hash, user_agent, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, coalesce($7, true), $8, $9, $10, $11, coalesce($12, false), $13, $14, $15, now(), $16, $17, 'publico')
         RETURNING id, codigo`,
        [t.id, rondaId, campos.categoria_elegida ?? null, campos.pagador_nombre ?? null, campos.pagador_email ?? null,
          campos.pagador_telefono ?? null, campos.piloto_es_pagador ?? null, campos.piloto_nombre ?? null,
          campos.piloto_telefono ?? null, campos.metodo_elegido ?? null, campos.paso_actual ?? null,
          campos.acepta_comunicaciones ?? null, consentimiento_medicion, persona?.id ?? null, hashToken(token),
          hashIp(ipCliente(request)), (request.headers.get('user-agent') || '').slice(0, 300) || null]);
      const extra = { consentimiento: consentimiento_medicion, fbc, fbp };
      await guardarAtribucion(c, s.id, [limpiarOrigen(origen.primero, extra), limpiarOrigen(origen.ultimo, extra)]);
      return s;
    }, { actor: 'publico', ip: ipCliente(request) });
    if (r.limite) return json({ error: 'Demasiadas peticiones. Espera unos minutos.' }, 429);
    if (r.sinTemporada) return json({ error: 'No hay ninguna temporada abierta.' }, 409);
    return json({ token, codigo: r.codigo }, 201);
  } catch (e) {
    console.error('solicitud POST', e.message);
    return json({ error: 'No se ha podido guardar. Inténtalo de nuevo.' }, 500);
  }
}

export async function PATCH(request) {
  if (!origenValido(request)) return json({ error: 'Origen no permitido.' }, 403);
  const token = tokenDeCabecera(request);
  if (!token) return json({ error: 'Falta el token del borrador.' }, 401);
  const cuerpo = actualizarSolicitud.safeParse(await leerJson(request));
  if (!cuerpo.success) return json({ error: mensajeError(cuerpo.error) }, 400);
  const { campos, consentimiento_medicion, sitio_web } = cuerpo.data;
  if (sitio_web) return json({ ok: true });

  try {
    const r = await conTransaccion(async (c) => {
      if (!(await dentroDelLimite(c, request, 'solicitud-patch', 120))) return { limite: true };
      const { rows: [s] } = await c.query(
        'SELECT * FROM solicitud_inscripcion WHERE borrador_token_hash = $1 FOR UPDATE', [hashToken(token)]);
      if (!s) return { noExiste: true };
      if (!EDITABLE.includes(s.estado)) return { estado: s.estado, cerrada: true, codigo: s.codigo };

      const datos = { ...campos };
      if ('ronda_id' in datos) datos.ronda_id = await rondaValida(c, datos.ronda_id, s.temporada_id);
      // Con el código de Bizum ya entregado no se sobrescribe: el dinero puede estar en camino con ese código. El 409
      // hace que el formulario abra una solicitud nueva con otro código.
      if (s.estado !== 'borrador' && s.metodo_elegido === 'bizum'
        && DATOS_RESERVA.some((k) => k in datos && (datos[k] ?? null) !== (s[k] ?? null))) {
        return { estado: s.estado, cerrada: true, codigo: s.codigo };
      }
      if (consentimiento_medicion !== undefined) datos.consentimiento_medicion = consentimiento_medicion;
      const cols = Object.keys(datos).filter((k) => COLUMNAS.includes(k) || k === 'consentimiento_medicion');
      const sets = cols.map((k, i) => `${k} = $${i + 2}`);
      await c.query(
        `UPDATE solicitud_inscripcion SET ${[...sets, 'ultimo_guardado_en = now()'].join(', ')} WHERE id = $1`,
        [s.id, ...cols.map((k) => datos[k])]);
      return { codigo: s.codigo, estado: s.estado };
    }, { actor: 'publico', ip: ipCliente(request) });
    if (r.limite) return json({ error: 'Demasiadas peticiones. Espera unos minutos.' }, 429);
    if (r.noExiste) return json({ error: 'No encontramos el borrador.' }, 404);
    if (r.cerrada) return json({ error: 'Esta solicitud ya no se puede modificar.', estado: r.estado, codigo: r.codigo }, 409);
    return json({ ok: true, codigo: r.codigo, estado: r.estado });
  } catch (e) {
    if (sinCambios(e)) return json({ error: 'Deja al menos un teléfono o un correo.' }, 400);
    console.error('solicitud PATCH', e.message);
    return json({ error: 'No se ha podido guardar. Inténtalo de nuevo.' }, 500);
  }
}
