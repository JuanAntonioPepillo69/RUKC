// Envío semanal a John de las dos imágenes de inscritos (Ligeros y Pesados) por WhatsApp (YCloud, API oficial), para
// que las reenvíe al grupo de pilotos. Nunca se publica en el grupo desde aquí.
// - Si John ha escrito al número RUKC en las últimas 24 h: cada imagen sale como mensaje de imagen y su pie es el texto
//   para el grupo (al reenviarla, el pie va con ella).
// - Si no: plantilla rukc_inscritos_semana (cabecera de imagen; el texto para el grupo va en una variable).
// - Si la plantilla falla (por ejemplo, aún no está aprobada): aviso de siempre (enviarAJohn) con los enlaces firmados,
//   que le llega en cuanto escriba.
// Una sola vez por ronda, día y categoría: la fila de wa_outbox con idempotency_key A4:inscritos:<ronda>:<día>:<cat>
// hace de cerrojo (automatización A4, avisos a John; no la recoge ninguna cola porque lleva plantilla y no está
// "confirmado"). forzar=true salta el cerrojo.
import { consulta } from '../db.js';
import { CATEGORIAS, hoyMadrid, parrilla, proximaRonda, sinCategoria } from './datos.js';
import { enlaceImagen } from './enlace.js';
import { textoGrupo } from './textos.js';
import { enviar as enviarYcloud } from '../whatsapp/client.js';
import { contactoJohn, enviarAJohn } from '../whatsapp/entrante.js';
import { construirPlantilla } from '../whatsapp/templates.js';

const PLANTILLA = 'rukc_inscritos_semana';
const VIGENCIA_S = 7 * 24 * 3600;

const fechaTexto = (iso) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' })
  .format(new Date(`${iso}T12:00:00Z`)).replace(',', '');

/** Lo que se va a mandar esta semana, sin enviar nada. */
export async function prepararSemana({ origen, ahora = new Date(), d = {} }) {
  const ronda = await (d.proximaRonda ?? proximaRonda)(ahora);
  if (!ronda) return null;
  const piezas = [];
  for (const c of CATEGORIAS) {
    const cat = await (d.parrilla ?? parrilla)(ronda, c);
    if (!cat) continue;
    const n = cat.pilotos.length;
    const { situacion, texto } = textoGrupo({ categoria: c, categoriaNombre: cat.nombre, ronda: ronda.numero, circuito: ronda.circuito, fecha: ronda.fecha, n, plazas: cat.plazas }, ahora);
    piezas.push({ categoria: c, nombre: cat.nombre, n, plazas: cat.plazas, situacion, texto,
      enlace: enlaceImagen(origen, ronda.id, c, { vigenciaS: VIGENCIA_S, ahora: ahora.getTime() }) });
  }
  const sin = await (d.sinCategoria ?? sinCategoria)(ronda);
  return { ronda, piezas, sinCategoria: sin };
}

/**
 * Prepara y manda las imágenes de la semana a John. Devuelve un resumen por categoría.
 * simular=true: solo prepara (enlaces y textos), no envía ni escribe nada.
 */
export async function enviarSemana({ origen, ahora = new Date(), forzar = false, simular = false, d = {} }) {
  const plan = await prepararSemana({ origen, ahora, d });
  if (!plan) return { enviado: false, motivo: 'No hay ninguna ronda próxima.' };
  const { ronda, piezas } = plan;
  const resumenRonda = `Ronda ${ronda.numero} · ${ronda.circuito} · ${fechaTexto(ronda.fecha)}`;
  if (simular) return { enviado: false, simulado: true, ronda: resumenRonda, piezas, sinCategoria: plan.sinCategoria };

  const q = d.consulta ?? consulta;
  const enviar = d.enviar ?? enviarYcloud;
  const john = await (d.contactoJohn ?? contactoJohn)();
  if (!john) return { enviado: false, motivo: 'Falta ADMIN_PHONE_E164.' };
  const dia = hoyMadrid(ahora);
  const resultados = [];

  for (const p of piezas) {
    const clave = `A4:inscritos:${ronda.id}:${dia}:${p.categoria}${forzar ? `:${ahora.getTime()}` : ''}`;
    const [cerrojo] = await q(
      `INSERT INTO wa_outbox (contact_id, automatizacion, ronda_id, plantilla, variables, enviar_at, estado, idempotency_key)
       VALUES ($1, 'A4', $2, $3, $4, now(), 'enviando', $5)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [john.contacto.id, ronda.id, PLANTILLA, JSON.stringify({ categoria: p.categoria, n: p.n, plazas: p.plazas, situacion: p.situacion }), clave]);
    if (!cerrojo) { resultados.push({ categoria: p.categoria, estado: 'ya enviado hoy' }); continue; }

    let envio, via;
    if (john.abierta) {
      via = 'imagen';
      envio = await enviar({ contacto: john.contacto, imagen: { link: p.enlace, caption: p.texto }, autor: 'sistema' });
    } else {
      via = 'plantilla';
      const libres = Math.max(0, p.plazas - p.n);
      const plantilla = construirPlantilla(PLANTILLA,
        [p.nombre, resumenRonda, `${p.n} de ${p.plazas} ocupadas, ${libres} libres`, p.texto], { imagenCabecera: p.enlace });
      envio = await enviar({ contacto: john.contacto, plantilla, autor: 'sistema' });
      if (!envio.ok) {
        // Plantilla sin aprobar o rechazada: el aviso de siempre, con el enlace (vale 7 días) y el texto.
        via = 'aviso con enlace';
        envio = await (d.enviarAJohn ?? enviarAJohn)({
          texto: `Imagen de inscritos de ${p.nombre} (${resumenRonda}): ${p.enlace}\n\nTexto para el grupo:\n${p.texto}`,
          automatizacion: 'A4', caduca: new Date(ahora.getTime() + VIGENCIA_S * 1000),
        });
      }
    }
    await q(`UPDATE wa_outbox SET estado = $2, intentos = intentos + 1, message_id = $3, ultimo_error = $4 WHERE id = $1`,
      [cerrojo.id, envio.ok ? 'enviado' : 'fallido', envio.id ?? null, envio.ok ? null : String(envio.error ?? 'error').slice(0, 300)]);
    resultados.push({ categoria: p.categoria, estado: envio.ok ? 'enviado' : 'fallido', via, n: p.n, plazas: p.plazas });
  }

  if (plan.sinCategoria > 0 && resultados.some((r) => r.estado === 'enviado')) {
    await (d.enviarAJohn ?? enviarAJohn)({
      texto: `Aviso de las imágenes de inscritos: ${plan.sinCategoria} ${plan.sinCategoria === 1 ? 'inscrito con pago no tiene' : 'inscritos con pago no tienen'} categoría asignada en la ${resumenRonda} y no salen en ninguna imagen. Asígnala en el panel.`,
      automatizacion: 'A4',
    });
  }
  return { enviado: resultados.some((r) => r.estado === 'enviado'), ronda: resumenRonda, resultados, sinCategoria: plan.sinCategoria };
}
