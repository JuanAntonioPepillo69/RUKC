// Piezas comunes a todas las slides: documento, cabecera, pie, foto y hueco de dato.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export const SISTEMA = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const fechaPuntos = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

export const claseCategoria = (nombre) => `cat-${String(nombre).toLowerCase()}`;

/** Muestra un dato que falta como hueco visible y lo apunta en la lista de avisos. */
export const hueco = (ctx, que) => {
  ctx.avisos.push(`Falta dato: ${que} (slide ${ctx.slide})`);
  return `<span class="hueco">FALTA DATO: ${esc(que)}</span>`;
};

export const documento = (ctx, cuerpo, clase = '') => `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<base href="${pathToFileURL(SISTEMA).href}/">
<link rel="stylesheet" href="sistema.css">
</head>
<body class="${clase}">
${cuerpo}
</body>
</html>
`;

export const cabecera = (ctx, derecha) => `
<header class="cab">
  <div class="marca">
    <img src="marca/escudo.png" alt="">
    <div><div class="m1">RUKC</div><div class="m2">TEMPORADA ${esc(ctx.cal.temporada)}</div></div>
  </div>
  <div class="ctx">${derecha ?? `<b>R${ctx.ronda.ronda}</b> · ${esc(ctx.ronda.titular.toUpperCase())}`}</div>
</header>`;

export const pie = (ctx, izquierda = 'raceupkc.com', derecha) => `
<footer class="pie">
  <span>${izquierda}</span>
  <span>${derecha ?? `${String(ctx.slide).padStart(2, '0')} / ${String(ctx.totalSlides).padStart(2, '0')}`}</span>
</footer>`;

/**
 * Foto en bloque. `f` es una ruta relativa a la carpeta de la carrera o un objeto
 * { archivo, foco, zoom }: foco = object-position CSS ("50% 40%"), zoom = 1.0 a 2.0.
 */
export const foto = (ctx, f, alto) => {
  if (!f) return `<div class="foto" style="height:${alto}px; display:flex; align-items:center; justify-content:center">${hueco(ctx, 'foto')}</div>`;
  const o = typeof f === 'string' ? { archivo: f } : f;
  const url = pathToFileURL(path.resolve(ctx.carpeta, o.archivo)).href;
  const foco = o.foco ?? '50% 50%';
  const zoom = o.zoom ? `transform: scale(${o.zoom}); transform-origin: ${foco};` : '';
  return `<div class="foto"${alto ? ` style="height:${alto}px"` : ''}><img src="${url}" style="object-position:${foco}; ${zoom}" alt=""></div>`;
};

export const nombreCompleto = (ctx, fila) => fila?.nombre ? esc(fila.nombre) : hueco(ctx, 'nombre');
