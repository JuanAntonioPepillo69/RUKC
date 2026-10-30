// Resultados de la ronda en una categoría. El generador reparte las filas en páginas (máx. 10).
import { documento, cabecera, pie, hueco, esc, claseCategoria } from './comun.mjs';

const COLUMNAS = '88px 1fr 214px 96px';

export default function resultados(ctx, { categoria, filas, pagina, paginas }) {
  const c = ctx.ronda.categorias.find((x) => x.nombre === categoria);
  const hayBonus = filas.some((f) => f.bonus?.length);
  const cuerpoTabla = filas.map((f) => {
    const podio = f.pos !== null && f.pos <= 3;
    const badges = (f.bonus ?? []).map((b) => `<span class="badge">${esc(b)}</span>`).join('');
    return `
    <div class="fila${podio ? ' podio' : ''}${f.pos === null ? ' fuera' : ''}" style="grid-template-columns:${COLUMNAS}">
      <span class="pos">${f.pos ?? esc(f.estado || 'NC')}</span>
      <span class="quien"><span class="dorsal">#${f.dorsal}</span><span class="nombre">${f.nombre ? esc(f.nombre) : hueco(ctx, 'nombre')}</span>${badges}</span>
      <span class="num">${f.mejorVuelta ? esc(f.mejorVuelta) : '–'}</span>
      <span class="pts">${f.puntos !== '' && f.puntos != null ? esc(f.puntos) : hueco(ctx, `puntos #${f.dorsal}`)}</span>
    </div>`;
  }).join('');
  return documento(ctx, `
${cabecera(ctx)}
<main class="cuerpo">
  <div class="titulo-tabla">
    <div class="linea"><span class="chip">${esc(c.nombre)}</span>${paginas > 1 ? `<span class="dato">${pagina} / ${paginas}</span>` : ''}</div>
    <div class="h2">Resultados</div>
  </div>
  <section class="tabla">
    <div class="fila cabecera" style="grid-template-columns:${COLUMNAS}"><span>Pos</span><span>Piloto</span><span class="num">Mejor vuelta</span><span class="pts">Pts</span></div>
    ${cuerpoTabla}
  </section>
  ${hayBonus ? '<div class="leyenda">Pole y VR (vuelta rápida): +2 pts</div>' : ''}
</main>
${pie(ctx)}`, claseCategoria(categoria));
}
