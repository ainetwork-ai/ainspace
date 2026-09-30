/**
 * 공통 항목 A — aindrive 계정 연결 흐름. 가짜 aindrive OAuth 서버(authorize → code, /api/oauth/token 의 PKCE 검증,
 * refresh 회전)로 시작 → 콜백 → 봉인 저장 → 목록 어댑터 사용 → 갱신 → 해제, 그리고 state 불일치 거절을 확인한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import fixture from '@/lib/ain-integration/__fixtures__/file-list-response.json';
import { getAindriveAccountToken, readConnection, safeReturnTo } from '@/lib/ain-integration/aindrive-token';
import { aindriveConnectDeps, sharedFilesDeps } from '@/lib/ain-integration/deps';
import { listSharedFiles } from '@/lib/ain-integration/files';
import { findSecretKey, resetNativeSupport } from '@/lib/ain-integration/http';
import { memoryKv } from '@/lib/ain-integration/kv';
import { deriveKey, unseal } from '@/lib/ain-integration/sealed';
import { SESSION_ENV, jsonResponse, makeRequest, signedJwt, withEnv } from '@/lib/ain-integration/__tests__/helpers';
import { DELETE, GET as START } from './connect/route';
import { GET as CALLBACK } from './callback/route';
import { GET as LIST } from '../shared-files/route';

const AINDRIVE = 'https://aindrive.example';
const KEY = 'unit-test-token-key-0123456789abcdef-0123456789';
const ENV = {
  ...SESSION_ENV, AIN_INTEGRATION_ENABLED: 'true', NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined,
  AINDRIVE_URL: AINDRIVE, AINDRIVE_OAUTH_CLIENT_ID: 'aind_client_space', AINDRIVE_TOKEN_KEY: KEY,
  AINDRIVE_CONNECT_URL: undefined, NEXT_PUBLIC_URL: undefined, AINDRIVE_ACCOUNT_TOKEN: undefined,
};

/** 가짜 aindrive: authorize 는 테스트가 직접 부르고(사용자 동의), token 엔드포인트는 PKCE·redirect_uri·client_id 를 검사한다. */
function fakeAindrive() {
  const codes = new Map<string, { challenge: string; redirectUri: string; clientId: string }>();
  const refresh = new Map<string, boolean>(); // refresh token → 유효
  let seq = 0;
  let revoked = false;
  const seenAuth: string[] = [];
  const issue = () => { seq++; const r = `aind_art_r${seq}`; refresh.set(r, true); return { access_token: `aind_aat_a${seq}`, refresh_token: r, expires_in: 3600, scope: 'profile drives:read drives:write', token_type: 'Bearer' }; };
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    if (url.origin !== AINDRIVE) return jsonResponse({ error: 'wrong host' }, 500);
    if (url.pathname === '/api/oauth/token') {
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('authorization'), null, 'public client: no Authorization header');
      const p = new URLSearchParams(String(init?.body));
      if (p.get('client_id') !== 'aind_client_space') return jsonResponse({ error: 'invalid_client' }, 401);
      if (p.get('grant_type') === 'authorization_code') {
        const c = codes.get(p.get('code') ?? '');
        codes.delete(p.get('code') ?? '');
        const verifier = p.get('code_verifier') ?? '';
        if (!c || c.redirectUri !== p.get('redirect_uri') || createHash('sha256').update(verifier).digest('base64url') !== c.challenge) {
          return jsonResponse({ error: 'invalid_grant' }, 400);
        }
        return jsonResponse(issue());
      }
      if (p.get('grant_type') === 'refresh_token') {
        const r = p.get('refresh_token') ?? '';
        if (revoked || !refresh.get(r)) return jsonResponse({ error: 'invalid_grant' }, 400);
        refresh.set(r, false); // 회전
        return jsonResponse(issue());
      }
      return jsonResponse({ error: 'unsupported_grant_type' }, 400);
    }
    if (url.pathname === '/api/oauth/shared') {
      seenAuth.push(new Headers(init?.headers).get('authorization') ?? '');
      return jsonResponse(fixture);
    }
    return jsonResponse({ error: 'not found' }, 404);
  };
  /** 사용자가 authorize 화면에서 승인했다 → code 를 redirect_uri 로. */
  const approve = (authorizeUrl: string) => {
    const u = new URL(authorizeUrl);
    assert.equal(`${u.origin}${u.pathname}`, `${AINDRIVE}/oauth/authorize`);
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    const code = `code_${codes.size + 1}_${Math.random().toString(36).slice(2)}`;
    codes.set(code, { challenge: u.searchParams.get('code_challenge')!, redirectUri: u.searchParams.get('redirect_uri')!, clientId: u.searchParams.get('client_id')! });
    return { code, state: u.searchParams.get('state')!, redirectUri: u.searchParams.get('redirect_uri')! };
  };
  return { fetch, approve, seenAuth, revoke: () => { revoked = true; } };
}

