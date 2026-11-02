// Pantalla "Hoy": todo lo que pide atención, en una sola consulta por bandeja.
export async function hoy({ tx }) {
  return tx(async (c) => {
    const filas = async (t, p) => (await c.query(t, p)).rows;
    const [porVerificar, webBizum, recientes, leadsVencidos, onboarding, grupo, proxima, feedback, sobrecupo] = await Promise.all([
      filas(`SELECT id, codigo, metodo, importe_cent, pagador, pagador_telefono, referencia_externa, fecha FROM v_pagos
             WHERE estado = 'pendiente_verificacion' ORDER BY fecha`),
      filas(`SELECT s.id, s.codigo, s.pagador_nombre, s.pagador_telefono, s.enviada_en, r.numero AS ronda, t.importe_reserva_cent
             FROM solicitud_inscripcion s JOIN temporada t ON t.id = s.temporada_id LEFT JOIN ronda r ON r.id = s.ronda_id
             WHERE s.estado = 'enviada' AND s.metodo_elegido = 'bizum' ORDER BY s.enviada_en`),
      filas(`SELECT id, codigo, estado, ronda, categoria, pagador_nombre, pagador_telefono, canal, horas_sin_pagar FROM v_embudo
             WHERE estado IN ('borrador', 'pago_abandonado') AND coalesce(ultimo_guardado_en, creado_en) > now() - interval '24 hours'
             ORDER BY coalesce(ultimo_guardado_en, creado_en) DESC`),
      filas(`SELECT id, persona_id, persona, telefono, etapa, proxima_accion, proxima_accion_en FROM v_leads
             WHERE accion_vencida ORDER BY proxima_accion_en`),
      filas(`SELECT id, persona_id, piloto, telefono, estado, menor FROM v_onboarding
             WHERE estado IN ('pendiente', 'en_curso', 'falta_tutor', 'requiere_actualizacion') ORDER BY creado_en`),
      filas(`SELECT a.id, a.persona_id, btrim(p.nombre || ' ' || coalesce(p.apellidos, '')) AS piloto, p.telefono, a.solicitado_en
             FROM acceso_grupo a JOIN persona p ON p.id = a.persona_id WHERE a.estado = 'pendiente_aprobacion' ORDER BY a.solicitado_en`),
      filas(`SELECT * FROM v_parrilla WHERE ronda_id = (SELECT id FROM ronda WHERE estado IN ('programada', 'aplazada')
             AND fecha >= (now() AT TIME ZONE 'Europe/Madrid')::date ORDER BY fecha LIMIT 1) ORDER BY categoria`),
      filas(`SELECT count(*) FILTER (WHERE estado IN ('generado'))::int AS por_enviar,
                    count(*) FILTER (WHERE estado IN ('enviado', 'abierto'))::int AS sin_responder FROM envio_feedback`),
      filas(`SELECT ronda, categoria, plazas, inscritos FROM v_parrilla WHERE en_sobrecupo ORDER BY ronda`),
    ]);
    return { porVerificar, webBizum, recientes, leadsVencidos, onboarding, grupo, proxima, feedback: feedback[0], sobrecupo };
  });
}
