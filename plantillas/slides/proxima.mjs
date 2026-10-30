// Cierre: la próxima ronda del calendario, con fecha, circuito y dónde inscribirse.
import { documento, cabecera, pie, foto, esc, fechaPuntos } from './comun.mjs';

export default function proxima(ctx, { foto: f, siguiente }) {
  return documento(ctx, `
<style>
  .bloque { margin-top: 34px; }
  .bloque .h1 { margin-top: 10px; }
  .bloque .dato { margin-top: 14px; }
  .cta { margin-top: auto; margin-bottom: 30px; display: flex; align-items: center; justify-content: space-between; border-top: 2px solid var(--oro); padding-top: 24px; }
  .cta .t { font-weight: 700; font-size: 36px; }
  .cta .u { font-family: 'Plex Mono'; font-size: 30px; color: var(--oro); }
</style>
${cabecera(ctx)}
${foto(ctx, f, 640)}
<div class="filete"></div>
<main class="cuerpo">
  <section class="bloque">
    <div class="pre">Próxima ronda · R${siguiente.ronda}${siguiente.nota ? ` · ${esc(siguiente.nota)}` : ''}</div>
    <div class="h1" data-ajustar>${esc(siguiente.titular)}</div>
    <div class="dato">${fechaPuntos(siguiente.fecha)} · ${esc(siguiente.circuito)}</div>
  </section>
  <div class="cta"><span class="t">Inscripción abierta</span><span class="u">raceupkc.com</span></div>
</main>
${pie(ctx, '@rukc2026')}`);
}
