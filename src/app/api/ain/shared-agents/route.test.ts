import { test } from 'node:test';
import assert from 'node:assert/strict';
import fixture from '@/lib/ain-integration/__fixtures__/agent-list-response.json';
import { findSecretKey } from '@/lib/ain-integration/http';
import { SESSION_ENV, fakeJwt, signedJwt, makeRequest, withEnv } from '@/lib/ain-integration/__tests__/helpers';
import { sharedAgentsDeps as deps } from '@/lib/ain-integration/deps';
import { GET } from './route';

const ON = { ...SESSION_ENV, AIN_INTEGRATION_ENABLED: 'true', NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined };
const OFF = { AIN_INTEGRATION_ENABLED: undefined, NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined };

test('플래그 off(기본) → 404', withEnv(OFF, async () => {
  const res = await GET(makeRequest('/api/ain/shared-agents?scope=public', signedJwt('u1')));
  assert.equal(res.status, 404);
}));

test('클라이언트 이름의 플래그만 켜도 서버 라우트가 열린다', withEnv({ AIN_INTEGRATION_ENABLED: undefined, NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: 'true' }, async () => {
  const res = await GET(makeRequest('/api/ain/shared-agents'));
  assert.equal(res.status, 401);
}));

test('세션 없음 → 401 auth_required', withEnv(ON, async () => {
  const res = await GET(makeRequest('/api/ain/shared-agents?scope=public'));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'auth_required');
}));

test('limit 범위 밖 → 400', withEnv(ON, async () => {
  const res = await GET(makeRequest('/api/ain/shared-agents?limit=500', signedJwt('u1')));
  assert.equal(res.status, 400);
}));

test('세션 있음 → 계약 응답 그대로, 비밀 키 없음, 앱 세션 토큰은 원본으로 가지 않는다', withEnv({ ...ON, AINIZE_URL: 'https://ainize.example/' }, async () => {
  const orig = deps.listSharedAgents;
  let seen: { ainizeUrl: string; sessionToken: string | null | undefined; scope: string } | null = null;
  deps.listSharedAgents = async (o, req) => { seen = { ainizeUrl: o.ainizeUrl, sessionToken: o.sessionToken, scope: req.scope }; return fixture as never; };
  try {
    const jwt = signedJwt('u1');
    const res = await GET(makeRequest('/api/ain/shared-agents?scope=public', jwt));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, fixture);
    assert.equal(findSecretKey(body), null);
    assert.ok(!JSON.stringify(body).includes(jwt));
    assert.deepEqual(seen, { ainizeUrl: 'https://ainize.example', sessionToken: null, scope: 'public' });
  } finally { deps.listSharedAgents = orig; }
}));

test('20.1 B: 조직 키 없음 → 기본 scope 는 public(익명); shared_with_me 를 청해도 public 으로 내려가고 헤더로 알린다', withEnv({ ...ON, AINIZE_API_KEY: undefined }, async () => {
  const orig = deps.listSharedAgents;
  const seen: { scope: string; sessionToken: string | null | undefined }[] = [];
  deps.listSharedAgents = async (o, req) => { seen.push({ scope: req.scope, sessionToken: o.sessionToken }); return fixture as never; };
  try {
    const a = await GET(makeRequest('/api/ain/shared-agents', signedJwt('u1')));
    assert.equal(a.status, 200);
    assert.equal(a.headers.get('x-ain-agent-scope'), 'public');
    const b = await GET(makeRequest('/api/ain/shared-agents?scope=shared_with_me', signedJwt('u1')));
    assert.equal(b.status, 200);
    assert.equal(b.headers.get('x-ain-agent-scope'), 'public');
    const c = await GET(makeRequest('/api/ain/shared-agents?scope=mine', signedJwt('u1')));
    assert.equal(c.headers.get('x-ain-agent-scope'), 'mine');
    assert.deepEqual(seen, [{ scope: 'public', sessionToken: null }, { scope: 'public', sessionToken: null }, { scope: 'mine', sessionToken: null }]);
  } finally { deps.listSharedAgents = orig; }
}));

test('20.1 B: 조직 키(AINIZE_API_KEY) 있음 → 기본·shared_with_me 는 shared_with_org, 키는 원본 호출에만(응답에 없음)', withEnv({ ...ON, AINIZE_API_KEY: 'ainz_org_key_secret' }, async () => {
  const orig = deps.listSharedAgents;
  const seen: { scope: string; sessionToken: string | null | undefined }[] = [];
  deps.listSharedAgents = async (o, req) => { seen.push({ scope: req.scope, sessionToken: o.sessionToken }); return fixture as never; };
  try {
    for (const q of ['', '?scope=shared_with_me']) {
      const res = await GET(makeRequest(`/api/ain/shared-agents${q}`, signedJwt('u1')));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-ain-agent-scope'), 'shared_with_org');
      const text = JSON.stringify(await res.json()) + JSON.stringify([...res.headers.entries()]);
      assert.ok(!text.includes('ainz_org_key_secret'));
    }
    const pub = await GET(makeRequest('/api/ain/shared-agents?scope=public', signedJwt('u1')));
    assert.equal(pub.headers.get('x-ain-agent-scope'), 'public');
    assert.deepEqual(seen.map((s) => s.scope), ['shared_with_org', 'shared_with_org', 'public']);
    assert.ok(seen.every((s) => s.sessionToken === 'ainz_org_key_secret'));
  } finally { deps.listSharedAgents = orig; }
}));

test('위조(서명 없는) bearer → 401 auth_required, 원본은 호출되지 않는다', withEnv(ON, async () => {
  let called = false;
  const orig = deps.listSharedAgents;
  deps.listSharedAgents = async () => { called = true; return { contract: '1.0', asOf: '2026-09-29T06:00:00Z', nextCursor: null, items: [] }; };
  try {
    const res = await GET(makeRequest('/api/ain/shared-agents?scope=public', fakeJwt('u1')));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, 'auth_required');
    assert.equal(called, false);
  } finally { deps.listSharedAgents = orig; }
}));
