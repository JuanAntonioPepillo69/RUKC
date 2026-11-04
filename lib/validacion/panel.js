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
// Onboarding y grupo (fase 4)
export const enlaceGrupo = z.object({ enlace: z.string().trim().max(200).regex(/^https:\/\/chat\.whatsapp\.com\/[\w-]+$/, 'El enlace tiene que ser de invitación a un grupo de WhatsApp (https://chat.whatsapp.com/...).').nullable() }).strict();
export const motivoObligatorio = z.object({ motivo: texto(300, 3) }).strict();
export const asistencia = z.object({ estado: z.enum(['asistio', 'no_presentado']), motivo: opcional(300) }).strict();
export const cobro = z.object({ inscripcion_id: uuid, importe_cent: cent.optional(), metodo: z.enum(['efectivo', 'bizum_manual']).default('efectivo') }).strict();

/** Valida y devuelve los datos, o lanza el primer mensaje de error. */
export function validar(esquema, datos, ErrorPanel) {
  const r = esquema.safeParse(datos);
  if (r.success) return r.data;
  const i = r.error.issues[0];
  throw new ErrorPanel(400, i.code === 'custom' ? i.message : `Revisa el campo ${i.path.join('.') || 'datos'}.`);
}

// Operación (fase 6): traslados, cancelaciones, resoluciones, reembolsos y créditos
export const trasladar = z.object({ ronda_id: uuid, aviso: fecha.optional().nullable(), motivo: opcional(300) }).strict();
export const motivoCancelar = z.object({ motivo: texto(300, 3) }).strict();
export const resolver = z.object({
  resolucion: z.enum(['reembolso', 'credito', 'traslado', 'sin_devolucion']),
  ronda_id: uuid.optional(),
  motivo: opcional(300),
  caduca_en: fecha.optional().nullable(),
}).strict();
export const reembolsar = z.object({ importe_cent: cent, motivo: texto(300, 3) }).strict();
export const abono = z.object({
  tipo: z.enum(['fidelidad', 'compensacion_cancelacion', 'ajuste']),
  importe_cent: z.number().int().refine((n) => n !== 0 && Math.abs(n) <= 1_000_000, 'Indica el importe.'),
  motivo: opcional(300),
  caduca_en: fecha.optional().nullable(),
}).strict();
export const canje = z.object({ inscripcion_id: uuid, importe_cent: cent }).strict();

// Documentos legales y RGPD (fase 6)
const TIPOS_DOC = ['asuncion_riesgos', 'cesion_imagen', 'reglamento', 'privacidad', 'condiciones_reserva', 'consentimiento_peso', 'aviso_borradores'];
export const documento = z.object({
  tipo: z.enum(TIPOS_DOC),
  version: z.string().trim().regex(/^[\w.-]{1,40}$/, 'La versión: letras, números, punto, guion o _ (por ejemplo, v2).'),
  titulo: texto(200, 3),
  contenido_md: z.string().min(20, 'Pega el texto completo del documento.').max(300_000),
  obligatorio_onboarding: z.boolean(),
  revocable: z.boolean(),
}).strict();
export const revisionAbogado = z.object({ revisado_abogado_en: fecha }).strict();
export const solicitudRgpd = z.object({
  contacto: texto(200, 3),
  tipo: z.enum(['acceso', 'rectificacion', 'supresion', 'oposicion', 'limitacion', 'portabilidad', 'retirada_consentimiento']),
  persona_id: uuid.optional().nullable(),
  recibida_en: fecha.optional().nullable(),
}).strict();
export const resolverRgpd = z.object({ estado: z.enum(['resuelta', 'rechazada']), resolucion: texto(1000, 3) }).strict();
export const anonimizar = z.object({ motivo: texto(300, 3) }).strict();
