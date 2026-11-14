// Recordatorio de la ficha de piloto (onboarding) por WhatsApp, en lote con CONFIRMO (programador.js).
// - A quién: pilotos con plaza (reservada o pagada) en una ronda de los próximos 14 días cuya ficha de la temporada
//   no está completada. Si el piloto es menor, al tutor. Nunca a quien se dio de baja del todo.
// - Cuántas veces: como mucho uno cada 3 días (contando también los enlaces que mande John desde el panel) y 3 por
//   ronda desde el bot.
// - El enlace: https://raceupkc.com/ficha/<token>, el mismo token firmado del botón de la confirmación de plaza
//   (/ficha/ y /grupo/ van a api/grupo.js). No caduca: al abrirlo se genera el enlace nuevo a la ficha.
// - Con la ventana de 24 h abierta, texto libre; si no, la plantilla rukc_ficha_piloto (hay que darla de alta y que
//   Meta la apruebe).
// Va con el código de automatización B4 (recordatorios de un trámite pendiente, como el del Bizum), sin migración.
import { consulta } from '../db.js';
import { tokenGrupo } from './confirmacion.js';

export const DIAS_ANTES = 14;
export const DIAS_ENTRE = 3;
export const MAX_POR_RONDA = 3;
const ESTADOS_PENDIENTES = ['pendiente', 'en_curso', 'falta_tutor', 'requiere_actualizacion'];
const pila = (n) => String(n || '').trim().split(/\s+/)[0] || '';

export const enlaceFicha = (inscripcionId) => `https://raceupkc.com/ficha/${tokenGrupo(inscripcionId)}`;

export const textoFicha = (v, enlace) =>
  `Hola, ${v[0]}. Para correr la ${v[1]} de RUKC falta completar la ficha de piloto: datos, contacto de emergencia y autorizaciones. Son unos minutos y es obligatoria para correr: ${enlace}`;

/**
 * Destinatarios del recordatorio de la ficha en una ronda (r de datosRonda). `ahora` para los tests.
 * Cada uno: { telefono, nombre, inscripcion_id, onboarding_id, variables: [nombre, "R2"] }.
 */
export async function destinatariosFicha(r, { ahora = new Date() } = {}) {
  const filas = await consulta(
    `SELECT i.id AS inscripcion_id, o.id AS onboarding_id, o.enlace_enviado_en,
            pil.nombre AS piloto_nombre, pil.telefono AS piloto_tel,
            tut.nombre AS tutor_nombre, tut.telefono AS tutor_tel, pag.nombre AS pagador_nombre, pag.telefono AS pagador_tel,
            (SELECT count(*)::int FROM wa_outbox x WHERE x.idempotency_key LIKE 'FICHA:R' || r.numero || ':%:' || i.id::text || ':%'
               AND x.estado = 'enviado') AS enviados_bot,
            (SELECT max(x.created_at) FROM wa_outbox x WHERE x.idempotency_key LIKE 'FICHA:R' || r.numero || ':%:' || i.id::text || ':%'
               AND x.estado IN ('pendiente_confirmacion', 'confirmado', 'enviando', 'enviado')) AS ultimo_bot
     FROM inscripcion i JOIN ronda r ON r.id = i.ronda_id
     JOIN persona pil ON pil.id = i.piloto_persona_id
     JOIN onboarding o ON o.persona_id = pil.id AND o.temporada_id = r.temporada_id
     JOIN pedido pe ON pe.id = i.pedido_id JOIN persona pag ON pag.id = pe.pagador_persona_id
     LEFT JOIN LATERAL (SELECT pt.nombre, pt.telefono FROM tutela tu JOIN persona pt ON pt.id = tu.tutor_persona_id
                        WHERE tu.menor_persona_id = pil.id ORDER BY tu.creado_en LIMIT 1) tut ON true
     WHERE i.ronda_id = $1 AND i.estado IN ('reservada', 'pagada') AND o.estado = ANY($2::text[])
     ORDER BY pil.nombre`, [r.id, ESTADOS_PENDIENTES]);
  const limite = ahora.getTime() - DIAS_ENTRE * 864e5;
  const salida = new Map();
  for (const x of filas) {
    if (x.enviados_bot >= MAX_POR_RONDA) continue;
    const ultimo = Math.max(x.enlace_enviado_en ? new Date(x.enlace_enviado_en).getTime() : 0, x.ultimo_bot ? new Date(x.ultimo_bot).getTime() : 0);
    if (ultimo > limite) continue;
    // Menor: al tutor (los menores no reciben mensajes). Si no, al piloto; si no tiene teléfono, a quien pagó.
    const [telefono, nombre] = x.tutor_tel ? [x.tutor_tel, x.tutor_nombre] : x.piloto_tel ? [x.piloto_tel, x.piloto_nombre] : [x.pagador_tel, x.pagador_nombre];
    if (!telefono || salida.has(telefono)) continue;
    salida.set(telefono, {
      telefono, nombre, inscripcion_id: x.inscripcion_id, onboarding_id: x.onboarding_id, n: x.enviados_bot + 1,
      clave: `FICHA:R${r.numero}:${telefono}:${x.inscripcion_id}:${x.enviados_bot + 1}`,
      variables: [pila(nombre) || 'piloto', `R${r.numero}`],
    });
  }
  return [...salida.values()];
}

/** ¿Sigue pendiente la ficha? (justo antes de enviar). */
export async function fichaPendiente(onboardingId) {
  const [o] = await consulta('SELECT estado FROM onboarding WHERE id = $1', [onboardingId]);
  return Boolean(o && ESTADOS_PENDIENTES.includes(o.estado));
}

/** Tras enviar: cuenta en el panel como un envío más del enlace (seguimiento de la ficha). */
export async function anotarEnvio(onboardingId) {
  await consulta('UPDATE onboarding SET envios = envios + 1, enlace_enviado_en = now() WHERE id = $1', [onboardingId]);
}
