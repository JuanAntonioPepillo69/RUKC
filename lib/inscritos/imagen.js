// Imagen semanal de inscritos (1080x1350, PNG), diseño aprobado por John el 2026-11-13 ("M"): foto de la parrilla en
// duotono oro con la ficha de fecha, categoría en oro, medidor de plazas con el recuadro de plazas libres y parrilla
// escalonada con el dorsal en placa dorada. Las plazas que faltan salen al final como huecos ("¿Podrías ser tú?" y
// "Hueco libre"). Satori (árbol de nodos → SVG) + resvg (SVG → PNG). Fuentes: tools/inscritos/fuentes.py.
import { readFileSync } from 'node:fs';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import opentype from '@shuding/opentype.js';

const W = 1080, H = 1350, P = 56;
const recurso = (nombre) => readFileSync(new URL(`./recursos/${nombre}`, import.meta.url));

// --- Marca (src/styles/global.css) ---------------------------------------------------------------------------------
const C = {
  ink: '#0a0a0b', paper: '#f6f3ec', muted: '#a6a39c', gold: '#d4a62a', goldLo: '#a9781a', goldHi: '#f4d97e', red: '#d10007',
  line: 'rgba(246,243,236,0.12)',
};
const ORO = `linear-gradient(180deg, ${C.goldHi} 0%, ${C.gold} 45%, ${C.goldLo} 100%)`;
const ACENTO = { LIG: C.gold, PES: C.red };

// --- Recursos (se cargan una vez por instancia) ------------------------------------------------------------------------
let _recursos;
function recursos() {
  if (_recursos) return _recursos;
  const fuentes = [];
  const reg = (name, base, weight) => {
    for (const sub of ['latin', 'latin-ext']) fuentes.push({ name, data: recurso(`fuentes/${base}-${sub}.ttf`), weight, style: 'normal' });
  };
  reg('ArchivoBlack', 'Archivo-Black', 900);
  reg('ArchivoExp', 'Archivo-ExpBlack', 900);
  reg('ArchivoCond', 'Archivo-CondXBold', 800);
  reg('Inter', 'Inter-Medium', 500);
  reg('Inter', 'Inter-Bold', 700);
  const cond = recurso('fuentes/Archivo-CondXBold-latin.ttf');
  _recursos = {
    fuentes,
    medidor: opentype.parse(cond.buffer.slice(cond.byteOffset, cond.byteOffset + cond.byteLength)),
    escudo: `data:image/png;base64,${recurso('escudo.png').toString('base64')}`,
    foto: `data:image/jpeg;base64,${recurso('foto-parrilla.jpg').toString('base64')}`,
  };
  return _recursos;
}

/** Tamaño de letra (px) para que el texto quepa en maxW, sin pasar de base ni bajar de min. tracking en em. */
function ajustar(texto, base, maxW, min = 16, tracking = 0) {
  const w = recursos().medidor.getAdvanceWidth(texto, base) + tracking * base * texto.length;
  return Math.max(min, Math.min(base, Math.floor((base * maxW) / w)));
}

// --- Mini JSX sin React --------------------------------------------------------------------------------------------
const limpiar = (hijos) => hijos.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== '');
const div = (style, ...hijos) => {
  const c = limpiar(hijos);
  const s = Object.fromEntries(Object.entries({ display: 'flex', ...style }).filter(([, v]) => v !== undefined));
  return { type: 'div', props: { style: s, children: c.length === 1 ? c[0] : c } };
};
const img = (src, w, h, style = {}) => ({ type: 'img', props: { src, width: w, height: h, style } });

// --- Contexto ----------------------------------------------------------------------------------------------------------
function fecha(iso) {
  const f = new Date(`${iso}T12:00:00Z`);
  const parte = (o) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', ...o }).format(f).replace('.', '');
  return { diaCorto: parte({ weekday: 'short' }).slice(0, 3), num: parte({ day: 'numeric' }), mesCorto: parte({ month: 'short' }).slice(0, 3) };
}

/**
 * Datos de una imagen: { ronda: { numero, fecha, circuito, temporada }, categoria: 'LIG'|'PES', nombreCategoria,
 * plazas, pilotos: [{ dorsal, nombre }] } (pilotos ya ordenados).
 */
function contexto(d) {
  const n = d.pilotos.length;
  return {
    cat: d.categoria, nombreCat: d.nombreCategoria, acento: ACENTO[d.categoria] ?? C.gold, pilotos: d.pilotos,
    plazas: d.plazas, n, libres: d.plazas - n,
    ronda: d.ronda.numero, circuito: d.ronda.circuito, temporada: d.ronda.temporada, f: fecha(d.ronda.fecha),
  };
}

