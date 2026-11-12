// Esquemas de validación de los formularios públicos de inscripción (POST/PATCH /api/solicitud y POST /api/checkout).
import { z } from 'zod';
import { normalizarTelefono } from '../telefono.js';

const texto = (max) => z.string().trim().max(max).transform((v) => v || null);
const telefono = z.string().max(30).transform((v, ctx) => {
  if (!v.trim()) return null;
  const t = normalizarTelefono(v);
  if (!t) { ctx.addIssue({ code: 'custom', message: 'telefono' }); return z.NEVER; }
  return t;
});
const email = z.string().trim().max(120).transform((v, ctx) => {
  if (!v) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { ctx.addIssue({ code: 'custom', message: 'email' }); return z.NEVER; }
  return v.toLowerCase();
});

const origen = z.object({
  utm_source: z.string().optional(), utm_medium: z.string().optional(), utm_campaign: z.string().optional(),
  utm_content: z.string().optional(), utm_term: z.string().optional(), fbclid: z.string().optional(),
  landing_path: z.string().optional(), referrer: z.string().optional(), capturada_en: z.string().optional(),
}).partial().passthrough().nullable().optional();

/** Campos editables del borrador. Todos opcionales: se guarda lo que haya. */
export const camposSolicitud = z.object({
  ronda_id: z.string().uuid().nullable().optional(),
  categoria_elegida: z.enum(['LIG', 'PES', 'no_se']).nullable().optional(),
  pagador_nombre: texto(80).optional(),
  pagador_email: email.optional(),
  pagador_telefono: telefono.optional(),
  piloto_es_pagador: z.boolean().optional(),
  piloto_nombre: texto(80).optional(),
  piloto_telefono: telefono.optional(),
  metodo_elegido: z.enum(['tarjeta', 'bizum']).nullable().optional(),
  paso_actual: z.number().int().min(1).max(9).optional(),
  acepta_comunicaciones: z.boolean().optional(),
  // Formulario v2 (FORM_V2): piloto menor con los datos de su tutor y avisos de RUKC por WhatsApp.
  piloto_menor: z.boolean().optional(),
  tutor_nombre: texto(80).optional(),
  tutor_telefono: telefono.optional(),
  tutor_relacion: z.enum(['padre', 'madre', 'tutor_legal']).nullable().optional(),
  acepta_whatsapp_novedades: z.boolean().optional(),
}).strict();

/** POST /api/solicitud: crea el borrador. Hace falta un teléfono o un email válido. */
export const crearSolicitud = z.object({
  campos: camposSolicitud,
  origen: z.object({ ultimo: origen, primero: origen }).partial().optional(),
  consentimiento_medicion: z.boolean().optional(),
  fbc: z.string().max(500).nullable().optional(),
  fbp: z.string().max(200).nullable().optional(),
  sitio_web: z.string().max(200).optional(),   // campo trampa: las personas no lo ven ni lo rellenan
}).strict();

/** PATCH /api/solicitud: actualiza el borrador (con su token en la cabecera Authorization). */
export const actualizarSolicitud = z.object({
  campos: camposSolicitud,
  consentimiento_medicion: z.boolean().optional(),
  sitio_web: z.string().max(200).optional(),
}).strict();

/** POST /api/checkout */
export const pedirPago = z.object({
  metodo: z.enum(['tarjeta', 'bizum']),
  acepta: z.literal(true),
  // Versión de los textos de WhatsApp que vio quien envía el formulario v2 (se guarda en wa_consents).
  textos: z.literal('formulario-web-v2-2026-11').optional(),
  sitio_web: z.string().max(200).optional(),
}).strict();

/** Comprueba que la solicitud guardada está completa para pagar. Devuelve un mensaje para el piloto o null. */
export function faltaParaPagar(s) {
  if (!s.ronda_id) return 'Elige la ronda que quieres reservar.';
  if (!s.categoria_elegida) return 'Elige tu categoría.';
  if (!s.pagador_nombre || s.pagador_nombre.length < 2) return 'Escribe tu nombre y apellidos.';
  if (!s.pagador_email) return 'Revisa tu correo.';
  if (!s.pagador_telefono) return 'Revisa tu número de WhatsApp.';
  if (!s.piloto_es_pagador && (!s.piloto_nombre || !s.piloto_telefono)) return 'Escribe el nombre y el WhatsApp del piloto.';
  if (s.piloto_menor && (!s.tutor_nombre || !s.tutor_telefono || !s.tutor_relacion)) {
    return 'Si el piloto es menor, escribe el nombre, el WhatsApp y la relación de su padre, madre o tutor legal.';
  }
  return null;
}

/** Mensaje legible del primer error de validación. */
export function mensajeError(error) {
  const issue = error?.issues?.[0];
  if (!issue) return 'Datos no válidos.';
  if (issue.message === 'telefono') return 'Revisa el número de WhatsApp.';
  if (issue.message === 'email') return 'Revisa el correo.';
  if (issue.path?.[0] === 'acepta') return 'Tienes que aceptar las condiciones de la reserva.';
  return 'Revisa los datos del formulario.';
}
