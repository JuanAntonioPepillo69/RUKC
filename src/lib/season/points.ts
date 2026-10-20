// Cálculo de puntos y clasificaciones según el reglamento deportivo v1.1 (Título VIII).
// Funciones puras: reciben la temporada leída de la hoja y devuelven tablas listas para pintar.
import type { Categoria, Resultado, Ronda, Temporada } from './types.ts';

/** Art. 46: puntos por posición del 1.º al 10.º. Del 11.º en adelante, 1 punto por finalizar. */
export const PUNTOS_POSICION = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const PUNTOS_FINALIZAR = 1;
/** Art. 47: bonificaciones. */
export const BONUS = { pole: 2, vueltaRapida: 2, constancia: 3 };
/** Art. 45: pasaporte de puntos de penalización. */
export const PP_LIMITE = 12;
export const PP_DIAS = 365;

export interface FilaRonda {
  dorsal: number;
  nombre: string;
  /** Posición final dentro de la categoría (1, 2, 3...). null = no clasificado o DSQ. */
  pos: number | null;
  salida: number | null;
  finaliza: boolean;
  dsq: boolean;
  puntosPosicion: number;
  bonus: { pole: number; vueltaRapida: number; constancia: number };
  puntos: number;
  remontada: number | null;
  mejorVuelta: string;
}

export interface FilaCampeonato {
  pos: number;
  dorsal: number;
  nombre: string;
  /** Puntos en cada ronda puntuable (en el orden de rondasPuntuables). null = no corrió en esta categoría. */
  porRonda: (number | null)[];
  bruto: number;
  neto: number;
  /** Índice dentro de porRonda de la ronda descartada, si se aplica el descarte. */
  descartada: number | null;
  victorias: number;
  poles: number;
  vueltasRapidas: number;
  /** Empate total tras todos los criterios del Art. 49: se resuelve por sorteo ante el Comité. */
  sorteo: boolean;
}

const redondeo = (n: number) => Math.round(n * 100) / 100;

export const nombreDe = (t: Temporada, dorsal: number) =>
  t.pilotos.find((p) => p.dorsal === dorsal)?.nombre ?? `Dorsal ${dorsal}`;

/** Rondas que reparten puntos: disputadas y cuya final no fue nula. */
export const rondasPuntuables = (t: Temporada): Ronda[] =>
  t.rondas.filter((r) => r.estado === 'disputada' && r.carrera !== 'nula').sort((a, b) => a.ronda - b.ronda);

/** Clasificación de una ronda en una categoría, con los puntos de cada piloto. */
export function clasificacionRonda(t: Temporada, ronda: number, categoria: Categoria): FilaRonda[] {
  const r = t.rondas.find((x) => x.ronda === ronda);
  const filas = t.resultados.filter((x) => x.ronda === ronda && x.categoria === categoria);
  const carrera = r?.carrera ?? 'completa';

  // La posición se recalcula dentro de la categoría: así también vale una clasificación conjunta (R1, Disposición transitoria)
  const clasificados = filas.filter((x) => !x.dsq && x.posicion !== null).sort((a, b) => a.posicion! - b.posicion!);
  const rank = new Map<Resultado, number>(clasificados.map((x, i) => [x, i + 1]));

  const out = filas.map<FilaRonda>((x) => {
    const pos = rank.get(x) ?? null;
    let puntosPosicion = 0;
    if (pos !== null && x.finaliza && carrera !== 'nula') {
      puntosPosicion = pos <= PUNTOS_POSICION.length ? PUNTOS_POSICION[pos - 1] : PUNTOS_FINALIZAR;
      if (carrera === 'mitad') puntosPosicion /= 2; // Art. 31 quater
    }
    const conBonus = !x.dsq && !x.pierdeBonus && carrera !== 'nula';
    const bonus = {
      pole: conBonus && x.pole ? BONUS.pole : 0,
      // Con media carrera no hay vuelta rápida ni constancia (Art. 31 quater)
      vueltaRapida: conBonus && carrera === 'completa' && x.vueltaRapida ? BONUS.vueltaRapida : 0,
      // La constancia solo se otorga si el piloto finaliza (Art. 47)
      constancia: conBonus && carrera === 'completa' && x.finaliza && x.constancia ? BONUS.constancia : 0,
    };
    return {
      dorsal: x.dorsal,
      nombre: nombreDe(t, x.dorsal),
      pos,
      salida: x.salida,
      finaliza: x.finaliza,
      dsq: x.dsq,
      puntosPosicion: redondeo(puntosPosicion),
      bonus,
      puntos: redondeo(puntosPosicion + bonus.pole + bonus.vueltaRapida + bonus.constancia),
      remontada: pos !== null && x.salida !== null ? x.salida - pos : null,
      mejorVuelta: x.mejorVuelta,
    };
  });
  // Clasificados primero; después no clasificados y descalificados
  return out.sort((a, b) => (a.pos ?? 999) - (b.pos ?? 999) || Number(a.dsq) - Number(b.dsq) || a.dorsal - b.dorsal);
}

