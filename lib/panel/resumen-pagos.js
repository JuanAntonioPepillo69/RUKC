// Resumen de lo cobrado para la pantalla "Hoy": por día, semana (lunes a domingo) y mes, en hora de Madrid.
// Cuenta los pagos confirmados por el día en que entraron y resta los reembolsos el día en que se emitieron.

const grupo = (metodo) => {
  if (metodo === 'stripe_bizum' || metodo === 'bizum_manual') return 'bizum';
  return metodo.startsWith('stripe_') ? 'tarjeta' : 'otros';
};
const utc = (iso) => new Date(`${iso}T12:00:00Z`);
const texto = (d) => d.toISOString().slice(0, 10);
const sumarDias = (iso, n) => texto(new Date(utc(iso).getTime() + n * 864e5));
const lunes = (iso) => sumarDias(iso, -((utc(iso).getUTCDay() + 6) % 7));
const inicioMes = (iso) => `${iso.slice(0, 7)}-01`;
const mesAnterior = (iso) => inicioMes(sumarDias(inicioMes(iso), -1));
const finMes = (iso) => sumarDias(inicioMes(sumarDias(inicioMes(iso), 32)), -1);

function sumar(filas, desde, hasta) {
  const r = { n: 0, cent: 0, tarjeta_cent: 0, bizum_cent: 0, otros_cent: 0, reembolsado_cent: 0 };
  for (const f of filas) {
    if ((desde && f.dia < desde) || (hasta && f.dia > hasta)) continue;
    const neto = f.entrado_cent - f.reembolsado_cent;
    r.n += f.n;
    r.cent += neto;
    r[`${grupo(f.metodo)}_cent`] += neto;
    r.reembolsado_cent += f.reembolsado_cent;
  }
  return r;
}

/** filas: { dia 'YYYY-MM-DD', metodo, n, entrado_cent, reembolsado_cent }; hoy: 'YYYY-MM-DD' en Madrid. */
export function agruparPagos(filas, hoy) {
  const lun = lunes(hoy);
  const mes = inicioMes(hoy);
  const dias = Array.from({ length: 14 }, (_, i) => {
    const dia = sumarDias(hoy, -i);
    return { desde: dia, hasta: dia, ...sumar(filas, dia, dia) };
  });
  const semanas = Array.from({ length: 8 }, (_, i) => {
    const desde = sumarDias(lun, -7 * i);
    const hasta = sumarDias(desde, 6);
    return { desde, hasta, ...sumar(filas, desde, hasta) };
  });
  const meses = [];
  for (let m = mes, i = 0; i < 12; m = mesAnterior(m), i++) {
    const fila = { desde: m, hasta: finMes(m), ...sumar(filas, m, finMes(m)) };
    if (fila.n || fila.reembolsado_cent || m === mes) meses.push(fila);
  }
  return {
    hoy,
    periodos: {
      hoy: sumar(filas, hoy, hoy),
      ayer: sumar(filas, sumarDias(hoy, -1), sumarDias(hoy, -1)),
      semana: sumar(filas, lun, hoy),
      semana_pasada: sumar(filas, sumarDias(lun, -7), sumarDias(lun, -1)),
      mes: sumar(filas, mes, hoy),
      mes_pasado: sumar(filas, mesAnterior(mes), sumarDias(mes, -1)),
      total: sumar(filas),
    },
    dias, semanas, meses,
  };
}

export async function resumenPagos({ tx }) {
  return tx(async (c) => {
    const { rows } = await c.query(`
      WITH mov AS (
        SELECT (coalesce(recibido_en, confirmado_en, creado_en) AT TIME ZONE 'Europe/Madrid')::date AS dia, metodo, 1 AS n,
               importe_cent AS entrado_cent, 0 AS reembolsado_cent
          FROM pago WHERE estado IN ('confirmado', 'reembolsado_parcial', 'reembolsado')
        UNION ALL
        SELECT (r.emitido_en AT TIME ZONE 'Europe/Madrid')::date, p.metodo, 0, 0, r.importe_cent
          FROM reembolso r JOIN pago p ON p.id = r.pago_id WHERE r.estado = 'emitido'
      )
      SELECT dia::text AS dia, metodo, sum(n)::int AS n, sum(entrado_cent)::int AS entrado_cent, sum(reembolsado_cent)::int AS reembolsado_cent
      FROM mov GROUP BY 1, 2 ORDER BY 1`);
    const { rows: [{ hoy }] } = await c.query(`SELECT (now() AT TIME ZONE 'Europe/Madrid')::date::text AS hoy`);
    return agruparPagos(rows, hoy);
  });
}
