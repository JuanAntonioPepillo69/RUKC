// Acciones de operación que se usan desde la ficha y desde Rondas: trasladar, cancelar y resolver una inscripción
// cancelada, y reembolsar un pago. Devuelven true si se hizo algo (para recargar la pantalla).
import { accion, aCentimos, api, aviso, euros, fecha, formulario } from './api';

export async function trasladar(inscripcionId: string, codigo: string, resolverCancelada = false): Promise<boolean> {
  const d = await api(`inscripciones/${inscripcionId}/destinos`);
  if (!d.rondas.length) { aviso('No hay rondas abiertas a las que trasladarla.', true); return false; }
  const v = await formulario(`Trasladar ${codigo}`, [
    { nombre: 'ronda_id', etiqueta: 'Ronda destino', tipo: 'select', opciones: d.rondas.map((r: any) => [r.id, `R${r.numero} · ${r.circuito} · ${fecha(r.fecha)}`]) },
    ...(resolverCancelada ? [] : [{ nombre: 'aviso', etiqueta: 'Fecha en que avisó', tipo: 'date' as const, valor: new Date().toISOString().slice(0, 10) }]),
    { nombre: 'motivo', etiqueta: 'Motivo de la excepción', tipo: 'textarea' as const, ayuda: resolverCancelada ? 'Opcional: la ronda se canceló.' : `Obligatorio si avisó con menos de ${d.aviso_dias} días.` },
  ], 'Trasladar', 'Los pagos aplicados y los canjes de crédito pasan a la inscripción nueva.');
  if (!v) return false;
  const ruta = resolverCancelada ? `inscripciones/${inscripcionId}/resolver` : `inscripciones/${inscripcionId}/trasladar`;
  const cuerpo = resolverCancelada ? { resolucion: 'traslado', ronda_id: v.ronda_id, motivo: v.motivo || undefined }
    : { ronda_id: v.ronda_id, aviso: v.aviso || undefined, motivo: v.motivo || undefined };
  const r = await accion(() => api<any>(ruta, cuerpo), '');
  if (!r) return false;
  aviso(`Trasladada a ${r.destino.codigo}${r.fuera_de_plazo ? ' (fuera de plazo, con motivo)' : ''}.${r.aviso ? ` ${r.aviso}` : ''}`);
  return true;
}

export async function cancelar(inscripcionId: string, codigo: string): Promise<boolean> {
  const v = await formulario(`Cancelar ${codigo}`, [{ nombre: 'motivo', etiqueta: 'Motivo', tipo: 'textarea', requerido: true }], 'Cancelar inscripción',
    'Queda cancelada con la resolución pendiente: después eliges reembolso, crédito, traslado o sin devolución.');
  if (!v) return false;
  return Boolean(await accion(() => api(`inscripciones/${inscripcionId}/cancelar`, { motivo: v.motivo }), 'Inscripción cancelada.'));
}

/** Resolución de una inscripción cancelada. `pagos`: lo que pagó y por qué vía, para explicarlo antes de elegir. */
export async function resolver(i: { id: string; codigo: string; pagado_cent?: number; pagos?: any[] }): Promise<boolean> {
  const detalle = i.pagos?.length ? `Pagó ${euros(i.pagado_cent)}: ${i.pagos.map((p: any) => `${p.codigo} ${euros(p.importe_cent)} (${p.stripe ? 'Stripe, se devuelve solo' : `${p.metodo.replace('_', ' ')}, lo devuelves tú`})`).join(' · ')}.` : '';
  const v = await formulario(`Resolver ${i.codigo}`, [
    { nombre: 'resolucion', etiqueta: 'Resolución', tipo: 'select', opciones: [['credito', 'Crédito por lo pagado'], ['reembolso', 'Reembolso'], ['traslado', 'Traslado a otra ronda'], ['sin_devolucion', 'Sin devolución']] },
    { nombre: 'motivo', etiqueta: 'Nota (opcional)', tipo: 'textarea' },
  ], 'Siguiente', detalle);
  if (!v) return false;
  if (v.resolucion === 'traslado') return trasladar(i.id, i.codigo, true);
  if (v.resolucion === 'reembolso' && !confirm(`¿Devolver lo pagado de ${i.codigo}? Lo de Stripe se devuelve en el momento; lo demás queda registrado y lo devuelves tú.`)) return false;
  return Boolean(await accion(() => api(`inscripciones/${i.id}/resolver`, { resolucion: v.resolucion, motivo: v.motivo || undefined }),
    { reembolso: 'Reembolso hecho.', credito: 'Crédito abonado.', sin_devolucion: 'Resuelta sin devolución.' }[v.resolucion] ?? 'Hecho.'));
}

export async function reembolsar(p: { id: string; codigo: string; importe_cent: number; metodo: string }): Promise<boolean> {
  const stripe = p.metodo.startsWith('stripe');
  const v = await formulario(`Reembolsar ${p.codigo}`, [
    { nombre: 'importe', etiqueta: 'Importe (€)', tipo: 'number', valor: String(p.importe_cent / 100), requerido: true },
    { nombre: 'motivo', etiqueta: 'Motivo', tipo: 'textarea', requerido: true },
  ], 'Reembolsar', stripe ? 'Se devuelve por Stripe al momento.' : 'Pago manual: queda registrado; la devolución la haces tú por el mismo medio.');
  if (!v) return false;
  const r = await accion(() => api<any>(`pagos/${p.id}/reembolsar`, { importe_cent: aCentimos(v.importe), motivo: v.motivo }), '');
  if (r) aviso(r.aviso ?? 'Reembolso hecho.');
  return Boolean(r);
}