function setup() {
  const kv = memoryKv();
  const server = fakeAindrive();
  let clock = new Date('2026-09-30T00:00:00Z').getTime();
  const prev = { ...aindriveConnectDeps };
  aindriveConnectDeps.kv = kv;
  aindriveConnectDeps.fetch = server.fetch;
  aindriveConnectDeps.now = () => new Date(clock);
  const prevList = sharedFilesDeps.listSharedFiles;
  sharedFilesDeps.listSharedFiles = (o, q) => listSharedFiles({ ...o, fetch: server.fetch }, q);
  resetNativeSupport();
  return {
    kv, server,
    advance: (ms: number) => { clock += ms; },
    restore: () => { Object.assign(aindriveConnectDeps, prev); sharedFilesDeps.listSharedFiles = prevList; resetNativeSupport(); },
  };
}

const startReq = (bearer: string, returnTo = '/village/alpha') =>
  new NextRequest(`http://localhost/api/ain/aindrive/connect?returnTo=${encodeURIComponent(returnTo)}`, { headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' } });
const callbackReq = (q: Record<string, string>, cookie?: string) =>
  new NextRequest(`http://localhost/api/ain/aindrive/callback?${new URLSearchParams(q)}`, { headers: cookie ? { cookie: `ain_aindrive_oauth_state=${cookie}` } : {} });
const cookieState = (res: Response) => /ain_aindrive_oauth_state=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? null;

async function connect(bearer: string) {
  const res = await START(startReq(bearer));
  assert.equal(res.status, 200);
  const body = await res.json();
  return { res, body, cookie: cookieState(res) };
}

test('A: 시작 → 콜백 → 봉인 저장 → 목록 어댑터가 그 토큰을 쓴다 → 만료 후 갱신(회전) → 해제', withEnv(ENV, async () => {
  const s = setup();
  try {
    const { res, body, cookie } = await connect(signedJwt('user-42'));
    // 시작: authorize URL 과 HttpOnly state 쿠키. 응답에 verifier·토큰 없음.
    const authorize = new URL(body.authorizeUrl);
    assert.equal(authorize.searchParams.get('client_id'), 'aind_client_space');
    assert.equal(authorize.searchParams.get('redirect_uri'), 'http://localhost/api/ain/aindrive/callback');
    assert.equal(authorize.searchParams.get('scope'), 'profile drives:read drives:write');
    assert.equal(authorize.searchParams.get('response_type'), 'code');
    assert.equal(authorize.searchParams.get('resource'), null, '계정 grant 는 resource 없이');
    assert.equal(cookie, authorize.searchParams.get('state'));
    const setCookie = res.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=lax/i);
    assert.match(setCookie, /Path=\/api\/ain\/aindrive\/callback/);
    assert.ok(!JSON.stringify(body).includes('verifier'));

    // 콜백
    const { code, state } = s.server.approve(body.authorizeUrl);
    const cb = await CALLBACK(callbackReq({ code, state }, cookie!));
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get('location'), 'http://localhost/village/alpha?ain_aindrive=connected');
    assert.match(cb.headers.get('set-cookie') ?? '', /Max-Age=0/);

    // 봉인 저장: 평문 토큰이 KV 어디에도 없고, 다른 사용자 AAD 로는 열리지 않는다.
    const stored = s.kv.data.get('ain:aindrive_account:user-42');
    assert.ok(stored && stored.startsWith('v1.'));
    for (const v of s.kv.data.values()) { assert.ok(!v.includes('aind_aat_') && !v.includes('aind_art_')); }
    const k = deriveKey(KEY, 'aindrive-account-token');
    assert.equal(unseal(k, stored!, 'someone-else'), null);
    assert.equal(JSON.parse(unseal(k, stored!, 'user-42')!).accessToken, 'aind_aat_a1');
    // state 레코드는 한 번 쓰고 사라진다.
    assert.equal([...s.kv.data.keys()].filter((key) => key.startsWith('ain:aindrive_oauth_state:')).length, 0);

    // 목록 어댑터(라우트)가 저장된 토큰을 쓴다. 응답에는 토큰 키가 없다.
    const list = await LIST(makeRequest('/api/ain/shared-files?scope=shared_with_me', signedJwt('user-42')));
    assert.equal(list.status, 200);
    const listBody = await list.json();
    assert.equal(findSecretKey(listBody), null);
    assert.ok(!JSON.stringify(listBody).includes('aind_aat_'));
    assert.deepEqual(s.server.seenAuth, ['Bearer aind_aat_a1']);

    // 다른 사용자는 연결이 없다 → auth_required + 연결 시작 actionUrl.
    const other = await LIST(makeRequest('/api/ain/shared-files?scope=shared_with_me', signedJwt('user-7')));
    assert.equal(other.status, 401);
    assert.equal((await other.json()).error.actionUrl, 'http://localhost/api/ain/aindrive/connect');

    // 만료가 가까우면 refresh 로 갱신하고 회전된 쌍을 저장한다. 동시 호출은 한 번만 갱신한다.
    s.advance(3600 * 1000 - 30_000);
    const [t1, t2] = await Promise.all([getAindriveAccountToken('user-42'), getAindriveAccountToken('user-42')]);
    assert.equal(t1, 'aind_aat_a2');
    assert.equal(t2, 'aind_aat_a2');
    const after = await readConnection('user-42', aindriveConnectDeps);
    assert.equal(after?.refreshToken, 'aind_art_r2');
    await LIST(makeRequest('/api/ain/shared-files?scope=shared_with_me', signedJwt('user-42')));
    assert.equal(s.server.seenAuth.at(-1), 'Bearer aind_aat_a2');

    // 해제
    const del = await DELETE(new NextRequest('http://localhost/api/ain/aindrive/connect', { method: 'DELETE', headers: { authorization: `Bearer ${signedJwt('user-42')}` } }));
    assert.equal(del.status, 200);
    assert.deepEqual(await del.json(), { connected: false });
    assert.equal(s.kv.data.has('ain:aindrive_account:user-42'), false);
    assert.equal(await getAindriveAccountToken('user-42'), null);
  } finally { s.restore(); }
}));

