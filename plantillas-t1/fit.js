// Ajustes en página antes de capturar: estrecha (scaleX) los nombres que no caben y mide márgenes
(() => {
  for (const el of document.querySelectorAll('.fit')) {
    const w = el.scrollWidth, avail = el.clientWidth;
    if (w > avail + 0.5) { el.style.transform = `scaleX(${(avail / w).toFixed(3)})`; el.dataset.squeeze = (avail / w).toFixed(2); }
  }
  // nombres centrados (podios): caben en el ancho de su bloque
  for (const el of document.querySelectorAll('.fit1')) {
    const avail = el.parentElement.getBoundingClientRect().width - 6;
    const w = el.scrollWidth;
    if (w > avail) { const k = avail / w; el.style.transform = `scaleX(${k.toFixed(3)})`; el.style.marginLeft = el.style.marginRight = `${-(w - avail) / 2}px`; el.dataset.squeeze = k.toFixed(2); }
  }
  const out = [];
  const walker = document.createTreeWalker(document.querySelector('.slide'), NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode; if (!n.textContent.trim()) continue;
    const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect();
    if (b.width && (b.left < 59.5 || b.right > 1020.5)) out.push(n.textContent.trim().slice(0, 25) + ` [${Math.round(b.left)}-${Math.round(b.right)}]`);
  }
  const sq = [...document.querySelectorAll('[data-squeeze]')].map(e => e.textContent + ' x' + e.dataset.squeeze);
  return { margen: out, estrechados: sq };
})()
