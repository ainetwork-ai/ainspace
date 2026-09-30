import { test } from 'node:test';
import assert from 'node:assert/strict';
import fixture from '@/lib/ain-integration/__fixtures__/file-list-response.json';
import { findSecretKey } from '@/lib/ain-integration/http';
import { AinContractError } from '@/lib/ain-integration/types';
import { SESSION_ENV, TEST_SIGNING_KEY, fakeJwt, jsonResponse, makeRequest, signedJwt, withEnv } from '@/lib/ain-integration/__tests__/helpers';
import { sharedFilesDeps as deps } from '@/lib/ain-integration/deps';
import { GET } from './route';

const ON = { ...SESSION_ENV, AIN_INTEGRATION_ENABLED: 'true', NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined };
const OFF = { AIN_INTEGRATION_ENABLED: undefined, NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined };

test('플래그 off(기본) → 404, 세션이 있어도', withEnv(OFF, async () => {
  const res = await GET(makeRequest('/api/ain/shared-files?scope=mine', signedJwt('u1')));
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.detail, 'ain_integration_disabled');
}));

test('세션 없음 → 401 auth_required (원본은 호출되지 않는다)', withEnv(ON, async () => {
  let called = false;
  const orig = deps.listSharedFiles;
  deps.listSharedFiles = async () => { called = true; return fixture as never; };
  try {
    const res = await GET(makeRequest('/api/ain/shared-files'));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'auth_required');
    assert.equal(body.error.retryable, false);
    assert.equal(called, false);
  } finally { deps.listSharedFiles = orig; }
}));

test('잘못된 scope → 400 unsupported_input', withEnv(ON, async () => {
  const res = await GET(makeRequest('/api/ain/shared-files?scope=nope', signedJwt('u1')));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'unsupported_input');
}));

test('aindrive 토큰이 없는 사용자 → 401 auth_required + actionUrl', withEnv({ ...ON, AINDRIVE_ACCOUNT_TOKEN: undefined, AINDRIVE_URL: 'https://aindrive.example' }, async () => {
  const origToken = deps.getAindriveAccountToken;
  deps.getAindriveAccountToken = async () => null;
  try {
    const res = await GET(makeRequest('/api/ain/shared-files?scope=shared_with_me', signedJwt('u1')));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'auth_required');
    assert.equal(body.error.actionUrl, 'https://aindrive.example/oauth/authorize');
  } finally { deps.getAindriveAccountToken = origToken; }
}));

test('세션 + 토큰 → 계약 응답 그대로, 토큰·authorization 키 없음, no-store', withEnv(ON, async () => {
  const origToken = deps.getAindriveAccountToken;
  const origList = deps.listSharedFiles;
  let seen: { token: string | null; scope: string; userId: string | null } | null = null;
  deps.getAindriveAccountToken = async (userId) => { seen = { token: 'aind_aat_secret', scope: '', userId }; return 'aind_aat_secret'; };
  deps.listSharedFiles = async (o, req) => { seen = { token: o.token, scope: req.scope, userId: seen?.userId ?? null }; return fixture as never; };
  try {
    const res = await GET(makeRequest('/api/ain/shared-files?scope=recent&limit=5', signedJwt('user-42')));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const body = await res.json();
    assert.deepEqual(body, fixture);
    assert.equal(findSecretKey(body), null);
    assert.ok(!JSON.stringify(body).includes('aind_aat_secret'));
    assert.deepEqual(seen, { token: 'aind_aat_secret', scope: 'recent', userId: 'user-42' });
  } finally { deps.getAindriveAccountToken = origToken; deps.listSharedFiles = origList; }
}));

test('어댑터 오류는 계약 오류 바디 + 매핑된 status 로', withEnv(ON, async () => {
  const origToken = deps.getAindriveAccountToken;
  const origList = deps.listSharedFiles;
  deps.getAindriveAccountToken = async () => 't';
  deps.listSharedFiles = async () => { throw new AinContractError('source_offline', 'device offline'); };
  try {
    const res = await GET(makeRequest('/api/ain/shared-files', signedJwt('u1')));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'source_offline');
    assert.equal(body.error.retryable, true);
  } finally { deps.getAindriveAccountToken = origToken; deps.listSharedFiles = origList; }
}));

test('알 수 없는 실패는 temporary_failure 로, 내부 메시지는 감춘다', withEnv(ON, async () => {
  const origToken = deps.getAindriveAccountToken;
  const origList = deps.listSharedFiles;
  deps.getAindriveAccountToken = async () => 't';
  deps.listSharedFiles = async () => { throw new Error('ECONNREFUSED token=leak'); };
  try {
    const res = await GET(makeRequest('/api/ain/shared-files', signedJwt('u1')));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'temporary_failure');
    assert.ok(!body.error.message.includes('leak'));
  } finally { deps.getAindriveAccountToken = origToken; deps.listSharedFiles = origList; }
}));

