// Decisión D4: importa las reservas de la T2 cobradas con Stripe antes del sistema nuevo. Lee Stripe directamente
// (sin CSV) y usa el mismo flujo que el webhook (lib/flujos.js → convertirSolicitud), así que cada reserva queda con
// persona, oportunidad ganada, pedido, inscripción, pago confirmado y onboarding pendiente.
//
// - Sin --aplicar solo enseña lo que haría; con --aplicar lo escribe todo en una sola transacción.
// - Se puede repetir: una sesión ya importada se salta. Nada de lo importado se escribe en Stripe.
// - No inventa consentimientos: acepta_comunicaciones y consentimiento_medicion quedan en false.
// - "Aún no lo sé" entra sin categoría (pendiente del peso de la ficha) y no ocupa plaza hasta tenerla.
// - Las plazas de cada ronda y categoría suben en lo importado: las plazas fijadas al publicar ya las descontaban.
// - La salida no lleva datos personales: solo recuentos y códigos.
//
// Uso: node --env-file=.env.produccion db/importar-stripe.mjs [--aplicar]
// Necesita DATABASE_URL_MIGRACIONES y STRIPE_SECRET_KEY (lectura de Checkout Sessions, PaymentIntents y Charges).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';
import { guardarAtribucion } from '../lib/atribucion.js';
import { buscarOCrearPersona, convertirSolicitud } from '../lib/flujos.js';
import { normalizarTelefono } from '../lib/telefono.js';

const PRODUCTO = 'reserva-t2';
const CATEGORIAS = { Ligeros: 'LIG', Pesados: 'PES' };
const tipoMetodo = (t) => (t === 'card' ? 'stripe_tarjeta' : t === 'bizum' ? 'stripe_bizum' : 'stripe_otro');

/** De una sesión de Stripe del formulario anterior a los datos de la solicitud. Devuelve { fila } o { descartada }. */
export function interpretar(sesion, cargo) {
  const m = sesion.metadata ?? {};
  if (sesion.payment_status !== 'paid' || m.producto !== PRODUCTO) return { descartada: 'no es una reserva pagada' };
  if (cargo?.amount_refunded > 0) return { descartada: 'reembolsada' };
  const numero = Number(/^R(\d+)\b/.exec(m.ronda ?? '')?.[1]);
  if (!numero) return { descartada: 'sin ronda' };
  const email = (sesion.customer_details?.email ?? sesion.customer_email ?? '').trim().toLowerCase() || null;
  const telefono = normalizarTelefono(m.telefono);
  if (!email && !telefono) return { descartada: 'sin contacto' };
  const nombre = String(m.nombre ?? sesion.customer_details?.name ?? '').trim();
  if (!nombre) return { descartada: 'sin nombre' };
  const fecha = new Date((cargo?.created ?? sesion.created) * 1000).toISOString();
  const landing = m.origen === 'landing';
  return {
    fila: {
      sesion: sesion.id, intent: sesion.payment_intent, importe: sesion.amount_total, fecha, creada: new Date(sesion.created * 1000).toISOString(),
      nombre, email, telefono, numero, categoria: CATEGORIAS[m.categoria] ?? 'no_se',
      metodo: tipoMetodo(cargo?.payment_method_details?.type),
      origen: {
        canal: landing ? 'meta_ads' : 'web_directa', utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
        fbclid: null, landing_path: landing ? '/acceso-t2-c7e594' : '/inscripcion', referrer: null,
        fbc: m.meta === 'si' ? m.fbc || null : null, fbp: m.meta === 'si' ? m.fbp || null : null, capturada_en: new Date(sesion.created * 1000).toISOString(),
      },
    },
  };
}

