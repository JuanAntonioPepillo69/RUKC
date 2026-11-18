// Piezas de interfaz compartidas por la reserva y la ficha: la calculadora de peso de competición y el aviso de a qué
// se compromete el piloto al elegir categoría. El marcado está en src/components/GuiaPeso.astro.
import { COMPROMISO, COMPROMISO_COMUN, estimarPeso, kgTexto, textoEstimacion, type ComoTePesas } from './peso';

/** Conecta una calculadora (GuiaPeso.astro) dentro de `raiz`. `alUsar` recibe el peso sugerido, si la página lo usa. */
export function montarCalculadora(raiz: HTMLElement, alUsar?: (kg: number) => void) {
  const bascula = raiz.querySelector<HTMLInputElement>('[data-calc-bascula]')!;
  const como = raiz.querySelector<HTMLSelectElement>('[data-calc-como]')!;
  const res = raiz.querySelector<HTMLElement>('[data-calc-res]')!;
  const usar = raiz.querySelector<HTMLButtonElement>('[data-calc-usar]');
  let sugerido: number | null = null;
  const pintar = () => {
    const e = estimarPeso(Number(bascula.value.replace(',', '.')), como.value as ComoTePesas);
    res.textContent = e ? textoEstimacion(e) : '';
    sugerido = e?.sugerido ?? null;
    if (usar) {
      usar.hidden = !e || !alUsar;
      if (e) usar.textContent = `Poner ${kgTexto(e.sugerido)} como mi peso de competición`;
    }
  };
  bascula.addEventListener('input', pintar);
  como.addEventListener('change', pintar);
  usar?.addEventListener('click', () => { if (sugerido != null) alUsar?.(sugerido); });
  pintar();
}

/** Pinta en `caja` a qué se compromete quien elige `categoria` (LIG o PES); cualquier otro valor la oculta. */
export function pintarCompromiso(caja: HTMLElement, categoria: string | null | undefined) {
  const puntos = categoria === 'LIG' || categoria === 'PES' ? COMPROMISO[categoria] : null;
  caja.hidden = !puntos;
  if (!puntos) return;
  const titulo = Object.assign(document.createElement('strong'), { textContent: `Si eliges ${categoria === 'LIG' ? 'Ligeros' : 'Pesados'}, te comprometes a esto:` });
  const ul = document.createElement('ul');
  ul.append(...puntos.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  caja.replaceChildren(titulo, ul, Object.assign(document.createElement('p'), { textContent: COMPROMISO_COMUN }));
}
