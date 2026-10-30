// Podio de una categoría: foto del podio y los tres primeros con sus puntos de la ronda.
import { documento, cabecera, pie, foto, hueco, esc, claseCategoria } from './comun.mjs';

export default function podio(ctx, { categoria, foto: f }) {
  const c = ctx.ronda.categorias.find((x) => x.nombre === categoria);
  const peldanos = [1, 2, 3].map((n) => {
    const p = c.resultados?.find((x) => x.pos === n);
    if (!p) return `<div class="peldano p${n}"><span class="n">${n}</span><span class="quien">${hueco(ctx, `P${n} ${categoria}`)}</span><span></span></div>`;
    const badges = (p.bonus ?? []).map((b) => `<span class="badge">${esc(b)}</span>`).join('');
    return `
    <div class="peldano p${n}">
      <span class="n">${n}</span>
      <span class="quien"><span class="dorsal">#${p.dorsal}</span><span class="nombre">${esc(p.nombre)}</span>${badges}</span>
      <span class="pts">${p.puntos ? `<b>${esc(p.puntos)}</b> pts` : hueco(ctx, `puntos P${n}`)}</span>
    </div>`;
  }).join('');
  return documento(ctx, `
<style>
  .titulo { display: flex; align-items: center; gap: 22px; margin-top: 34px; }
</style>
${cabecera(ctx)}
${foto(ctx, f, 640)}
<div class="filete"></div>
<main class="cuerpo">
  <div class="titulo"><span class="chip">${esc(c.nombre)}</span><span class="pre">Podio</span></div>
  <section class="podio-lista">${peldanos}</section>
</main>
${pie(ctx)}`, claseCategoria(categoria));
}
