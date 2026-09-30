import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { introspectSession, readBearerHeader, verifyAppSession, verifyHs256Session } from './app-session';
import { AinContractError } from './types';
import { TEST_SIGNING_KEY, fakeFetch, fakeJwt, jsonResponse, signedJwt, withEnv } from './__tests__/helpers';

const KEY = TEST_SIGNING_KEY;

test('readBearerHeader: Authorization 헤더만 읽고 ?token= 은 무시한다', () => {
  assert.equal(readBearerHeader(new NextRequest('http://localhost/api/ain/events?token=abc')), null);
  assert.equal(readBearerHeader(new NextRequest('http://localhost/x', { headers: { authorization: 'Bearer  abc ' } })), 'abc');
  assert.equal(readBearerHeader(new NextRequest('http://localhost/x', { headers: { authorization: 'Basic abc' } })), null);
  assert.equal(readBearerHeader(new NextRequest('http://localhost/x', { headers: { authorization: 'Bearer ' } })), null);
});

test('verifyHs256Session: 올바른 서명·iss·aud·exp·sub 만 통과', () => {
  assert.deepEqual(verifyHs256Session(signedJwt('user-42'), KEY), { userId: 'user-42' });
  assert.deepEqual(verifyHs256Session(signedJwt('user-42', { aud: ['other', 'client-access'] }), KEY), { userId: 'user-42' });
});

test('verifyHs256Session: 위조·변조·다른 키·alg none·만료·nbf·iss/aud 불일치·sub 없음 → null', () => {
  assert.equal(verifyHs256Session(fakeJwt('user-42'), KEY), null);
  assert.equal(verifyHs256Session('h.e30.s', KEY), null);
  assert.equal(verifyHs256Session('', KEY), null);
  assert.equal(verifyHs256Session(signedJwt('user-42', { key: 'another-key-another-key-another-key-0000' }), KEY), null);
  assert.equal(verifyHs256Session(signedJwt('user-42', { alg: 'none' }), KEY), null);
  // alg=none 에 서명 부분을 비운 형태
  const [h, p] = signedJwt('user-42', { alg: 'none' }).split('.');
  assert.equal(verifyHs256Session(`${h}.${p}.`, KEY), null);
  // 서명은 유지한 채 payload 만 바꾼 변조
  const good = signedJwt('user-42');
  const [gh, , gs] = good.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ iss: 'a2a-backend', aud: 'client-access', exp: Math.floor(Date.now() / 1000) + 3600, sub: 'admin' })).toString('base64url');
  assert.equal(verifyHs256Session(`${gh}.${forgedPayload}.${gs}`, KEY), null);
  assert.equal(verifyHs256Session(signedJwt('user-42', { exp: Math.floor(Date.now() / 1000) - 120 }), KEY), null);
  assert.equal(verifyHs256Session(signedJwt('user-42', { nbf: Math.floor(Date.now() / 1000) + 600 }), KEY), null);
  assert.equal(verifyHs256Session(signedJwt('user-42', { iss: 'someone-else' }), KEY), null);
  assert.equal(verifyHs256Session(signedJwt('user-42', { aud: 'mcp' }), KEY), null);
  assert.equal(verifyHs256Session(signedJwt('', { sub: null }), KEY), null);
  assert.equal(verifyHs256Session(signedJwt(''), KEY), null);
  // issuer/audience 를 덮어쓰면 그 값으로 검사한다
  assert.equal(verifyHs256Session(signedJwt('u', { iss: 'x' }), KEY, { issuer: 'x', audience: 'client-access' })?.userId, 'u');
});

test('introspectSession: backend /auth/me 에 헤더로만 전달; 200 → user.id, 401/403 → null, 5xx·네트워크 → temporary_failure', async () => {
  const seen: { url: string; auth: string | undefined }[] = [];
  let status = 200;
  const f = fakeFetch({ '/auth/me': (url, init) => { seen.push({ url: url.toString(), auth: (init?.headers as Record<string, string>).authorization }); return status === 200 ? jsonResponse({ user: { id: 'user-42', displayName: 'B' } }) : jsonResponse({ error: 'x' }, status); } });
  assert.deepEqual(await introspectSession('tok', 'https://backend.example', { fetch: f as unknown as typeof fetch }), { userId: 'user-42' });
  assert.deepEqual(seen, [{ url: 'https://backend.example/auth/me', auth: 'Bearer tok' }]);
  status = 401;
  assert.equal(await introspectSession('tok', 'https://backend.example', { fetch: f as unknown as typeof fetch }), null);
  status = 403;
  assert.equal(await introspectSession('tok', 'https://backend.example', { fetch: f as unknown as typeof fetch }), null);
  status = 500;
  await assert.rejects(() => introspectSession('tok', 'https://backend.example', { fetch: f as unknown as typeof fetch }), (e: AinContractError) => e.code === 'temporary_failure' && e.detail === 'app_session_verifier_unavailable' && e.status === 503);
  const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
  await assert.rejects(() => introspectSession('tok', 'https://backend.example', { fetch: down }), (e: AinContractError) => e.code === 'temporary_failure' && e.retryable);
  // 200 인데 user.id 가 없으면 세션으로 치지 않는다
  const odd = fakeFetch({ '/auth/me': () => jsonResponse({ user: {} }) });
  assert.equal(await introspectSession('tok', 'https://backend.example', { fetch: odd as unknown as typeof fetch }), null);
});

test('verifyAppSession: 서명 키가 있으면 로컬 검증, 없으면 BACKEND_BASE_URL introspection, 둘 다 없으면 temporary_failure(열어 두지 않는다)', async () => {
  await withEnv({ BACKEND_JWT_SIGNING_KEY: KEY, BACKEND_BASE_URL: undefined }, async () => {
    assert.deepEqual(await verifyAppSession(signedJwt('user-42')), { userId: 'user-42' });
    assert.equal(await verifyAppSession(fakeJwt('user-42')), null);
  })();
  await withEnv({ BACKEND_JWT_SIGNING_KEY: 'too-short', BACKEND_BASE_URL: 'https://backend.example/' }, async () => {
    const f = fakeFetch({ '/auth/me': () => jsonResponse({ user: { id: 'user-7' } }) });
    assert.deepEqual(await verifyAppSession(fakeJwt('whoever'), { fetch: f as unknown as typeof fetch }), { userId: 'user-7' });
    assert.equal(f.calls[0].url, 'https://backend.example/auth/me');
  })();
  await withEnv({ BACKEND_JWT_SIGNING_KEY: undefined, BACKEND_BASE_URL: undefined }, async () => {
    await assert.rejects(() => verifyAppSession(signedJwt('user-42')), (e: AinContractError) => e.code === 'temporary_failure' && e.detail === 'app_session_verifier_missing' && e.retryable === false);
  })();
});