// --- Bloques -----------------------------------------------------------------------------------------------------------
function cabecera(x, alto) {
  const { escudo, foto } = recursos();
  const nombreCat = x.nombreCat.toUpperCase();
  const catPx = Math.min(124, Math.floor((W - 2 * P - 38) / (nombreCat.length * 0.86)));
  return div({ height: alto, position: 'relative', flexDirection: 'column', justifyContent: 'space-between', padding: `${P - 10}px ${P}px 18px` },
    img(foto, W, alto, { position: 'absolute', left: 0, top: 0, objectFit: 'cover', objectPosition: 'center 30%' }),
    div({ position: 'absolute', left: 0, top: 0, width: W, height: alto, backgroundImage: 'linear-gradient(180deg, rgba(10,10,11,0.6) 0%, rgba(10,10,11,0) 30%, rgba(10,10,11,0.35) 58%, rgba(10,10,11,1) 100%)' }),
    div({ justifyContent: 'space-between', alignItems: 'flex-start' },
      div({ alignItems: 'center', gap: 14 }, img(escudo, 70, 67),
        div({ flexDirection: 'column' },
          div({ fontFamily: 'ArchivoBlack', fontSize: 28, color: C.paper, letterSpacing: 3 }, 'RUKC'),
          div({ fontFamily: 'Inter', fontWeight: 700, fontSize: 16, color: C.paper, letterSpacing: 3 }, `RACEUP KARTING CHAMPIONSHIP · ${x.temporada}`))),
      div({ flexDirection: 'column', alignItems: 'center', backgroundColor: C.paper, padding: '10px 20px 12px', minWidth: 132 },
        div({ fontFamily: 'Inter', fontWeight: 700, fontSize: 20, color: C.red, letterSpacing: 3 }, x.f.diaCorto.toUpperCase()),
        div({ fontFamily: 'ArchivoBlack', fontSize: 64, lineHeight: 1, color: C.ink }, x.f.num),
        div({ fontFamily: 'Inter', fontWeight: 700, fontSize: 20, color: C.ink, letterSpacing: 3 }, x.f.mesCorto.toUpperCase()))),
    div({ flexDirection: 'column' },
      div({ fontFamily: 'Inter', fontWeight: 700, fontSize: 26, color: C.paper, letterSpacing: 4, marginLeft: 38 }, `RONDA ${x.ronda} · ${x.circuito.toUpperCase()}`),
      div({ marginTop: 4, alignItems: 'center', gap: 22 },
        div({ width: 16, height: Math.round(catPx * 0.84), backgroundColor: x.acento }),
        div({ fontFamily: 'ArchivoExp', fontSize: catPx, lineHeight: 1, color: 'transparent', backgroundImage: ORO, backgroundClip: 'text', letterSpacing: -2 }, nombreCat))));
}

function bloquePlazas(x) {
  const libres = Math.max(0, x.libres);
  const color = x.libres <= 5 ? C.red : C.gold;
  const sub = x.libres <= 0 ? ['PARRILLA', 'COMPLETA'] : x.libres <= 5 ? ['ÚLTIMAS', libres === 1 ? 'PLAZA' : 'PLAZAS'] : [libres === 1 ? 'PLAZA' : 'PLAZAS', libres === 1 ? 'LIBRE' : 'LIBRES'];
  const celdas = Math.max(x.plazas, x.n, 1);
  const cajaW = 270, g = celdas > 40 ? 3 : 4;
  const medW = W - 2 * P - cajaW - 26;
  const w = (medW - g * (celdas - 1)) / celdas;
  return div({ alignItems: 'flex-end', gap: 26 },
    div({ flexDirection: 'column', width: medW },
      div({ fontFamily: 'Inter', fontWeight: 700, fontSize: 22, color: C.muted, letterSpacing: 2, marginBottom: 12 }, `${x.n} DE ${x.plazas} PLAZAS OCUPADAS`),
      div({ gap: g, height: 58 }, Array.from({ length: celdas }, (_, i) => div({ width: w, height: 58, transform: 'skewX(-12deg)',
        ...(i < x.n ? { backgroundImage: ORO, backgroundColor: C.gold } : { border: '2px solid rgba(246,243,236,0.35)' }) })))),
    div({ width: cajaW, height: 96, alignItems: 'center', justifyContent: 'center', gap: 14, border: `3px solid ${color}` },
      div({ fontFamily: 'ArchivoBlack', fontSize: 74, lineHeight: 1, color, letterSpacing: -2 }, String(libres)),
      div({ flexDirection: 'column', fontFamily: 'ArchivoBlack', fontSize: 23, color: C.paper, lineHeight: 1.15 }, div({}, sub[0]), div({}, sub[1]))));
}

