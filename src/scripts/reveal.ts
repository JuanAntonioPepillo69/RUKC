// Animaciones de las secciones de la home ligadas al scroll.
//   [data-reveal]        aparece al entrar en pantalla (data-reveal-delay en segundos)
//   [data-count="60"]    cuenta de 0 al número al entrar
//   [data-words]         las palabras se van encendiendo según avanza el scroll
//   [data-drift="-12"]   se desplaza en horizontal (en %) mientras la sección cruza la pantalla
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!reduce) {
  gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((el) => {
    gsap.to(el, {
      opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', delay: Number(el.dataset.revealDelay ?? 0),
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
  });

  gsap.utils.toArray<HTMLElement>('[data-count]').forEach((el) => {
    const end = Number(el.dataset.count);
    const obj = { n: 0 };
    el.textContent = '0';
    gsap.to(obj, {
      n: end, duration: 1.6, ease: 'power2.out',
      onUpdate: () => { el.textContent = String(Math.round(obj.n)); },
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
    });
  });

  gsap.utils.toArray<HTMLElement>('[data-words]').forEach((el) => {
    // Parte el texto en palabras conservando los <em> y <br>
    const wrap = (node: Node): Node[] => {
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent ?? '').split(/(\s+)/).map((w) => {
          if (!w.trim()) return document.createTextNode(w);
          const s = document.createElement('span'); s.className = 'w'; s.textContent = w; return s;
        });
      }
      const clone = node.cloneNode(false) as HTMLElement;
      node.childNodes.forEach((c) => wrap(c).forEach((n) => clone.appendChild(n)));
      return [clone];
    };
    const parts = [...el.childNodes].flatMap(wrap);
    el.replaceChildren(...parts);
    gsap.fromTo(el.querySelectorAll('.w'), { opacity: 0.16 }, {
      opacity: 1, stagger: 0.08, ease: 'none',
      scrollTrigger: { trigger: el, start: 'top 80%', end: 'bottom 45%', scrub: true },
    });
  });

  gsap.utils.toArray<HTMLElement>('[data-drift]').forEach((el) => {
    gsap.fromTo(el, { xPercent: 0 }, {
      xPercent: Number(el.dataset.drift), ease: 'none',
      scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
    });
  });
}
