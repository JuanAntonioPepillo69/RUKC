// Publica la landing de anuncios (src/landing/landing.html) en /<slug>.
// No sale en el sitemap, ni en la navegación, ni enlazada desde ninguna página, y lleva noindex.
import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LANDING } from '../config/landing';
import { RESERVA } from '../config/reserva.js';

export function getStaticPaths() {
  return [{ params: { slug: LANDING.slug } }];
}

export const GET: APIRoute = async () => {
  const html = (await fs.readFile(path.join(process.cwd(), 'src', 'landing', 'landing.html'), 'utf8'))
    .replaceAll('%%PIXEL_ID%%', LANDING.pixelId)
    .replaceAll('%%WHATSAPP%%', LANDING.whatsapp)
    .replaceAll('%%RESERVA%%', String(RESERVA.importe));
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
};
