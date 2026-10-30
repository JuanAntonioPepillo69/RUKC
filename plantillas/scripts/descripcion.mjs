// Descripción del post, montada solo con datos de ronda.json y del calendario.
// Estructura: ganador(es), resumen de 2-3 frases, (podios con @ si los hay), próxima ronda + CTA, hashtags.
// Sin emojis ni exclamaciones; nunca se habla de precio.
// `ronda.categorias` son las categorías de este post; `todas`, las de la ronda (para datos cruzados como un doble podio).

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const fechaLarga = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} de ${MESES[m - 1]}`;
};
const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const etiqueta = (s) => '#' + sinTildes(s).replace(/&/g, '').split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const lista = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}` : xs[0] ?? '');

const resumir = (c) => {
  const res = (c.resultados ?? []).filter((x) => x.pos !== null);
  return {
    nombre: c.nombre,
    ganador: res.find((x) => x.pos === 1),
    podio: [1, 2, 3].map((n) => res.find((x) => x.pos === n)).filter(Boolean),
    pole: res.find((x) => x.bonus?.includes('Pole')),
    vr: res.find((x) => x.bonus?.includes('VR')),
    remontada: res.filter((x) => x.remontada > 0).sort((a, b) => b.remontada - a.remontada || a.pos - b.pos)[0],
  };
};

export function descripcion({ ronda, todas = ronda.categorias, siguiente, instagram = {}, avisos }) {
  const falta = (que) => {
    avisos.push(`Descripción: falta ${que}`);
    return `[FALTA DATO: ${que}]`;
  };
  const conArroba = (p) => (instagram[p.dorsal] ? `${p.nombre} (${instagram[p.dorsal]})` : p.nombre);
  const cats = ronda.categorias.map(resumir);
  const otras = todas.filter((c) => !ronda.categorias.some((x) => x.nombre === c.nombre)).map(resumir);
  const sola = cats.length === 1;

  // 1. Primera línea: ganador(es).
  const nombreGanador = (c) => (c.ganador ? conArroba(c.ganador) : falta(`ganador ${c.nombre}`));
  const lineaGanadores = sola
    ? `${nombreGanador(cats[0])} gana la R${ronda.ronda} de ${cats[0].nombre} en ${ronda.circuito}.`
    : `${lista(cats.map((c) => `${nombreGanador(c)} en ${c.nombre}`))}: ganadores de la R${ronda.ronda} en ${ronda.circuito}.`;

  // 2. Resumen: cómo se ganó, pole y vuelta rápida, y un dato más (doble podio o remontada).
  const frases = cats.filter((c) => c.ganador).map((c) => {
    const g = c.ganador;
    const sujeto = sola ? g.nombre : `En ${c.nombre}, ${g.nombre}`;
    let f = `${sujeto} ganó ${g.salida === 1 ? 'desde la pole' : g.salida ? `saliendo ${g.salida}.º` : ''}`.trimEnd();
    if (c.vr === g) f += ` y con la vuelta rápida (${g.mejorVuelta})`;
    const extra = [];
    if (c.pole && c.pole !== g && c.pole === c.vr) extra.push(`${c.pole.nombre} hizo pole y vuelta rápida (${c.vr.mejorVuelta}) y acabó ${c.pole.pos}.º`);
    else {
      if (c.pole && c.pole !== g) extra.push(`la pole fue para ${c.pole.nombre}`);
      if (c.vr && c.vr !== g) extra.push(`la vuelta rápida, para ${c.vr.nombre} (${c.vr.mejorVuelta})`);
    }
    return `${f}${extra.length ? `; ${lista(extra)}` : ''}.`;
  });
  const cruzados = sola
    ? cats[0].podio.flatMap((p) => otras.map((o) => ({ p, o, q: o.podio.find((x) => x.dorsal === p.dorsal) })).filter((x) => x.q))
    : [];
  const dobles = !sola ? cats[0]?.podio.filter((p) => cats.slice(1).every((c) => c.podio.some((q) => q.dorsal === p.dorsal))) ?? [] : [];
  const rem = cats.filter((c) => c.remontada).map((c) => `${c.remontada.nombre}${sola ? '' : ` en ${c.nombre}`} (de ${c.remontada.salida}.º a ${c.remontada.pos}.º)`);
  if (rem.length) frases.push(`Mayor remontada: ${lista(rem)}.`);
  if (cruzados.length) frases.push(`${lista(cruzados.map(({ p, o, q }) => `${p.nombre} también hizo podio en ${o.nombre} (${q.pos}.º)`))}.`);
  else if (dobles.length) frases.push(`${lista(dobles.map((p) => p.nombre))} subió al podio en las dos categorías.`);

  // 3. Podios con etiquetas, solo si hay algún @.
  const podios = Object.keys(instagram).length
    ? cats.map((c) => `Podio${sola ? '' : ` ${c.nombre}`}: ${lista(c.podio.map(conArroba))}.`).join('\n')
    : '';

  // 4. Próxima ronda y CTA.
  const cierre = siguiente
    ? `Próxima ronda: R${siguiente.ronda}, ${fechaLarga(siguiente.fecha)}, en ${siguiente.circuito}${siguiente.nota ? ` (${siguiente.nota.toLowerCase()})` : ''}. Inscripción en el link de la bio.`
    : 'Temporada cerrada. Toda la clasificación, en el link de la bio.';

  // 5. Hashtags locales (3 a 5).
  const tags = [...new Set(['#RUKC', etiqueta(ronda.circuito), '#KartingMalaga', '#CostaDelSol'])].slice(0, 5);

  return [lineaGanadores, frases.join(' '), podios, cierre, tags.join(' ')].filter(Boolean).join('\n\n') + '\n';
}

// Descripción del post de destacados: qué es, quién ganó en cada categoría, próxima ronda + CTA y hashtags.
export function descripcionDestacados({ ronda, siguiente, avisos }) {
  const ganadores = ronda.categorias.map((c) => {
    const g = (c.resultados ?? []).find((x) => x.pos === 1);
    if (!g) avisos.push(`Descripción destacados: falta el ganador de ${c.nombre}`);
    return g ? { nombre: g.nombre, cat: c.nombre } : { nombre: `[FALTA DATO: ganador ${c.nombre}]`, cat: c.nombre };
  });
  const frase = `${ganadores[0].nombre} ganó en ${ganadores[0].cat}${ganadores.slice(1).map((g) => ` y ${g.nombre} en ${g.cat}`).join('')}.`;
  const cierre = siguiente
    ? `Próxima ronda: R${siguiente.ronda}, ${fechaLarga(siguiente.fecha)}, en ${siguiente.circuito}${siguiente.nota ? ` (${siguiente.nota.toLowerCase()})` : ''}. Inscripción en el link de la bio.`
    : 'Temporada cerrada. Toda la clasificación, en el link de la bio.';
  const tags = [...new Set(['#RUKC', etiqueta(ronda.circuito), '#KartingMalaga', '#CostaDelSol'])].slice(0, 5);
  return [`Lo mejor de la R${ronda.ronda} en ${ronda.circuito}.`, frase, cierre, tags.join(' ')].join('\n\n') + '\n';
}
