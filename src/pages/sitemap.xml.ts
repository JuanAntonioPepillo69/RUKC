// sitemap.xml: solo páginas públicas e indexables. La landing de anuncios NO se incluye.
import type { APIRoute } from 'astro';
import { cargarTemporada } from '../lib/season/load';
import { urlRonda } from '../lib/season/format';

export const GET: APIRoute = async ({ site }) => {
  const t = await cargarTemporada();
  const paths = [
    '/', '/season-2', '/inscripcion', '/reglamento',
    ...t.rondas.filter((r) => r.estado === 'disputada').map(urlRonda),
    '/aviso-legal', '/privacidad', '/cookies', '/condiciones-reserva',
  ];
  const urls = paths.map((p) => `  <url><loc>${new URL(p, site).href.replace(/\/$/, p === '/' ? '/' : '')}</loc></url>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