const nCols = (n) => (n <= 32 ? 2 : 3);
const columnas = (lista, ncol) => {
  const porCol = Math.ceil(lista.length / ncol);
  return Array.from({ length: ncol }, (_, i) => lista.slice(i * porCol, (i + 1) * porCol));
};

function parrilla(x, zonaH) {
  const huecos = Array.from({ length: Math.max(0, x.libres) }, (_, i) => ({ hueco: true, nombre: i === 0 ? '¿Podrías ser tú?' : 'Hueco libre' }));
  const todos = [...x.pilotos, ...huecos];
  const ncol = nCols(todos.length);
  const gap = ncol === 2 ? 28 : 20;
  const cols = columnas(todos, ncol);
  const filas = Math.max(1, cols[0].length);
  const colW = (W - 2 * P - gap * (ncol - 1)) / ncol;
  const filaH = Math.min(84, zonaH / (filas + 0.5));
  const placaH = Math.round(filaH - 11);
  const placaW = Math.round(placaH * 1.3);
  const linea = (opacidad) => div({ height: 10, borderBottom: `3px solid ${C.paper}`, borderLeft: `3px solid ${C.paper}`, borderRight: `3px solid ${C.paper}`, opacity: opacidad });

  const casilla = (p) => {
    const nombre = p.nombre.toUpperCase();
    const px = ajustar(nombre, Math.round(placaH * 0.86), colW - placaW - 40, 14, 0.01);
    if (p.hueco) {
      const invita = nombre.startsWith('¿');
      const tono = invita ? C.gold : 'rgba(246,243,236,0.42)';
      return div({ height: filaH, width: colW, flexDirection: 'column', justifyContent: 'flex-end' },
        div({ alignItems: 'center', height: placaH, paddingLeft: 8, gap: 16, marginBottom: 3 },
          div({ width: placaW, height: placaH, alignItems: 'center', justifyContent: 'center', border: `2px dashed ${invita ? C.gold : 'rgba(246,243,236,0.4)'}`,
            fontFamily: 'ArchivoBlack', fontSize: Math.round(placaH * 0.55), color: invita ? C.gold : 'rgba(246,243,236,0.45)' }, '?'),
          div({ fontFamily: 'ArchivoCond', fontSize: px, color: tono, letterSpacing: px * 0.03 }, nombre)),
        linea(0.22));
    }
    return div({ height: filaH, width: colW, flexDirection: 'column', justifyContent: 'flex-end' },
      div({ alignItems: 'center', height: placaH, paddingLeft: 8, gap: 16, marginBottom: 3 },
        div({ width: placaW, height: placaH, alignItems: 'center', justifyContent: 'center', fontFamily: 'ArchivoBlack', fontSize: Math.round(placaH * 0.68), color: C.ink, letterSpacing: -1,
          ...(p.dorsal ? { backgroundImage: ORO, backgroundColor: C.gold } : { backgroundColor: '#2a2a2d' }) }, p.dorsal ? String(p.dorsal) : '–'),
        div({ fontFamily: 'ArchivoCond', fontSize: px, color: C.paper, letterSpacing: px * 0.01 }, nombre)),
      linea(0.45));
  };
  return div({ gap, height: zonaH }, cols.map((col, i) => div({ flexDirection: 'column', width: colW, marginTop: i % 2 === 1 ? filaH / 2 : 0 }, col.map(casilla))));
}

/** Árbol de la imagen (exportado para los tests). */
export function arbol(datos) {
  const x = contexto(datos);
  const casillas = Math.max(x.plazas, x.n);
  const FOTO = casillas > 24 ? 380 : 450;
  const zona = H - FOTO - 96 - 24 - 30 - 56 - 50;
  return div({ width: W, height: H, flexDirection: 'column', backgroundColor: C.ink },
    cabecera(x, FOTO),
    div({ flexDirection: 'column', padding: `6px ${P}px ${P - 16}px`, flex: 1 },
      bloquePlazas(x),
      div({ marginTop: 24 }, parrilla(x, zona)),
      div({ marginTop: 'auto', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'Inter', fontWeight: 500, fontSize: 21, color: C.muted },
        div({}, 'Orden alfabético · Pago confirmado'), div({ fontWeight: 700, color: C.paper }, 'Inscríbete en raceupkc.com'))));
}

/** PNG de 1080x1350 de una categoría. */
export async function generarPng(datos) {
  const svg = await satori(arbol(datos), { width: W, height: H, fonts: recursos().fuentes });
  return new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
}
