// Fase 4 · Métricas mensuales del bot: conversaciones, escalados, reservas atribuidas a WhatsApp y coste de Meta y de
// Claude. Las lee John por el canal admin (herramienta ver_metricas).
// Meses en hora de Madrid. Los importes son estimaciones con las tarifas de abajo: si la factura no cuadra (margen
// objetivo: 5 %), se cambian aquí o en bot_settings (precios_meta / precios_claude, JSON con la misma forma).
import { consulta } from '../db.js';

// Meta (especificación 3a; mensajes iniciados por la empresa, España, en dólares). "service" (respuestas dentro de la
// ventana de 24 h) no se cobra.
export const PRECIOS_META = { utility: 0.02, marketing: 0.0707, authentication: 0.02, service: 0 };
// Claude, dólares por millón de tokens (referencia de la API, 03/11/2026). Escritura de caché a 1,25 veces la entrada
// (caché de 5 minutos). Búsqueda web: 10 $ cada mil.
export const PRECIOS_CLAUDE = {
  'claude-sonnet-5-5': { entrada: 2, salida: 10, cache_lectura: 0.1, cache_escritura: 2.5 },
  'claude-haiku-5-5': { entrada: 0.1, salida: 0.5, cache_lectura: 0.01, cache_escritura: 0.125 },
  'claude-sonnet-5': { entrada: 2, salida: 10, cache_lectura: 0.2, cache_escritura: 2.5 },
};
export const PRECIO_BUSQUEDA = 0.01;
// Una reserva cuenta como "atribuida a WhatsApp" si quien pagó habló con el bot (o recibió un aviso) en los 7 días
// anteriores al pago.
const DIAS_ATRIBUCION = 7;

const redondea = (n) => Math.round(n * 100) / 100;

async function precios() {
  const filas = await consulta(`SELECT clave, valor FROM bot_settings WHERE clave IN ('precios_meta', 'precios_claude')`).catch(() => []);
  const leer = (clave, base) => {
    try { const v = filas.find((f) => f.clave === clave)?.valor; return v ? { ...base, ...JSON.parse(v) } : base; } catch { return base; }
  };
  return { meta: leer('precios_meta', PRECIOS_META), claude: leer('precios_claude', PRECIOS_CLAUDE) };
}

/** Mes en curso en Madrid (YYYY-MM). */
export const mesActual = (ahora = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).format(ahora).slice(0, 7);

/** Métricas de un mes (YYYY-MM, por defecto el actual). */
export async function metricasMes(mes = mesActual()) {
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('El mes va como AAAA-MM.');
  const p = await precios();
  const rango = `(($1 || '-01')::timestamp AT TIME ZONE 'Europe/Madrid')`;
  const fin = `((($1 || '-01')::date + interval '1 month')::timestamp AT TIME ZONE 'Europe/Madrid')`;
  const enMes = (col) => `${col} >= ${rango} AND ${col} < ${fin}`;

  const [conv] = await consulta(
    `SELECT count(DISTINCT m.conversation_id)::int AS conversaciones, count(DISTINCT m.contact_id)::int AS contactos,
            count(*) FILTER (WHERE m.direccion = 'entrada')::int AS recibidos,
            count(*) FILTER (WHERE m.direccion = 'salida' AND m.autor = 'bot')::int AS respuestas_bot,
            count(*) FILTER (WHERE m.direccion = 'salida' AND m.autor = 'john_app')::int AS respuestas_john,
            count(*) FILTER (WHERE m.direccion = 'salida' AND m.autor = 'sistema')::int AS avisos_sistema
     FROM wa_messages m JOIN wa_contacts c ON c.id = m.contact_id
     WHERE c.rol <> 'admin' AND ${enMes('m.created_at')}`, [mes]);
  const [esc] = await consulta(
    `SELECT count(*)::int AS escaladas FROM wa_conversations v JOIN wa_contacts c ON c.id = v.contact_id
     WHERE c.rol <> 'admin' AND v.motivo_escalado IS NOT NULL AND ${enMes('v.updated_at')}`, [mes]);
  const [res] = await consulta(
    `SELECT count(*)::int AS pagadas,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM wa_messages m JOIN wa_contacts c ON c.id = m.contact_id
              WHERE c.phone_e164 IN (s.pagador_telefono, s.piloto_telefono)
                AND m.created_at BETWEEN s.pagada_en - make_interval(days => $2) AND s.pagada_en))::int AS por_whatsapp,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM wa_outbox o JOIN wa_contacts c ON c.id = o.contact_id
              WHERE o.automatizacion = 'C1' AND o.estado = 'enviado' AND c.phone_e164 = s.pagador_telefono
                AND o.created_at BETWEEN s.pagada_en - make_interval(days => $2) AND s.pagada_en))::int AS tras_seguimiento
     FROM solicitud_inscripcion s WHERE s.estado = 'pagada' AND ${enMes('s.pagada_en')}`, [mes, DIAS_ATRIBUCION]);
  const meta = await consulta(
    `SELECT coalesce(categoria_precio, 'sin_dato') AS categoria, count(*)::int AS mensajes
     FROM wa_messages WHERE direccion = 'salida' AND estado IS DISTINCT FROM 'fallido' AND (facturable IS NOT false)
       AND tipo = 'plantilla' AND ${enMes('created_at')} GROUP BY 1`, [mes]);
  const claude = await consulta(
    `SELECT modelo, uso, count(*)::int AS llamadas, sum(entrada)::bigint AS entrada, sum(salida)::bigint AS salida,
            sum(cache_lectura)::bigint AS cache_lectura, sum(cache_escritura)::bigint AS cache_escritura, sum(busquedas)::int AS busquedas
     FROM wa_llm_usage WHERE ${enMes('created_at')} GROUP BY 1, 2`, [mes]).catch(() => null);

  let costeMeta = 0;
  for (const m of meta) costeMeta += m.mensajes * (p.meta[m.categoria] ?? p.meta.utility);
  let costeClaude = 0;
  const porUso = {};
  for (const c of claude ?? []) {
    const t = p.claude[c.modelo] ?? p.claude['claude-sonnet-5-5'];
    const coste = (Number(c.entrada) * t.entrada + Number(c.salida) * t.salida + Number(c.cache_lectura) * t.cache_lectura
      + Number(c.cache_escritura) * t.cache_escritura) / 1e6 + c.busquedas * PRECIO_BUSQUEDA;
    costeClaude += coste;
    porUso[c.uso] = redondea((porUso[c.uso] ?? 0) + coste);
  }
  return {
    mes,
    conversaciones: conv.conversaciones, contactos: conv.contactos, mensajes_recibidos: conv.recibidos,
    respuestas_bot: conv.respuestas_bot, respuestas_john_app: conv.respuestas_john, avisos_automaticos: conv.avisos_sistema,
    conversaciones_escaladas: esc.escaladas,
    reservas_pagadas: res.pagadas, reservas_atribuidas_whatsapp: res.por_whatsapp, reservas_tras_seguimiento_c1: res.tras_seguimiento,
    plantillas_facturables: Object.fromEntries(meta.map((m) => [m.categoria, m.mensajes])),
    coste_meta_usd: redondea(costeMeta),
    coste_claude_usd: claude ? redondea(costeClaude) : null,
    coste_claude_por_uso_usd: porUso,
    coste_total_usd: redondea(costeMeta + costeClaude),
    nota: claude ? 'Estimación con las tarifas de lib/whatsapp/metricas.js; YCloud puede añadir su comisión.' : 'Falta la migración 0016: sin datos de consumo de Claude.',
  };
}
