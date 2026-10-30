// Fotos destacadas de una categoría: una o dos fotos, apiladas (horizontales) o lado a lado (verticales).
import { documento, cabecera, pie, foto, esc, claseCategoria } from './comun.mjs';

export default function fotos(ctx, { categoria, fotos: lista, disposicion = 'apiladas' }) {
  const c = ctx.ronda.categorias.find((x) => x.nombre === categoria);
  return documento(ctx, `
${cabecera(ctx, `<b>R${ctx.ronda.ronda}</b> · ${esc(c.nombre.toUpperCase())}`)}
<div class="galeria ${disposicion}">${lista.map((f) => foto(ctx, f)).join('')}</div>
${pie(ctx)}`, claseCategoria(categoria));
}
