// Acciones RGPD que se usan desde la pantalla RGPD y desde la ficha: exportar todo lo de una persona y anonimizarla.
import { accion, api, formulario } from './api';

/** Descarga el JSON con todos sus datos (acceso o portabilidad). La descarga queda en el historial. */
export function exportar(personaId: string) {
  window.location.href = `/api/admin/personas/${personaId}/exportar`;
}

export async function anonimizar(personaId: string, nombre: string): Promise<boolean> {
  const v = await formulario(`Anonimizar a ${nombre}`, [{ nombre: 'motivo', etiqueta: 'Motivo', tipo: 'textarea', requerido: true, valor: 'Plazo de conservación vencido' }],
    'Anonimizar', 'Se vacían su nombre, contacto y notas, se borran su documento, peso, contacto de emergencia y foto, y se conservan los importes y las firmas. No se puede deshacer.');
  if (!v || !confirm(`¿Seguro? ${nombre} quedará anonimizada para siempre.`)) return false;
  return Boolean(await accion(() => api(`personas/${personaId}/anonimizar`, { motivo: v.motivo }), 'Anonimizada.'));
}
