// Esquemas de validación de los pasos del onboarding (F5). Un esquema por paso; el servidor valida siempre.
import { z } from 'zod';
import { normalizarDocumento, tipoDocumento } from '../cifrado.js';
import { telefono } from './panel.js';

const texto = (max, min = 1) => z.string().trim().min(min, 'Rellena este campo.').max(max);
const opcional = (max) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const email = z.string().trim().max(120).optional().nullable().transform((v, ctx) => {
  if (!v) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { ctx.addIssue({ code: 'custom', message: 'Revisa el email.' }); return z.NEVER; }
  return v.toLowerCase();
});
const documento = z.string().max(30).transform((v, ctx) => {
  const d = normalizarDocumento(v);
  const tipo = tipoDocumento(d);
  if (!tipo) { ctx.addIssue({ code: 'custom', message: 'Revisa el DNI, NIE o pasaporte.' }); return z.NEVER; }
  return { numero: d, tipo };
});

export const PASOS = ['personales', 'tutor', 'perfil', 'fisicos', 'emergencia', 'foto', 'formacion', 'documentos'];

/** Campos que nunca se guardan en el autoguardado (van cifrados o directamente a su tabla). */
export const NO_AUTOGUARDAR = ['fecha_nacimiento', 'peso_kg', 'documento'];

export const borrador = z.object({
  paso: z.enum(PASOS),
  campos: z.record(z.string().max(40), z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.array(z.string().max(80)).max(20)])),
}).strict();

export const personales = z.object({
  nombre: texto(80),
  apellidos: texto(120),
  fecha_nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Revisa la fecha de nacimiento.'),
  municipio: texto(80),
  instagram: opcional(60),
}).strict();

export const tutor = z.object({
  nombre: texto(80),
  apellidos: texto(120),
  telefono,
  email,
  relacion: z.enum(['padre', 'madre', 'tutor_legal']),
  documento,
}).strict();

export const perfil = z.object({
  nombre_competicion: texto(24, 2),
  dorsal: z.number().int().min(1).max(999),
  experiencia: z.enum(['ninguna', 'ocasional', 'amateur', 'competicion']),
  frecuencia: z.enum(['ocasional', 'mensual', 'semanal', 'varias_por_semana']),
  ligas_previas: opcional(300),
  circuitos_rodados: z.array(z.string().trim().min(1).max(80)).max(20).optional().nullable().transform((v) => (v?.length ? v : null)),
  objetivo: opcional(500),
  como_nos_conocio: opcional(200),
  comentarios: opcional(1000),
}).strict();

export const fisicos = z.object({
  consiente_peso: z.boolean(),
  peso_kg: z.number().min(30).max(200).optional().nullable(),
  altura_cm: z.number().int().min(120).max(230).optional().nullable(),
  categoria: z.string().regex(/^[A-Z]{3}$/).optional().nullable(),
  quiere_ambas: z.boolean().optional(),
}).strict().superRefine((d, ctx) => {
  if (d.consiente_peso && d.peso_kg == null) ctx.addIssue({ code: 'custom', path: ['peso_kg'], message: 'Indica tu peso con el equipo puesto.' });
});

export const emergencia = z.object({
  nombre: texto(120, 2),
  telefono,
  relacion: opcional(40),
}).strict();

export const documentos = z.object({
  reglamento: z.literal(true, { message: 'Tienes que aceptar el reglamento.' }),
  // Reglamento v1.1, Art. 60: solo el uso publicitario necesita consentimiento (casilla aparte, opcional).
  imagen: z.object({ anuncios: z.boolean().optional() }).strict(),
  riesgos: z.literal(true, { message: 'Tienes que aceptar la asunción de riesgos.' }),
  nombre: texto(160, 3),
  documento,
}).strict();

export const ESQUEMAS = { personales, tutor, perfil, fisicos, emergencia, documentos };

/** Valida y devuelve los datos, o lanza un error con status 400 y el primer mensaje legible. */
export function validar(esquema, datos) {
  const r = esquema.safeParse(datos ?? {});
  if (r.success) return r.data;
  const i = r.error.issues[0];
  throw Object.assign(new Error(i?.message && !/^(Invalid|Expected)/.test(i.message) ? i.message : 'Revisa los datos.'), { status: 400, campo: i?.path?.join('.') });
}
