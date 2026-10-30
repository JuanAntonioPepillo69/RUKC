// 01 · Portada: foto de grupo, ronda y circuito, y el ganador de cada categoría.
import { documento, cabecera, pie, foto, hueco, esc, fechaPuntos, claseCategoria } from './comun.mjs';

export default function portada(ctx, { foto: f }) {
  const ganadores = ctx.ronda.categorias.map((c) => {
    const p1 = c.resultados?.find((x) => x.pos === 1);
    return `
    <div class="ganador ${claseCategoria(c.nombre)}">
      <div class="cat-linea"><span class="chip">${esc(c.nombre)}</span><span class="dato">Victoria</span></div>
      <div class="gan-nombre">${p1 ? `<span class="dorsal">#${p1.dorsal}</span> <span class="nombre">${esc(p1.nombre)}</span>` : hueco(ctx, `ganador ${c.nombre}`)}</div>
    </div>`;
  }).join('');

  return documento(ctx, `
<style>
  .titular { margin-top: 30px; }
  .titular .h1 { margin-top: 8px; }
  .titular .dato { margin-top: 12px; }
  .ganadores { margin-top: auto; margin-bottom: 30px; display: grid; grid-template-columns: 1fr 1fr; column-gap: 40px; }
  .cat-linea { display: flex; align-items: center; gap: 16px; }
  .gan-nombre { margin-top: 14px; display: flex; align-items: baseline; gap: 14px; min-width: 0; }
  .gan-nombre .dorsal { font-size: 30px; flex: none; }
  .gan-nombre .nombre { font-weight: 800; font-size: 44px; line-height: 1.1; min-width: 0; }
</style>
${cabecera(ctx, `<b>R${ctx.ronda.ronda}</b> / ${ctx.cal.rondas.length}`)}
${foto(ctx, f, 690)}
<div class="filete"></div>
<main class="cuerpo">
  <section class="titular">
    <div class="pre">Resultados · Ronda ${ctx.ronda.ronda}</div>
    <div class="h1" data-ajustar>${esc(ctx.ronda.titular)}</div>
    <div class="dato">${fechaPuntos(ctx.ronda.fecha)} · ${esc(ctx.ronda.circuito)}</div>
  </section>
  <section class="ganadores">${ganadores}</section>
</main>
${pie(ctx, 'raceupkc.com', '<span class="flecha">Desliza <i></i></span>')}`);
}