async function stripe(ruta) {
  const r = await fetch(`https://api.stripe.com/v1/${ruta}`, { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(`Stripe ${r.status}: ${j.error?.message ?? 'error'}`);
  return j;
}

async function sesionesPagadas() {
  const todas = [];
  let tras = null;
  for (;;) {
    const j = await stripe(`checkout/sessions?limit=100${tras ? `&starting_after=${tras}` : ''}`);
    todas.push(...j.data.filter((s) => s.payment_status === 'paid' && s.metadata?.producto === PRODUCTO));
    if (!j.has_more) return todas;
    tras = j.data.at(-1).id;
  }
}

async function importar(c, filas) {
  const { rows: [t] } = await c.query(`SELECT id FROM temporada WHERE codigo = 'T2'`);
  const entrada = [];
  for (const f of filas) {
    const { rows: [ronda] } = await c.query('SELECT id FROM ronda WHERE temporada_id = $1 AND numero = $2', [t.id, f.numero]);
    if (!ronda) throw new Error(`No existe la ronda ${f.numero}`);
    // La persona se crea antes como importada; convertirSolicitud la encuentra por teléfono o email.
    await buscarOCrearPersona(c, { nombreCompleto: f.nombre, telefono: f.telefono, email: f.email, origen: 'importacion', creadoPor: 'sistema' });
    const { rows: [s] } = await c.query(
      `INSERT INTO solicitud_inscripcion (temporada_id, ronda_id, categoria_elegida, pagador_nombre, pagador_email, pagador_telefono, metodo_elegido, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, 'tarjeta', 'sistema') RETURNING id, codigo`,
      [t.id, ronda.id, f.categoria, f.nombre, f.email, f.telefono]);
    await guardarAtribucion(c, s.id, [f.origen]);
    await c.query(`UPDATE solicitud_inscripcion SET estado = 'enviada', stripe_checkout_session_id = $2, acepta_documentos = $3 WHERE id = $1`,
      [s.id, f.sesion, { importada: 'formulario anterior a la base de datos', nota: 'Stripe no guarda qué casillas aceptó' }]);
    const r = await convertirSolicitud(c, s.id, {
      metodo: f.metodo, importe_cent: f.importe, stripe_payment_intent_id: f.intent, stripe_checkout_session_id: f.sesion, confirmado_por: 'stripe', recibido_en: f.fecha,
    });
    if (r.sinAplicar) throw new Error(`${s.codigo}: ${r.sinAplicar} céntimos sin aplicar`);
    // Las fechas reales de la reserva, no las de la importación.
    await c.query('UPDATE solicitud_inscripcion SET creado_en = $2, enviada_en = $2, ultimo_guardado_en = $2, pagada_en = $3 WHERE id = $1', [s.id, f.creada, f.fecha]);
    await c.query(`INSERT INTO interaccion (persona_id, tipo, resumen, ocurrida_en, creado_por) VALUES ($1, 'nota', $2, now(), 'sistema')`,
      [r.pagadorId, `Reserva de ${(f.importe / 100).toFixed(2)} € importada de Stripe (${s.codigo}): se pagó con el formulario anterior.`]);
    entrada.push({ codigo: s.codigo, numero: f.numero, categoria: f.categoria });
  }
  // Plazas: suben en lo importado con categoría, para que sigan libres las que había.
  const subidas = {};
  for (const e of entrada.filter((x) => x.categoria !== 'no_se')) {
    const k = `${e.numero}|${e.categoria}`;
    subidas[k] = (subidas[k] ?? 0) + 1;
  }
  for (const [k, n] of Object.entries(subidas)) {
    const [numero, categoria] = k.split('|');
    const r = await c.query(`UPDATE cupo_ronda cr SET plazas = cr.plazas + $3 FROM ronda ro, categoria ca
      WHERE ro.id = cr.ronda_id AND ca.id = cr.categoria_id AND ro.temporada_id = $4 AND ro.numero = $1 AND ca.codigo = $2`, [Number(numero), categoria, n, t.id]);
    if (r.rowCount !== 1) throw new Error(`Sin cupo para R${numero} ${categoria}`);
  }
  return { entrada, subidas };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const aplicar = process.argv.includes('--aplicar');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_MIGRACIONES });
  const c = await pool.connect();
  try {
    const sesiones = await sesionesPagadas();
    const ya = new Set((await c.query('SELECT stripe_checkout_session_id AS s FROM pago WHERE stripe_checkout_session_id IS NOT NULL')).rows.map((r) => r.s));
    const filas = [];
    const descartadas = {};
    let saltadas = 0;
    for (const s of sesiones) {
      if (ya.has(s.id)) { saltadas++; continue; }
      const pi = await stripe(`payment_intents/${s.payment_intent}?expand[]=latest_charge`);
      const { fila, descartada } = interpretar(s, pi.latest_charge);
      if (fila) filas.push(fila); else descartadas[descartada] = (descartadas[descartada] ?? 0) + 1;
    }
    filas.sort((a, b) => a.fecha.localeCompare(b.fecha));
    const porCategoria = filas.reduce((a, f) => { const k = `R${f.numero} ${f.categoria}`; a[k] = (a[k] ?? 0) + 1; return a; }, {});
    console.log(`En Stripe: ${sesiones.length} · ya importadas: ${saltadas} · por importar: ${filas.length} (${filas.reduce((a, f) => a + f.importe, 0) / 100} €)`);
    console.log('Por ronda y categoría:', porCategoria, '· sin teléfono válido:', filas.filter((f) => !f.telefono).length, '· descartadas:', descartadas);
    if (!aplicar) console.log('Sin --aplicar: no se ha escrito nada.');
    else if (filas.length) {
      await c.query('BEGIN');
      await c.query("SELECT set_config('rukc.actor', 'sistema', true)");
      const r = await importar(c, filas);
      await c.query('COMMIT');
      console.log(`Importadas ${r.entrada.length}: ${r.entrada.map((e) => e.codigo).join(', ')} · plazas subidas:`, r.subidas);
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
}
