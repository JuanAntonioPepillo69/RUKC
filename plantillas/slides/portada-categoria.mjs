// 01 · Portada del post de una categoría: foto de grupo, ronda y circuito, y el ganador en grande.
import { documento, cabecera, pie, foto, hueco, esc, fechaPuntos, claseCategoria } from './comun.mjs';

export default function portadaCategoria(ctx, { categoria, foto: f }) {
  const c = ctx.ronda.categorias.find((x) => x.nombre === categoria);
  const p1 = c.resultados?.find((x) => x.pos === 1);
  return documento(ctx, `
<style>
  .titular { margin-top: 30px; }
  .titular .linea { display: flex; align-items: center; gap: 20px; }
  .titular .h1 { margin-top: 14px; }
  .titular .dato { margin-top: 10px; }
  .ganador { margin-top: auto; margin-bottom: 30px; display: flex; align-items: baseline; gap: 18px; min-width: 0; border-top: 1px solid var(--linea); padding-top: 22px; }
  .ganador .dato { flex: none; }
  .ganador .dorsal { font-size: 30px; flex: none; }
  .ganador .nombre { font-weight: 800; font-size: 56px; line-height: 1.05; min-width: 0; }
</style>
${cabecera(ctx, `<b>R${ctx.ronda.ronda}</b> / ${ctx.cal.rondas.length}`)}
${foto(ctx, f, 650)}
<div class="filete"></div>
<main class="cuerpo">
  <section class="titular">
    <div class="linea"><span class="chip">${esc(c.nombre)}</span><span class="pre">Resultados · Ronda ${ctx.ronda.ronda}</span></div>
    <div class="h1" data-ajustar>${esc(ctx.ronda.titular)}</div>
    <div class="dato">${fechaPuntos(ctx.ronda.fecha)} · ${esc(ctx.ronda.circuito)}</div>
  </section>
  <section class="ganador">
    <span class="dato">Victoria</span>
    ${p1 ? `<span class="dorsal">#${p1.dorsal}</span><span class="nombre">${esc(p1.nombre)}</span>` : hueco(ctx, `ganador ${categoria}`)}
  </section>
</main>
${pie(ctx, 'raceupkc.com', '<span class="flecha">Desliza <i></i></span>')}`, claseCategoria(categoria));
}