test('A: state 불일치(다른 브라우저의 콜백·쿠키 없음)는 거절되고 state 레코드도 쓰이지 않는다; 재사용은 만료로 거절', withEnv(ENV, async () => {
  const s = setup();
  try {
    const victim = await connect(signedJwt('victim'));
    const { code, state } = s.server.approve(victim.body.authorizeUrl);
    // 공격자가 자기 쿠키(또는 쿠키 없음)로 피해자의 콜백 URL 을 연다
    const attacker = await connect(signedJwt('attacker'));
    for (const cookie of [attacker.cookie!, undefined]) {
      const r = await CALLBACK(callbackReq({ code, state }, cookie));
      assert.equal(r.status, 403);
      const b = await r.json();
      assert.equal(b.error.code, 'forbidden');
      assert.equal(b.error.detail, 'aindrive_connect_state_mismatch');
    }
    assert.equal(s.kv.data.has('ain:aindrive_account:victim'), false);
    assert.equal(s.kv.data.has('ain:aindrive_account:attacker'), false);
    // 정상 브라우저는 여전히 끝낼 수 있다
    const ok = await CALLBACK(callbackReq({ code, state }, victim.cookie!));
    assert.equal(ok.status, 302);
    assert.equal((await readConnection('victim', aindriveConnectDeps))?.accessToken, 'aind_aat_a1');
    // 같은 state 재사용 → 레코드가 이미 소비됨 → 401 + 연결 시작 actionUrl
    const replay = await CALLBACK(callbackReq({ code, state }, victim.cookie!));
    assert.equal(replay.status, 401);
    assert.equal((await replay.json()).error.actionUrl, 'http://localhost/api/ain/aindrive/connect');
  } finally { s.restore(); }
}));