/** ¿Se aplica ya el descarte del Art. 48? */
export function descarteActivo(t: Temporada): boolean {
  if (t.config.descarte === 'si') return true;
  if (t.config.descarte === 'no') return false;
  const vivas = t.rondas.filter((r) => r.estado !== 'cancelada');
  return vivas.length > 0 && vivas.every((r) => r.estado === 'disputada');
}

/** Campeonato de una categoría (Arts. 48 a 50). */
export function campeonato(t: Temporada, categoria: Categoria): { rondas: Ronda[]; filas: FilaCampeonato[]; descarte: boolean } {
  const rondas = rondasPuntuables(t);
  const descarte = descarteActivo(t);
  const porRonda = rondas.map((r) => new Map(clasificacionRonda(t, r.ronda, categoria).map((f) => [f.dorsal, f])));

  const dorsales = [...new Set(t.resultados.filter((x) => x.categoria === categoria && rondas.some((r) => r.ronda === x.ronda)).map((x) => x.dorsal))];

  const filas = dorsales.map((dorsal) => {
    const celdas = porRonda.map((m) => m.get(dorsal) ?? null);
    const pts = celdas.map((c) => (c ? c.puntos : null));
    const bruto = redondeo(pts.reduce<number>((s, p) => s + (p ?? 0), 0));
    let descartada: number | null = null;
    if (descarte && rondas.length > 1) {
      // Se descarta la ronda con menos puntos; las no disputadas valen 0 y sí se pueden descartar.
      // No se puede descartar una ronda con exclusión o descalificación por sanción (Art. 48 c).
      let min = Infinity;
      celdas.forEach((c, i) => {
        if (c?.dsq) return;
        const p = c?.puntos ?? 0;
        if (p < min) { min = p; descartada = i; }
      });
    }
    const neto = redondeo(bruto - (descartada !== null ? pts[descartada] ?? 0 : 0));
    return {
      pos: 0, dorsal, nombre: nombreDe(t, dorsal), porRonda: pts, bruto, neto, descartada,
      victorias: celdas.filter((c) => c?.pos === 1).length,
      poles: celdas.filter((c) => (c?.bonus.pole ?? 0) > 0).length,
      vueltasRapidas: celdas.filter((c) => (c?.bonus.vueltaRapida ?? 0) > 0).length,
      sorteo: false,
      _pos: celdas.map((c) => c?.pos ?? null),
    };
  });

  // Desempates del Art. 49
  const cmp = (a: (typeof filas)[number], b: (typeof filas)[number]) => {
    if (b.neto !== a.neto) return b.neto - a.neto;
    if (b.bruto !== a.bruto) return b.bruto - a.bruto; // 1. más puntos sin descarte
    // 2 y 3. más victorias, luego más segundos puestos, terceros...
    const maxPos = Math.max(0, ...filas.flatMap((f) => f._pos.filter((p): p is number => p !== null)));
    for (let p = 1; p <= maxPos; p++) {
      const ca = a._pos.filter((x) => x === p).length, cb = b._pos.filter((x) => x === p).length;
      if (ca !== cb) return cb - ca;
    }
    // 4. mejor resultado en la última prueba en la que participaron ambos
    for (let i = rondas.length - 1; i >= 0; i--) {
      const pa = a._pos[i], pb = b._pos[i];
      if (a.porRonda[i] !== null && b.porRonda[i] !== null) {
        if (pa !== pb) return (pa ?? 999) - (pb ?? 999);
        break;
      }
    }
    // 5. más poles
    if (b.poles !== a.poles) return b.poles - a.poles;
    return 0; // 6. sorteo ante el Comité
  };
  filas.sort((a, b) => cmp(a, b) || a.dorsal - b.dorsal);
  filas.forEach((f, i) => {
    const prev = filas[i - 1];
    if (prev && cmp(prev, f) === 0) { f.pos = prev.pos; f.sorteo = prev.sorteo = true; } else f.pos = i + 1;
  });
  return { rondas, filas: filas.map(({ _pos, ...f }) => f), descarte };
}

