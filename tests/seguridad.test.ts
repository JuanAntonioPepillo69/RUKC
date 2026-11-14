// Regresiones de la auditoría de seguridad (2026-11): CSV sin fórmulas, orígenes permitidos y /api/lead cerrado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { celdaCsv } from '../lib/csv.js';
import { ORIGENES_WEB, origenValido } from '../lib/http.js';
import handler from '../api/lead.js';

test('CSV: lo que Excel ejecutaría como fórmula sale como texto; números, teléfonos e importes, tal cual', () => {
  assert.equal(celdaCsv('=HYPERLINK("https://x/?"&A2;"Ver")'), `"'=HYPERLINK(""https://x/?""&A2;""Ver"")"`);
  for (const v of ['@SUM(A1)', '+HYPERLINK(1)', '-cmd|calc', '\tX']) assert.ok(celdaCsv(v).startsWith("'"), v);
  for (const v of ['+34 600 111 222', '-30', 'Carlos Martín']) assert.equal(celdaCsv(v), v);
  assert.equal(celdaCsv(-5), '-5');
  assert.equal(celdaCsv('Martín; Pérez'), '"Martín; Pérez"');
  assert.equal(celdaCsv(null), '');
});

test('orígenes: solo nuestro dominio, nuestros despliegues de Vercel y localhost', () => {
  for (const o of ['https://raceupkc.com', 'https://www.raceupkc.com', 'https://raceupkc.vercel.app',
    'https://raceupkc-git-bot-fase-1-equipo.vercel.app', 'https://rukc-pruebas.vercel.app', 'http://localhost:4321']) {
    assert.ok(ORIGENES_WEB.test(o), o);
  }
  for (const o of ['https://atacante.vercel.app', 'https://raceupkc.com.atacante.com', 'http://raceupkc.com', 'https://xraceupkc.vercel.app']) {
    assert.ok(!ORIGENES_WEB.test(o), o);
  }
  const con = (origin?: string) => new Request('https://raceupkc.com/api/x', { method: 'POST', headers: origin ? { origin } : {} });
  assert.equal(origenValido(con('https://atacante.vercel.app')), false);
  assert.equal(origenValido(con('https://raceupkc.com')), true);
});

test('api/lead: sin Origin de nuestra web responde 403 y no llama a Meta', async () => {
  const prev = process.env.META_CAPI_TOKEN;
  process.env.META_CAPI_TOKEN = 'token_simulado';
  const fetchReal = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = async () => { llamadas += 1; return Response.json({}); };
  try {
    for (const headers of [{}, { origin: 'https://atacante.vercel.app' }]) {
      const r = { code: 0, body: null as unknown, status(c: number) { r.code = c; return r; }, json(b: unknown) { r.body = b; return r; } };
      await handler({ method: 'POST', headers, body: { email: 'a@example.com' } }, r);
      assert.equal(r.code, 403);
    }
    assert.equal(llamadas, 0);
  } finally {
    globalThis.fetch = fetchReal;
    if (prev) process.env.META_CAPI_TOKEN = prev; else delete process.env.META_CAPI_TOKEN;
  }
});