test('A: 사용자 거절·code 교환 거절·refresh 거절(연결 해제됨)', withEnv(ENV, async () => {
  const s = setup();
  try {
    const a = await connect(signedJwt('u1'));
    const { state } = s.server.approve(a.body.authorizeUrl);
    const denied = await CALLBACK(callbackReq({ error: 'access_denied', state }, a.cookie!));
    assert.equal(denied.headers.get('location'), 'http://localhost/village/alpha?ain_aindrive=denied');

    const b = await connect(signedJwt('u1'));
    const { state: st2 } = s.server.approve(b.body.authorizeUrl);
    const bad = await CALLBACK(callbackReq({ code: 'forged', state: st2 }, b.cookie!));
    assert.equal(bad.headers.get('location'), 'http://localhost/village/alpha?ain_aindrive=failed');
    assert.equal(s.kv.data.has('ain:aindrive_account:u1'), false);

    const c = await connect(signedJwt('u1'));
    const g = s.server.approve(c.body.authorizeUrl);
    await CALLBACK(callbackReq({ code: g.code, state: g.state }, c.cookie!));
    s.server.revoke();
    s.advance(2 * 3600 * 1000);
    assert.equal(await getAindriveAccountToken('u1'), null);
    assert.equal(s.kv.data.has('ain:aindrive_account:u1'), false);
  } finally { s.restore(); }
}));

test('A: 설정·플래그·세션 가드, returnTo 는 같은 오리진 경로만', withEnv(ENV, async () => {
  const s = setup();
  try {
    // 세션 없음
    assert.equal((await START(new NextRequest('http://localhost/api/ain/aindrive/connect'))).status, 401);
    // Accept JSON 이 아니면 302 로 authorize 에
    const r = await START(new NextRequest('http://localhost/api/ain/aindrive/connect', { headers: { authorization: `Bearer ${signedJwt('u1')}` } }));
    assert.equal(r.status, 302);
    assert.ok(r.headers.get('location')!.startsWith(`${AINDRIVE}/oauth/authorize?`));
    assert.equal(safeReturnTo('//evil.example/x'), '/');
    assert.equal(safeReturnTo('https://evil.example'), '/');
    assert.equal(safeReturnTo('/\\evil.example'), '/');
    assert.equal(safeReturnTo('/village/a?x=1'), '/village/a?x=1');
  } finally { s.restore(); }
}));

test('A: 키·클라이언트 id 없음 → 503 temporary_failure(평문 저장으로 물러서지 않는다); 플래그 off → 404', async () => {
  const s = setup();
  try {
    await withEnv({ ...ENV, AINDRIVE_TOKEN_KEY: undefined }, async () => {
      const r = await START(startReq(signedJwt('u1')));
      assert.equal(r.status, 503);
      assert.equal((await r.json()).error.detail, 'aindrive_connect_token_key_missing');
    })();
    await withEnv({ ...ENV, AINDRIVE_TOKEN_KEY: 'short' }, async () => {
      assert.equal((await START(startReq(signedJwt('u1')))).status, 503);
    })();
    await withEnv({ ...ENV, AINDRIVE_OAUTH_CLIENT_ID: undefined }, async () => {
      const r = await START(startReq(signedJwt('u1')));
      assert.equal((await r.json()).error.detail, 'aindrive_connect_client_id_missing');
    })();
    await withEnv({ ...ENV, AIN_INTEGRATION_ENABLED: undefined }, async () => {
      assert.equal((await START(startReq(signedJwt('u1')))).status, 404);
      assert.equal((await CALLBACK(callbackReq({ code: 'c', state: 's' }, 's'))).status, 404);
      assert.equal((await DELETE(new NextRequest('http://localhost/api/ain/aindrive/connect', { method: 'DELETE', headers: { authorization: `Bearer ${signedJwt('u1')}` } }))).status, 404);
    })();
    assert.equal(s.kv.data.size, 0);
  } finally { s.restore(); }
});

