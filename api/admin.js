// /api/admin/* · API del panel de administración. vercel.json reescribe /api/admin/<ruta> a /api/admin?ruta=<ruta>.
// Toda ruta comprueba la sesión (con segundo factor) y el rol; las que cambian datos son POST con Origin de la web.
// Las pantallas (src/pages/admin) no llevan datos: todo se pide aquí.
import { despachar } from '../lib/admin.js';
import { hoy } from '../lib/panel/hoy.js';
import * as listas from '../lib/panel/listas.js';
import * as acciones from '../lib/panel/acciones.js';
import * as ventas from '../lib/panel/ventas.js';
import * as onboarding from '../lib/panel/onboarding.js';
import * as feedback from '../lib/panel/feedback.js';
import * as operacion from '../lib/panel/operacion.js';
import * as sistema from '../lib/panel/sistema.js';

const RUTAS = [
  ['GET', 'yo', ({ admin }) => ({ admin })],
  ['GET', 'hoy', hoy],
  // Listas con filtros, vistas guardadas y exportación
  ['GET', 'lista/:vista', listas.lista],
  ['GET', 'exportar/:vista', listas.exportar],
  ['GET', 'vistas/:pantalla', listas.vistasGuardadas],
  ['POST', 'vistas', listas.guardarVista],
  ['POST', 'vistas/:id/borrar', listas.borrarVista],
  // Leads (F3) y personas
  ['POST', 'leads/buscar', acciones.buscarPorTelefono],
  ['POST', 'leads', acciones.nuevoLead],
  ['POST', 'oportunidades/:id/etapa', acciones.cambiarEtapa],
  ['POST', 'oportunidades/:id/proxima', acciones.proximaAccion],
  ['POST', 'interacciones', acciones.nuevaInteraccion],
  ['GET', 'personas/:id', acciones.ficha],
  ['POST', 'personas/:id', acciones.editarPersona],
  ['POST', 'personas/:id/fusionar', acciones.fusionar],
  ['GET', 'buscar-personas', acciones.buscarPersonas],
  // Recuperar (embudo)
  ['POST', 'solicitudes/:id/descartar', acciones.descartarSolicitud],
  ['POST', 'whatsapp', acciones.whatsapp],
  // Rondas e inscripciones
  ['GET', 'rondas', acciones.rondas],
  ['POST', 'rondas/:id/cupo', acciones.cambiarCupo],
  ['POST', 'rondas/:id/aplazar', acciones.aplazarRonda],
  ['POST', 'rondas/:id/reprogramar', acciones.reprogramarRonda],
  ['GET', 'rondas/:id/cobros', ventas.pendientesDeCobro],
  ['POST', 'rondas/:id/cobro', ventas.cobroEnCircuito],
  ['POST', 'inscripciones/:id/categoria', acciones.cambiarCategoria],
  // Ventas y pagos (F4)
  ['GET', 'catalogo-venta', ventas.catalogoVenta],
  ['POST', 'ventas', ventas.nuevaVenta],
  ['GET', 'pedidos', ventas.pedidosDe],
  ['POST', 'pagos', ventas.registrarPago],
  ['POST', 'pagos/:id/confirmar', ventas.confirmarPago],
  ['POST', 'pagos/:id/rechazar', ventas.rechazarPago],
  ['POST', 'pagos/:id/factura', ventas.anotarFactura],
  ['POST', 'solicitudes/:id/confirmar-bizum', ventas.confirmarBizumWeb],
  ['POST', 'solicitudes/:id/rechazar-bizum', ventas.rechazarBizumWeb],
  // Onboarding y grupo (F5), foto del piloto y acreditación
  ['GET', 'onboarding', onboarding.resumen],
  ['POST', 'onboarding/enlace-grupo', onboarding.guardarEnlaceGrupo, ['propietario']],
  ['POST', 'onboarding/:id/enlace', onboarding.reenviarEnlace],
  ['POST', 'grupo/:id/aprobar', onboarding.aprobarGrupo],
  ['POST', 'grupo/:id/rechazar', onboarding.rechazarGrupo],
  ['POST', 'grupo/:id/reabrir', onboarding.reabrirGrupo],
  ['POST', 'grupo/:id/enviar', onboarding.enviarGrupo],
  ['POST', 'grupo/:id/dentro', onboarding.marcarDentro],
  ['GET', 'personas/:id/foto', onboarding.foto],
  ['GET', 'rondas/:id/acreditacion', onboarding.acreditacion],
  ['POST', 'inscripciones/:id/asistencia', onboarding.asistencia],
  // Feedback post-carrera (F6)
  ['GET', 'feedback/plantillas', feedback.plantillas],
  ['POST', 'feedback/plantillas', feedback.crearPlantilla],
  ['POST', 'feedback/plantillas/:id', feedback.editarPlantilla],
  ['POST', 'feedback/plantillas/:id/duplicar', feedback.duplicarPlantilla],
  ['POST', 'feedback/plantillas/:id/activar', feedback.activarPlantilla],
  ['GET', 'feedback/rondas', feedback.rondas],
  ['GET', 'feedback/rondas/:id', feedback.ronda],
  ['GET', 'feedback/rondas/:id/exportar', feedback.exportar],
  ['POST', 'feedback/rondas/:id/generar', feedback.generar],
  ['POST', 'feedback/envios/:id/enviar', feedback.enviar],
  ['POST', 'feedback/envios/:id/recordar', feedback.recordar],
  // Operación (F7, F8, reembolsos y créditos)
  ['GET', 'inscripciones/:id/destinos', operacion.destinos],
  ['POST', 'inscripciones/:id/trasladar', operacion.trasladar],
  ['POST', 'inscripciones/:id/cancelar', operacion.cancelarInscripcion],
  ['POST', 'inscripciones/:id/resolver', operacion.resolver],
  ['POST', 'rondas/:id/cancelar', operacion.cancelarRonda, ['propietario']],
  ['GET', 'rondas/:id/canceladas', operacion.canceladas],
  ['POST', 'pagos/:id/reembolsar', operacion.reembolsarPago, ['propietario']],
  ['GET', 'personas/:id/creditos', operacion.creditos],
  ['POST', 'personas/:id/creditos', operacion.abonar],
  ['POST', 'personas/:id/canje', operacion.canjear],
  // Documentos legales, RGPD y sistema (fase 6)
  ['GET', 'documentos', sistema.documentos],
  ['GET', 'documentos/:id', sistema.documento],
  ['POST', 'documentos', sistema.crearDocumento, ['propietario']],
  ['POST', 'documentos/:id', sistema.editarDocumento, ['propietario']],
  ['POST', 'documentos/:id/revision', sistema.revisarDocumento, ['propietario']],
  ['POST', 'documentos/:id/activar', sistema.activarDocumento, ['propietario']],
  ['GET', 'rgpd', sistema.rgpd],
  ['POST', 'rgpd', sistema.nuevaSolicitud],
  ['POST', 'rgpd/:id/resolver', sistema.resolverSolicitud],
  ['GET', 'personas/:id/exportar', sistema.exportarPersona, ['propietario']],
  ['POST', 'personas/:id/anonimizar', sistema.anonimizarPersona, ['propietario']],
  ['GET', 'sistema', sistema.sistema],
  ['GET', 'copias/descargar', sistema.descargarCopia, ['propietario']],
  // Ajustes
  ['GET', 'entidad', acciones.entidad],
  ['POST', 'entidad', acciones.guardarEntidad, ['propietario']],
];

export const GET = (request) => despachar(request, RUTAS);
export const POST = (request) => despachar(request, RUTAS);
