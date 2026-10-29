import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backendFetch, BackendUnreachableError } from './server-client';

// 2026-10-29 05:59: a short on-prem network blip; a chat send from Vercel never reached the backend
// and the user saw "Failed to send message: fetch failed". A connection that was never made is retried
// (nothing was sent, so even a POST cannot duplicate); anything after the request left is not.
const connectError = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });

test('a connection that could not be made is retried, then reported as unreachable', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls < 3) throw connectError('UND_ERR_CONNECT_TIMEOUT');
    return Response.json({ ok: true });
  });
  const res = await backendFetch('token', '/dm/x/messages', { method: 'POST', body: '{}' }, { delays: [1, 1] });
  assert.equal(res.status, 200); assert.equal(calls, 3);
  calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw connectError('ECONNREFUSED'); });
  await assert.rejects(backendFetch('token', '/dm/x/messages', { method: 'POST', body: '{}' }, { delays: [1, 1] }), BackendUnreachableError);
  assert.equal(calls, 3);
});

test('a failure after the request may have reached the backend is not replayed', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw connectError('ECONNRESET'); });
  await assert.rejects(backendFetch('token', '/dm/x/messages', { method: 'POST', body: '{}' }, { delays: [1, 1] }));
  assert.equal(calls, 1);
});