test('A: 저장소 장애는 temporary_failure — 배포 토큰으로 물러서지 않는다', withEnv({ ...ENV, AINDRIVE_ACCOUNT_TOKEN: 'aind_aat_kiosk', NODE_ENV: 'development' }, async () => {
  const s = setup();
  try {
    assert.equal(await getAindriveAccountToken('nobody'), 'aind_aat_kiosk', '개발에서 연결이 없으면 키오스크 토큰');
    aindriveConnectDeps.kv = { ...s.kv, get: async () => { throw new Error('redis down'); } };
    const res = await LIST(makeRequest('/api/ain/shared-files?scope=shared_with_me', signedJwt('user-42')));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.detail, 'aindrive_connection_store_unavailable');
    assert.deepEqual(s.server.seenAuth, []);
  } finally { s.restore(); }
}));

test('A: 배포 단위 AINDRIVE_ACCOUNT_TOKEN 은 개발에서만, 레코드를 못 열면 어디서도 쓰지 않는다', async () => {
  const s = setup();
  try {
    for (const NODE_ENV of ['production', 'test', undefined]) {
      await withEnv({ ...ENV, AINDRIVE_ACCOUNT_TOKEN: 'aind_aat_kiosk', NODE_ENV }, async () => {
        assert.equal(await getAindriveAccountToken('nobody'), null, `NODE_ENV=${NODE_ENV}: 공용 토큰 없음`);
        const r = await LIST(makeRequest('/api/ain/shared-files?scope=shared_with_me', signedJwt('nobody')));
        assert.equal(r.status, 401);
      })();
    }
    assert.deepEqual(s.server.seenAuth, []);
    // 레코드는 있는데 봉인을 열 수 없다(키 회전·변조) → 개발에서도 공용 토큰으로 물러서지 않는다(다시 연결).
    await withEnv({ ...ENV, AINDRIVE_ACCOUNT_TOKEN: 'aind_aat_kiosk', NODE_ENV: 'development' }, async () => {
      await s.kv.set('ain:aindrive_account:user-9', 'v1.tampered.record');
      assert.equal(await getAindriveAccountToken('user-9'), null);
      await withEnv({ AINDRIVE_TOKEN_KEY: 'another-token-key-0123456789abcdef-0123456789' }, async () => {
        assert.equal(await getAindriveAccountToken('user-9'), null);
      })();
    })();
  } finally { s.restore(); }
});

test('A: 갱신 때 AINDRIVE_OAUTH_CLIENT_ID 가 없으면 temporary_failure — 연결을 지우지 않는다', withEnv(ENV, async () => {
  const s = setup();
  try {
    const c = await connect(signedJwt('u5'));
    const g = s.server.approve(c.body.authorizeUrl);
    await CALLBACK(callbackReq({ code: g.code, state: g.state }, c.cookie!));
    s.advance(2 * 3600 * 1000);
    await withEnv({ AINDRIVE_OAUTH_CLIENT_ID: undefined }, async () => {
      await assert.rejects(getAindriveAccountToken('u5'), (e: { code?: string; detail?: string }) => e.code === 'temporary_failure' && e.detail === 'aindrive_connect_client_id_missing');
      const r = await LIST(makeRequest('/api/ain/shared-files?scope=shared_with_me', signedJwt('u5')));
      assert.equal(r.status, 503);
    })();
    assert.equal(s.kv.data.has('ain:aindrive_account:u5'), true, '연결은 그대로');
    // 설정을 고치면 그 연결로 갱신이 된다
    assert.equal(await getAindriveAccountToken('u5'), 'aind_aat_a2');
  } finally { s.restore(); }
}));
