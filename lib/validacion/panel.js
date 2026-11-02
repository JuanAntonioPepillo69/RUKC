// Esquemas de validación de las acciones del panel (un esquema por endpoint).
import { z } from 'zod';
import { normalizarTelefono } from '../telefono.js';

const texto = (max, min = 0) => z.string().trim().min(min).max(max);
const opcional = (max) => z.string().trim().max(max).optional().transform((v) => v || null);
export const telefono = z.string().max(30).transform((v, ctx) => {
  const t = normalizarTelefono(v);
  if (!t) { ctx.addIssue({ code: 'custom', message: 'Revisa el teléfono.' }); return z.NEVER; }
  return t;
});
const email = z.string().trim().max(120).optional().transform((v, ctx) => {
  if (!v) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { ctx.addIssue({ code: 'custom', message: 'Revisa el email.' }); return z.NEVER; }
  return v.toLowerCase();
});
const uuid = z.string().uuid();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida.');
const cent = z.number().int().positive().max(1_000_000);

export const buscarTelefono = z.object({ telefono }).strict();

export const nuevoLead = z.object({
  telefono,
  nombre: texto(80, 1),
  apellidos: opcional(120),
  email,
  canal: z.enum(['meta_ads', 'instagram', 'whatsapp', 'web_directa', 'referido', 'circuito', 'otro']),
  campana: opcional(200),
  nota: texto(2000, 1),
  proxima_accion: opcional(200),
  proxima_accion_en: z.string().datetime({ offset: true }).optional().nullable(),
}).strict();

export const etapa = z.object({
  etapa: z.enum(['nueva', 'contactada', 'interesada', 'ganada', 'perdida', 'sin_respuesta']),
  motivo: opcional(500),
}).strict();

export const proxima = z.object({
  proxima_accion: opcional(200),
  proxima_accion_en: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();

export const interaccion = z.object({
  persona_id: uuid,
  oportunidad_id: uuid.optional().nullable(),
  tipo: z.enum(['nota', 'llamada', 'whatsapp_entrante', 'whatsapp_saliente', 'instagram', 'email', 'presencial']),
  resumen: texto(2000, 1),
}).strict();

export const editarPersona = z.object({
  nombre: texto(80, 1).optional(),
  apellidos: opcional(120),
  email,
  telefono: telefono.optional().nullable(),
  municipio: opcional(80),
  instagram: opcional(80),
  notas: opcional(4000),
}).strict();

export const fusionar = z.object({ duplicado_id: uuid }).strict();

export const whatsapp = z.object({
  tipo: z.enum(['lead', 'recuperar_borrador', 'recuperar_pago', 'confirmacion', 'saldo_pendiente', 'bizum_confirmado']),
  persona_id: uuid.optional(),
  solicitud_id: uuid.optional(),
  inscripcion_id: uuid.optional(),
}).strict();

export const cupo = z.object({ categoria: z.string().regex(/^[A-Z]{3}$/), estado: z.enum(['abierta', 'cerrada', 'lista_espera']) }).strict();
export const fechaRonda = z.object({ fecha, motivo: opcional(300) }).strict();
export const categoriaInscripcion = z.object({ categoria: z.string().regex(/^[A-Z]{3}$/).nullable() }).strict();

export const entidad = z.object({
  nombre_comercial: texto(120, 1),
  titular_legal: opcional(200),
  nif: opcional(20),
  tipo: z.enum(['persona_fisica', 'empresa', 'sociedad']).nullable().optional(),
  activa_desde: fecha.nullable().optional(),
}).strict();

const persona = z.union([
  z.object({ persona_id: uuid }).strict(),
  z.object({ nombre: texto(120, 2), telefono, email }).strict(),
]);

export const pago = z.object({
  metodo: z.enum(['bizum_manual', 'transferencia', 'efectivo']),
  importe_cent: cent,
  fecha: fecha.optional(),
  verificado: z.boolean(),              // efectivo y transferencia ya vista: true; Bizum o transferencia sin ver: false
  cobrado_por: opcional(80),
  referencia: opcional(120),
}).strict();

export const nuevaVenta = z.object({
  pagador: persona,
  lineas: z.array(z.object({
    piloto: z.union([z.literal('pagador'), persona]),
    producto: z.enum(['carrera_suelta', 'temporada_completa', 'temporada_resto']),
    ronda_id: uuid.optional(),
    categoria: z.enum(['LIG', 'PES']).nullable().optional(),
  }).strict()).min(1).max(20),
  descuento: z.union([
    z.object({ tipo: z.literal('codigo'), codigo: texto(40, 1) }).strict(),
    z.object({ tipo: z.literal('manual'), importe_cent: cent, motivo: texto(300, 3) }).strict(),
  ]).nullable().optional(),
  pagos: z.array(pago).max(10).default([]),
}).strict();

export const registrarPago = pago.extend({ pedido_id: uuid }).strict();
export const factura = z.object({ factura_ref: texto(60, 1) }).strict();
export const rechazar = z.object({ motivo: opcional(300) }).strict();
export const cobro = z.object({ inscripcion_id: uuid, importe_cent: cent.optional(), metodo: z.enum(['efectivo', 'bizum_manual']).default('efectivo') }).strict();

/** Valida y devuelve los datos, o lanza el primer mensaje de error. */
export function validar(esquema, datos, ErrorPanel) {
  const r = esquema.safeParse(datos);
  if (r.success) return r.data;
  const i = r.error.issues[0];
  throw new ErrorPanel(400, i.code === 'custom' ? i.message : `Revisa el campo ${i.path.join('.') || 'datos'}.`);
}