/** Saldo de puntos de penalización de los últimos 12 meses (Art. 45). */
export function pasaporte(t: Temporada, hoy = new Date()) {
  const desde = new Date(hoy.getTime() - PP_DIAS * 86400000).toISOString().slice(0, 10);
  const saldo = new Map<number, number>();
  for (const s of t.sanciones) if (s.fecha >= desde && s.fecha <= hoy.toISOString().slice(0, 10)) saldo.set(s.dorsal, (saldo.get(s.dorsal) ?? 0) + s.pp);
  return [...saldo.entries()]
    .filter(([, pp]) => pp > 0)
    .map(([dorsal, pp]) => ({ dorsal, nombre: nombreDe(t, dorsal), pp, alcanzaLimite: pp >= PP_LIMITE }))
    .sort((a, b) => b.pp - a.pp || a.dorsal - b.dorsal);
}

export interface MencionRonda { titulo: string; categoria: Categoria | null; pilotos: { dorsal: number; nombre: string }[]; texto: string; auto: boolean }

/** Menciones de una ronda: las automáticas (pole, vuelta rápida, constancia, mayor remontada) más las de la hoja. */
export function mencionesRonda(t: Temporada, ronda: number): MencionRonda[] {
  const out: MencionRonda[] = [];
  const quien = (f: FilaRonda) => ({ dorsal: f.dorsal, nombre: f.nombre });
  for (const categoria of ['Ligeros', 'Pesados'] as Categoria[]) {
    const filas = clasificacionRonda(t, ronda, categoria);
    if (!filas.length) continue;
    const add = (titulo: string, ps: FilaRonda[], texto = '') => { if (ps.length) out.push({ titulo, categoria, pilotos: ps.map(quien), texto, auto: true }); };
    add('Pole position', filas.filter((f) => f.bonus.pole > 0));
    add('Vuelta rápida', filas.filter((f) => f.bonus.vueltaRapida > 0));
    add('Constancia', filas.filter((f) => f.bonus.constancia > 0), 'Menos de 300 ms entre su vuelta más rápida y la más lenta en 10 vueltas seguidas.');
    const best = Math.max(0, ...filas.map((f) => f.remontada ?? 0));
    if (best > 0) add('Mayor remontada', filas.filter((f) => f.remontada === best), `${best} posiciones ganadas desde la salida.`);
  }
  for (const m of t.menciones.filter((x) => x.ronda === ronda)) {
    out.push({ titulo: m.titulo, categoria: null, pilotos: m.dorsal !== null ? [{ dorsal: m.dorsal, nombre: nombreDe(t, m.dorsal) }] : [], texto: m.texto, auto: false });
  }
  return out;
}
