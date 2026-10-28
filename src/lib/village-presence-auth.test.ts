import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { authorizeVillagePresence, VillagePresenceAuthError } from './village-presence-auth';

test('account presence cannot be claimed anonymously or by another authenticated account', async () => {
  const anonymous = { headers: new Headers() };
  const loggedIn = { headers: new Headers({ authorization: 'Bearer test-session' }) };
  const verify = async () => ({ userId: 'account-a' });
  await assert.rejects(authorizeVillagePresence(anonymous, 'account-a', verify), (e: unknown) => e instanceof VillagePresenceAuthError && e.status === 401);
  await assert.rejects(authorizeVillagePresence(loggedIn, 'account-b', verify), (e: unknown) => e instanceof VillagePresenceAuthError && e.status === 403);
  assert.equal(await authorizeVillagePresence(loggedIn, 'account-a', verify), 'account-a');
  assert.equal(await authorizeVillagePresence(loggedIn, undefined, verify), 'account-a');
  assert.equal(await authorizeVillagePresence(anonymous, 'guest:browser-uuid', verify), 'guest:browser-uuid');
});

test('invalid account token cannot downgrade to guest presence; verifier failure propagates', async () => {
  const request = { headers: new Headers({ authorization: 'Bearer invalid-session' }) };
  await assert.rejects(authorizeVillagePresence(request, 'guest:browser', async () => null), (e: unknown) => e instanceof VillagePresenceAuthError && e.status === 401);
  const unavailable = new Error('verifier unavailable');
  await assert.rejects(authorizeVillagePresence(request, 'account-a', async () => { throw unavailable; }), e => e === unavailable);
});

test('live backend rejection overrides an otherwise valid local account signature', async () => {
  const previousBase = process.env.BACKEND_BASE_URL;
  const previousKey = process.env.BACKEND_JWT_SIGNING_KEY;
  const previousFetch = globalThis.fetch;
  const key = 'owned-test-key-for-presence-live-check-only';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: 'a2a-backend', aud: 'client-access', sub: 'account-a', exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url');
  const token = `${header}.${payload}.${createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url')}`;
  let calls = 0;
  try {
    process.env.BACKEND_BASE_URL = 'https://owned-backend.invalid';
    process.env.BACKEND_JWT_SIGNING_KEY = key;
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://owned-backend.invalid/auth/me');
      assert.ok(new Headers(init?.headers).get('authorization') === `Bearer ${token}`);
      calls += 1;
      return new Response(null, { status: 401 });
    };
    await assert.rejects(authorizeVillagePresence({ headers: new Headers({ authorization: `Bearer ${token}` }) }, 'account-a'), (e: unknown) => e instanceof VillagePresenceAuthError && e.status === 401);
    assert.equal(calls, 1);
  } finally {
    if (previousBase === undefined) delete process.env.BACKEND_BASE_URL; else process.env.BACKEND_BASE_URL = previousBase;
    if (previousKey === undefined) delete process.env.BACKEND_JWT_SIGNING_KEY; else process.env.BACKEND_JWT_SIGNING_KEY = previousKey;
    globalThis.fetch = previousFetch;
  }
});
