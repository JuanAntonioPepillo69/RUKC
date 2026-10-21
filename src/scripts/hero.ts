// Hero: dibuja en un canvas el frame que corresponde al scroll, sincroniza los titulares
// y mueve las etiquetas para que sigan a la pieza señalada (posiciones exportadas por la escena).
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

type Variant = { frames: number; width: number; height: number };
type Manifest = {
  version: string;
  variants: Record<'d' | 'm', Variant>;
  cues: Record<string, number | number[]>;
};
type Anchors = Record<string, number[]>;

const BG = '#0a0a0b';
const CONCURRENCY = 6;

export function initHero(root: HTMLElement) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const manifest: Manifest = JSON.parse(root.dataset.manifest!);
  const key: 'd' | 'm' = innerWidth / innerHeight < 0.9 && innerWidth < 900 ? 'm' : 'd';
  const v = manifest.variants[key];
  const url = (i: number) => `/hero/${key}/${String(i + 1).padStart(3, '0')}.webp?v=${manifest.version}`;

  const canvas = root.querySelector<HTMLCanvasElement>('.hero__canvas')!;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const frames: (HTMLImageElement | undefined)[] = new Array(v.frames);
  // Posición en la secuencia como número con decimales: target la marca el scroll y pos la sigue amortiguada.
  // Entre dos frames se mezclan las dos imágenes, así el movimiento no va a saltos aunque los frames estén separados.
  let target = 0;
  let pos = 0;
  let synced = false;
  let drawnKey = '';
  let raf = 0;
  let last = 0;
  let anchors: Anchors | null = null;

  // ---- tamaño del canvas: nunca más píxeles de los que tiene el frame ----
  let fit = { s: 1, dx: 0, dy: 0, k: 1 };
  function resize() {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const cover = Math.max(cw / v.width, ch / v.height);
    const contain = Math.min(cw / v.width, ch / v.height);
    const scale = Math.min(cover, contain * 1.18); // recorta como mucho un 18 %, el resto se funde con el fondo
    const k = Math.max(1, Math.min(devicePixelRatio || 1, 2, 1 / scale));
    canvas.width = Math.round(cw * k);
    canvas.height = Math.round(ch * k);
    const s = scale * k;
    fit = { s, dx: (canvas.width - v.width * s) / 2, dy: (canvas.height - v.height * s) / 2, k };
    layoutTags();
    drawnKey = '';
    schedule();
  }

  // ---- dibujo: el frame pedido o el más cercano que ya esté cargado ----
  function nearest(i: number) {
    for (let d = 0; d < v.frames; d++) {
      if (frames[i - d]) return i - d;
      if (frames[i + d]) return i + d;
    }
    return -1;
  }
  function render(p: number) {
    const i0 = Math.floor(p), f = p - i0, i1 = Math.min(i0 + 1, v.frames - 1);
    const a = frames[i0] ? i0 : nearest(i0);
    if (a < 0) return;
    const b = f > 0.02 && i1 !== a && frames[i1] ? i1 : -1;
    const alpha = Math.round(f * 24) / 24; // 24 niveles de mezcla bastan y evitan repintar sin cambios
    const key = b < 0 ? `${a}` : `${a}:${b}:${alpha}`;
    if (key !== drawnKey) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(frames[a]!, fit.dx, fit.dy, v.width * fit.s, v.height * fit.s);
      if (b >= 0) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(frames[b]!, fit.dx, fit.dy, v.width * fit.s, v.height * fit.s);
        ctx.globalAlpha = 1;
      }
      drawnKey = key;
      if (!root.classList.contains('is-live')) root.classList.add('is-live');
    }
    placeTags(p);
  }
  const SMOOTH_MS = 90; // cuánto tarda la imagen en alcanzar al scroll (más alto = más suave, más retraso)
  function tick(now: number) {
    raf = 0;
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    pos += (target - pos) * (1 - Math.exp(-dt / SMOOTH_MS));
    if (Math.abs(target - pos) < 0.003) pos = target;
    render(pos);
    if (pos !== target) schedule(); else last = 0;
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(tick); }

  // ---- etiquetas ancladas ----
  const tags = [...root.querySelectorAll<HTMLElement>('[data-tag]')].map((el) => ({
    el, name: el.dataset.tag!,
    off: (el.dataset[key] ?? '0,0').split(',').map(Number),
    box: el.querySelector<HTMLElement>('.tag__box')!,
  }));
  const MARGIN = 10;
  // Línea y caja según el desplazamiento: la caja crece hacia fuera del punto
  function layoutTags() {
    for (const { el, off: [dx, dy] } of tags) {
      const line = el.querySelector<HTMLElement>('.tag__line')!;
      const box = el.querySelector<HTMLElement>('.tag__box')!;
      line.style.width = `${Math.hypot(dx, dy)}px`;
      line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      box.style.left = `${dx}px`;
      box.style.top = `${dy}px`;
      box.style.transform = `translate(${dx < 0 ? '-100%' : '0'}, ${dy < 0 ? '-100%' : '0'})`;
    }
  }
  function placeTags(p: number) {
    if (!anchors) return;
    const i0 = Math.floor(p), i1 = Math.min(i0 + 1, v.frames - 1), f = p - i0;
    for (const t of tags) {
      const a = anchors[t.name];
      let x = a?.[i0 * 2] ?? -1, y = a?.[i0 * 2 + 1] ?? -1;
      const x1 = a?.[i1 * 2] ?? -1, y1 = a?.[i1 * 2 + 1] ?? -1;
      if (x >= 0 && x1 >= 0) { x += (x1 - x) * f; y += (y1 - y) * f; } // la etiqueta se mueve sin saltos entre frames
      const off = x < 0;
      t.el.classList.toggle('is-off', off);
      if (off) continue;
      const px = (fit.dx + x * v.width * fit.s) / fit.k;
      const py = (fit.dy + y * v.height * fit.s) / fit.k;
      t.el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
      // Que la caja no se salga de la pantalla: se desliza en horizontal si hace falta
      const w = t.box.offsetWidth, [dx] = t.off;
      const left = px + dx - (dx < 0 ? w : 0);
      const vw = canvas.clientWidth;
      const shift = left < MARGIN ? MARGIN - left : left + w > vw - MARGIN ? vw - MARGIN - (left + w) : 0;
      t.box.style.translate = `${shift.toFixed(1)}px 0`;
    }
  }

  // ---- carga progresiva: primero frames repartidos, luego se rellenan los huecos ----
  function order(n: number) {
    const seen = new Set<number>(), out: number[] = [];
    const push = (i: number) => { if (i < n && !seen.has(i)) { seen.add(i); out.push(i); } };
    push(0); push(n - 1);
    for (let step = 16; step >= 1; step /= 2) for (let i = 0; i < n; i += step) push(i);
    return out;
  }
  function load(i: number) {
    const img = new Image();
    img.decoding = 'async';
    img.src = url(i);
    return img.decode().then(() => {
      frames[i] = img;
      schedule(); // draw() solo repinta si el frame más cercano ha cambiado
    }).catch(() => {});
  }
  async function loadAll() {
    const queue = order(v.frames);
    const worker = async () => { while (queue.length) await load(queue.shift()!); };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  // Etiquetas de circuito que añaden sus rondas en la fase del calendario
  const subTags = tags.filter(({ el }) => el.dataset.subAt).map(({ el }) => ({ el, subAt: Number(el.dataset.subAt) }));

  // ---- scroll ----
  const st = { trigger: root, start: 'top top', end: 'bottom bottom', scrub: true } as const;
  ScrollTrigger.create({
    ...st,
    onUpdate: (self) => {
      target = self.progress * (v.frames - 1);
      if (!synced) { pos = target; synced = true; } // al recargar a mitad de página no recorre la secuencia desde el principio
      for (const { el, subAt } of subTags) el.classList.toggle('has-sub', self.progress >= subAt);
      schedule();
    },
  });

  // Titulares y etiquetas: entran y salen en su tramo (data-at = "inicio,fin" en el mismo t que la escena)
  const tl = gsap.timeline({ defaults: { ease: 'power2.out' }, scrollTrigger: { ...st } });
  const range = (el: HTMLElement) => el.dataset.at!.split(',').map(Number);
  tl.to(root.querySelector('[data-beat="intro"]'), { autoAlpha: 0, y: -16, duration: 0.02, ease: 'power2.in' }, 0.03);
  tl.to(root.querySelector('[data-hint]'), { autoAlpha: 0, duration: 0.015 }, 0.015);
  root.querySelectorAll<HTMLElement>('.beat[data-at]').forEach((el) => {
    const [a, b] = range(el);
    tl.fromTo(el, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.014 }, a);
    tl.to(el, { autoAlpha: 0, y: -24, duration: 0.01, ease: 'power2.in' }, b - 0.01);
  });
  tags.forEach(({ el }) => {
    const [a, b] = range(el);
    const inner = el.querySelector('.tag__inner');
    tl.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.006 }, a);
    tl.fromTo(inner, { scale: 0.8, transformOrigin: '0 0' }, { scale: 1, duration: 0.01, ease: 'back.out(2)' }, a);
    tl.to(el, { autoAlpha: 0, duration: 0.006 }, b - 0.006);
  });
  const crest = manifest.cues.crest as number[];
  tl.fromTo(root.querySelector('[data-beat="final"]'), { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.02 }, crest[1] - 0.025);
  tl.set({}, {}, 1); // la línea de tiempo dura exactamente 1 = todo el recorrido del hero

  addEventListener('resize', resize);
  resize();
  fetch(`/hero/anchors-${key}.json?v=${manifest.version}`).then((r) => r.json()).then((a: Anchors) => {
    anchors = a;
    placeTags(pos);
  }).catch(() => {});
  load(0).then(() => {
    const start = () => loadAll();
    if (document.readyState === 'complete') setTimeout(start, 150);
    else addEventListener('load', () => setTimeout(start, 150), { once: true });
  });
}
