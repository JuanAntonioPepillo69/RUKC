// La carrera: la mejor foto de carrera de la categoría y sus datos clave (pole, vuelta rápida, remontada).
import { documento, cabecera, pie, foto, esc, claseCategoria } from './comun.mjs';

export default function apertura(ctx, { categoria, foto: f }) {
  const c = ctx.ronda.categorias.find((x) => x.nombre === categoria);
  const res = c.resultados ?? [];
  const pole = res.find((x) => x.bonus?.includes('Pole'));
  const vr = res.find((x) => x.bonus?.includes('VR'));
  const rem = res.filter((x) => x.pos !== null && x.remontada > 0).sort((a, b) => b.remontada - a.remontada || a.pos - b.pos)[0];
  const quien = (p) => `<span class="dorsal">#${p.dorsal}</span><span class="nombre">${esc(p.nombre)}</span>`;
  const filas = [
    pole && ['Pole', quien(pole), ''],
    vr && ['Vuelta rápida', quien(vr), esc(vr.mejorVuelta ?? '')],
    rem && ['Remontada', quien(rem), `${rem.salida}.º a ${rem.pos}.º`],
  ].filter(Boolean);
  const detalle = [c.peso, `${res.length} pilotos`].filter(Boolean).join(' · ');
  return documento(ctx, `
<style>
  .titulo { display: flex; align-items: center; gap: 20px; margin-top: 30px; }
  .detalle { margin-top: 16px; }
  .datos { margin-top: 14px; }
  .datos .fila { display: grid; grid-template-columns: 290px 1fr auto; align-items: center; height: 76px; border-bottom: 1px solid var(--linea); }
  .datos .quien { display: flex; align-items: baseline; gap: 16px; min-width: 0; }
  .datos .dorsal { font-size: 30px; flex: none; }
  .datos .nombre { font-weight: 700; font-size: 38px; min-width: 0; }
  .datos .extra { font-family: 'Plex Mono'; font-size: 30px; color: var(--blanco); padding-left: 18px; white-space: nowrap; }
</style>
${cabecera(ctx)}
${foto(ctx, f, 680)}
<div class="filete"></div>
<main class="cuerpo">
  <div class="titulo"><span class="chip">${esc(c.nombre)}</span><span class="pre">La carrera</span></div>
  <section class="datos">${filas.map(([t, q, e]) => `<div class="fila"><span class="dato">${t}</span><span class="quien">${q}</span><span class="extra">${e}</span></div>`).join('')}</section>
  <div class="dato detalle">${esc(detalle)}</div>
</main>
${pie(ctx)}`, claseCategoria(categoria));
}