test('위조·변조·만료 bearer 와 ?token= 쿼리는 401 auth_required — 원본은 호출되지 않는다', withEnv(ON, async () => {
  let called = 0;
  const origToken = deps.getAindriveAccountToken; const origList = deps.listSharedFiles;
  deps.getAindriveAccountToken = async () => { called++; return 't'; };
  deps.listSharedFiles = async () => { called++; return fixture as never; };
  try {
    const bad = [
      fakeJwt('u1'),                                                            // 서명 없음(h.<payload>.s)
      'h.e30.s',                                                                // sub 조차 없는 위조
      signedJwt('u1', { key: 'wrong-key-wrong-key-wrong-key-wrong-key' }),      // 다른 키
      signedJwt('u1', { alg: 'none' }),                                         // alg none
      signedJwt('u1', { exp: Math.floor(Date.now() / 1000) - 3600 }),           // 만료
      signedJwt('u1', { aud: 'mcp' }),                                          // 다른 audience
      signedJwt('', { sub: null }),                                             // sub 없음
    ];
    for (const b of bad) {
      const res = await GET(makeRequest('/api/ain/shared-files?scope=mine', b));
      assert.equal(res.status, 401, `expected 401 for ${b.slice(0, 12)}…`);
      assert.equal((await res.json()).error.code, 'auth_required');
    }
    // 유효한 토큰이라도 쿼리로 오면 받지 않는다(URL·접근 로그에 남는다)
    const q = await GET(makeRequest(`/api/ain/shared-files?scope=mine&token=${encodeURIComponent(signedJwt('u1'))}`));
    assert.equal(q.status, 401);
    assert.equal(called, 0);
    // 헤더로 온 서명 토큰은 통과한다
    const ok = await GET(makeRequest('/api/ain/shared-files?scope=mine', signedJwt('u1')));
    assert.equal(ok.status, 200);
  } finally { deps.getAindriveAccountToken = origToken; deps.listSharedFiles = origList; }
}));

test('세션 검증기가 설정되어 있지 않으면 503 temporary_failure(열어 두지 않는다)', withEnv({ ...ON, BACKEND_JWT_SIGNING_KEY: undefined, BACKEND_BASE_URL: undefined }, async () => {
  let called = false;
  const origList = deps.listSharedFiles;
  deps.listSharedFiles = async () => { called = true; return fixture as never; };
  try {
    const res = await GET(makeRequest('/api/ain/shared-files?scope=mine', signedJwt('u1')));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'temporary_failure');
    assert.equal(body.error.detail, 'app_session_verifier_missing');
    assert.equal(body.error.retryable, false);
    assert.equal(called, false);
  } finally { deps.listSharedFiles = origList; }
}));

test('서명 키가 없고 BACKEND_BASE_URL 만 있으면 backend /auth/me introspection 으로 검증한다(토큰은 헤더로만)', withEnv({ ...ON, BACKEND_JWT_SIGNING_KEY: undefined, BACKEND_BASE_URL: 'https://backend.example' }, async () => {
  const origFetch = globalThis.fetch;
  const origToken = deps.getAindriveAccountToken; const origList = deps.listSharedFiles;
  const seen: { url: string; auth: string | null }[] = [];
  let userId: string | null = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
    return url.endsWith('/auth/me') && new Headers(init?.headers).get('authorization') === 'Bearer real-session' ? jsonResponse({ user: { id: 'user-7' } }) : jsonResponse({ error: 'unauthenticated' }, 401);
  }) as typeof fetch;
  deps.getAindriveAccountToken = async (u) => { userId = u; return 't'; };
  deps.listSharedFiles = async () => fixture as never;
  try {
    const ok = await GET(makeRequest('/api/ain/shared-files?scope=mine', 'real-session'));
    assert.equal(ok.status, 200);
    assert.equal(userId, 'user-7');
    assert.deepEqual(seen, [{ url: 'https://backend.example/auth/me', auth: 'Bearer real-session' }]);
    const no = await GET(makeRequest('/api/ain/shared-files?scope=mine', fakeJwt('u1')));
    assert.equal(no.status, 401);
    assert.equal(TEST_SIGNING_KEY.length >= 32, true);
  } finally { globalThis.fetch = origFetch; deps.getAindriveAccountToken = origToken; deps.listSharedFiles = origList; }
}));
