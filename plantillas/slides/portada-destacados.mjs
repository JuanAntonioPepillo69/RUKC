// 01 · Portada del post de destacados: misma estructura que la portada de categoría,
// con el chip blanco "Destacados" y "Lo mejor de la ronda N" en lugar del ganador.
import { documento, cabecera, pie, foto, esc, fechaPuntos } from './comun.mjs';

export default function portadaDestacados(ctx, { foto: f }) {
  const ganadores = ctx.ronda.categorias
    .map((c) => ({ cat: c.nombre, g: c.resultados?.find((x) => x.pos === 1) }))
    .filter((x) => x.g);
  return documento(ctx, `
<style>
  .titular { margin-top: 30px; }
  .titular .linea { display: flex; align-items: center; gap: 20px; }
  .titular .h1 { margin-top: 14px; }
  .titular .dato { margin-top: 10px; }
  .lema { margin-top: auto; margin-bottom: 30px; border-top: 1px solid var(--linea); padding-top: 22px; min-width: 0; }
  .lema .nombre { font-weight: 800; font-size: 56px; line-height: 1.05; white-space: nowrap; overflow: hidden; }
  .lema .gan { margin-top: 12px; white-space: nowrap; overflow: hidden; }
  .lema .gan b { color: var(--blanco); font-weight: 700; }
</style>
${cabecera(ctx, `<b>R${ctx.ronda.ronda}</b> / ${ctx.cal.rondas.length}`)}
${foto(ctx, f, 650)}
<div class="filete"></div>
<main class="cuerpo">
  <section class="titular">
    <div class="linea"><span class="chip">Destacados</span><span class="pre">Fotos y vídeo · Ronda ${ctx.ronda.ronda}</span></div>
    <div class="h1" data-ajustar>${esc(ctx.ronda.titular)}</div>
    <div class="dato">${fechaPuntos(ctx.ronda.fecha)} · ${esc(ctx.ronda.circuito)}</div>
  </section>
  <section class="lema">
    <div class="nombre">Lo mejor de la ronda ${ctx.ronda.ronda}</div>
    ${ganadores.length ? `<div class="dato gan" data-opcional>${ganadores.map((x) => `${esc(x.cat)} <b>${esc(x.g.nombre)}</b>`).join(' · ')}</div>` : ''}
  </section>
</main>
${pie(ctx, 'raceupkc.com', '<span class="flecha">Desliza <i></i></span>')}`, 'cat-destacados');
}
