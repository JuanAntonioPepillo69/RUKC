// /api/auth/* · login del panel (Better Auth). vercel.json reescribe /api/auth/<ruta> a /api/auth?ruta=<ruta>;
// aquí se reconstruye la URL original para que Better Auth sepa qué endpoint es.
import { auth } from '../lib/auth.js';

async function manejar(request) {
  const url = new URL(request.url);
  const ruta = url.searchParams.get('ruta');
  if (ruta !== null) {
    url.searchParams.delete('ruta');
    url.pathname = `/api/auth/${ruta.replace(/^\/+/, '')}`;
    request = new Request(url, request);
  }
  const res = await auth().handler(request);
  const h = new Headers(res.headers);
  h.set('Cache-Control', 'no-store');
  return new Response(res.body, { status: res.status, headers: h });
}

export const GET = manejar;
export const POST = manejar;
