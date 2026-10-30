// Clasificación del campeonato en una categoría, tal como la publica la web.
import { documento, cabecera, pie, hueco, esc, claseCategoria } from './comun.mjs';

const COLUMNAS = '88px 1fr 150px 110px';

export default function clasificacion(ctx, { categoria, filas, pagina, paginas }) {
  const c = ctx.ronda.categorias.find((x) => x.nombre === categoria);
  const haySorteo = filas.some((f) => f.empateSorteo);
  const cuerpoTabla = !filas.length
    ? `<div style="margin-top:30px">${hueco(ctx, `clasificación ${categoria}`)}</div>`
    : filas.map((f) => `
    <div class="fila${f.pos <= 3 ? ' podio' : ''}" style="grid-template-columns:${COLUMNAS}">
      <span class="pos">${f.pos}${f.empateSorteo ? '*' : ''}</span>
      <span class="quien"><span class="dorsal">#${f.dorsal}</span><span class="nombre">${esc(f.nombre)}</span></span>
      <span class="num">${f.victorias || '–'}</span>
      <span class="pts">${esc(f.puntos)}</span>
    </div>`).join('');
  return documento(ctx, `
${cabecera(ctx)}
<main class="cuerpo">
  <div class="titulo-tabla">
    <div class="linea"><span class="chip">${esc(c.nombre)}</span><span class="dato">Tras R${ctx.ronda.ronda}${paginas > 1 ? ` · ${pagina} / ${paginas}` : ''}</span></div>
    <div class="h2">Campeonato</div>
  </div>
  <section class="tabla">
    <div class="fila cabecera" style="grid-template-columns:${COLUMNAS}"><span>Pos</span><span>Piloto</span><span class="num">Victorias</span><span class="pts">Pts</span></div>
    ${cuerpoTabla}
  </section>
  ${haySorteo ? '<div class="leyenda">* Empate total: se resuelve por sorteo (Art. 49)</div>' : ''}
</main>
${pie(ctx)}`, claseCategoria(categoria));
}
