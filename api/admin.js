// /api/admin/* · API del panel de administración. vercel.json reescribe /api/admin/<ruta> a /api/admin?ruta=<ruta>.
// Toda ruta comprueba la sesión (con segundo factor) y el rol; las que cambian datos son POST con Origin de la web.
// Las pantallas (src/pages/admin) no llevan datos: todo se pide aquí.
import { despachar } from '../lib/admin.js';
import { hoy } from '../lib/panel/hoy.js';
import * as listas from '../lib/panel/listas.js';
import * as acciones from '../lib/panel/acciones.js';
import * as ventas from '../lib/panel/ventas.js';

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
  ['POST', 'pagos', ventas.registrarPago],
  ['POST', 'pagos/:id/confirmar', ventas.confirmarPago],
  ['POST', 'pagos/:id/rechazar', ventas.rechazarPago],
  ['POST', 'pagos/:id/factura', ventas.anotarFactura],
  ['POST', 'solicitudes/:id/confirmar-bizum', ventas.confirmarBizumWeb],
  ['POST', 'solicitudes/:id/rechazar-bizum', ventas.rechazarBizumWeb],
  // Ajustes
  ['GET', 'entidad', acciones.entidad],
  ['POST', 'entidad', acciones.guardarEntidad, ['propietario']],
];

export const GET = (request) => despachar(request, RUTAS);
export const POST = (request) => despachar(request, RUTAS);
