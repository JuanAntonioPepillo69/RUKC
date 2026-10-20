// La función de CAPI se carga como módulo ES y rechaza lo que no sea POST (sin llamar a Meta).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/lead.js';

const res = () => {
  const r = { code: 0, body: null as unknown, status(c: number) { r.code = c; return r; }, json(b: unknown) { r.body = b; return r; } };
  return r;
};

test('api/lead: GET devuelve 405', async () => {
  const r = res();
  await handler({ method: 'GET', headers: {} }, r);
  assert.equal(r.code, 405);
});

test('api/lead: sin token responde 500 controlado y no llama a Meta', async () => {
  const prev = process.env.META_CAPI_TOKEN;
  delete process.env.META_CAPI_TOKEN;
  const r = res();
  await handler({ method: 'POST', headers: {}, body: { email: 'a@b.c' } }, r);
  assert.deepEqual([r.code, r.body], [500, { error: 'server_not_configured' }]);
  if (prev) process.env.META_CAPI_TOKEN = prev;
});
