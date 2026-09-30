import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import taskRef from '@/lib/ain-integration/__fixtures__/task-ref.json';
import { findSecretKey } from '@/lib/ain-integration/http';
import { AinContractError, HTTP_STATUS_FOR, type TaskRef } from '@/lib/ain-integration/types';
import { SESSION_ENV, fakeJwt, signedJwt, withEnv } from '@/lib/ain-integration/__tests__/helpers';
import { invokeDeps as deps } from '@/lib/ain-integration/deps';
import { POST } from './route';

const ON = { ...SESSION_ENV, AIN_INTEGRATION_ENABLED: 'true', NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined };
const OFF = { AIN_INTEGRATION_ENABLED: undefined, NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined };
const SSO_ENV = { AIN_SSO_ISSUER: 'https://sso.example', AIN_SSO_CLIENT_ID: 'client-ainspace', AIN_SSO_CLIENT_SECRET: 's3cret', AINDRIVE_URL: 'https://aindrive.example', AINIZE_URL: 'https://ainize.example' };
const body = { agentKey: 'https://ainize.example#doc-summary', text: '요약', fileKeys: ['https://aindrive.example#drv_1#p1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], conversation: 'thr_1' };

const post = (b: unknown, bearer?: string, path = '/api/ain/invoke') => POST(new NextRequest(`http://localhost${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: typeof b === 'string' ? b : JSON.stringify(b),
}));

type Deps = typeof deps;
async function withDeps(patch: Partial<Deps>, fn: () => Promise<void>) {
  const orig: Partial<Deps> = {};
  for (const k of Object.keys(patch) as (keyof Deps)[]) { (orig as Record<string, unknown>)[k] = deps[k]; (deps as Record<string, unknown>)[k] = patch[k]; }
  try { await fn(); } finally { for (const k of Object.keys(patch) as (keyof Deps)[]) (deps as Record<string, unknown>)[k] = orig[k]; }
}

test('플래그 off → 404', withEnv(OFF, async () => {
  assert.equal((await post(body, signedJwt('u1'))).status, 404);
}));

test('세션 없음 → 401 auth_required (원본은 호출되지 않는다)', withEnv(ON, async () => {
  let called = false;
  await withDeps({ invokeSharedAgent: async () => { called = true; return { task: taskRef as TaskRef, text: '' }; } }, async () => {
    const res = await post(body);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, 'auth_required');
    assert.equal(called, false);
  });
}));

test('잘못된 바디 → 400 unsupported_input', withEnv(ON, async () => {
  assert.equal((await post('{not json', signedJwt('u1'))).status, 400);
  assert.equal((await post({ ...body, agentKey: 'nohash' }, signedJwt('u1'))).status, 400);
  assert.equal((await post({ ...body, fileKeys: ['bad'] }, signedJwt('u1'))).status, 400);
  const res = await post({ ...body, conversation: '' }, signedJwt('u1'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'unsupported_input');
}));

test('세션 증명 없음 → 401 auth_required + actionUrl(AIN SSO); backend JWT 는 세션 증명으로 쓰이지 않는다', withEnv({ ...ON, ...SSO_ENV, AIN_SSO_CONNECT_URL: 'https://sso.example/connect' }, async () => {
  const jwt = signedJwt('user-42');
  let proofArg: string | null | undefined;
  let seenProof: string | null | undefined;
  await withDeps({
    getAindriveAccountToken: async () => 'aind_aat_secret',
    getSessionProof: async (userId) => { proofArg = userId; return null; },
    invokeSharedAgent: async (o) => { seenProof = await o.getSessionProof(); if (!seenProof) throw new AinContractError('auth_required', 'AIN SSO 연결 필요', { actionUrl: o.sso?.connectUrl }); return { task: taskRef as TaskRef, text: '' }; },
  }, async () => {
    const res = await post(body, jwt);
    assert.equal(res.status, 401);
    const b = await res.json();
    assert.equal(b.error.code, 'auth_required');
    assert.equal(b.error.actionUrl, 'https://sso.example/connect');
    assert.equal(proofArg, 'user-42');
    assert.equal(seenProof, null);
    assert.notEqual(seenProof, jwt);
  });
}));

test('성공: 옵션이 env·세션에서 조립되고 응답은 {task, text}, 토큰 없음, no-store; TaskRef 는 스레드 옆에 저장', withEnv({ ...ON, ...SSO_ENV }, async () => {
  const jwt = signedJwt('user-42');
  let seen: { aindriveUrl: string; ainizeUrl: string; aindriveToken: string | null; sso: { issuer: string; clientId: string; clientSecret: string } | null; scope: { account: string; org: string | null; product: string }; req: unknown } | null = null;
  let saved: { userId: string; conversation: string; taskId: string } | null = null;
  await withDeps({
    getAindriveAccountToken: async () => 'aind_aat_secret',
    getSessionProof: async () => 'eyJ.idtoken.sig',
    invokeSharedAgent: async (o, req) => { seen = { aindriveUrl: o.aindriveUrl, ainizeUrl: o.ainizeUrl, aindriveToken: o.aindriveToken, sso: o.sso && { issuer: o.sso.issuer, clientId: o.sso.clientId, clientSecret: o.sso.clientSecret }, scope: o.scope, req }; return { task: taskRef as TaskRef, text: '요약 Sources' }; },
    saveTaskRef: async (userId, conversation, task) => { saved = { userId, conversation, taskId: task.taskId }; },
  }, async () => {
    const res = await post({ ...body, room: 'village-1' }, jwt);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const b = await res.json();
    assert.deepEqual(b.task, taskRef);
    assert.equal(b.text, '요약 Sources');
    assert.equal(findSecretKey(b), null);
    const out = JSON.stringify(b);
    assert.ok(!out.includes(jwt) && !out.includes('aind_aat_secret') && !out.includes('eyJ.idtoken.sig') && !out.includes('s3cret'));
    assert.deepEqual(seen, {
      aindriveUrl: 'https://aindrive.example', ainizeUrl: 'https://ainize.example', aindriveToken: 'aind_aat_secret',
      sso: { issuer: 'https://sso.example', clientId: 'client-ainspace', clientSecret: 's3cret' },
      scope: { account: 'user-42', org: null, product: 'ainspace' },
      req: { ...body, room: 'village-1' },
    });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(saved, { userId: 'user-42', conversation: 'thr_1', taskId: taskRef.taskId });
  });
}));

test('SSO 클라이언트 자격 없음 → sso:null 로 전달(어댑터가 판단); 어댑터 오류는 계약 바디로', withEnv({ ...ON, AIN_SSO_CLIENT_ID: undefined, AIN_SSO_CLIENT_SECRET: undefined }, async () => {
  let sso: unknown = 'unset';
  await withDeps({
    getAindriveAccountToken: async () => 't',
    getSessionProof: async () => null,
    invokeSharedAgent: async (o) => { sso = o.sso; throw new AinContractError('agent_stopped', '중지됨'); },
    saveTaskRef: async () => {},
  }, async () => {
    const res = await post(body, signedJwt('u1'));
    assert.equal(sso, null);
    assert.equal(res.status, 409);
    const b = await res.json();
    assert.equal(b.error.code, 'agent_stopped');
    assert.equal(b.error.retryable, false);
  });
}));

test('위조(서명 없는)·sub 없는 bearer 와 ?token= 쿼리 → 401 auth_required; 원본·Redis 조회는 일어나지 않는다', withEnv({ ...ON, ...SSO_ENV }, async () => {
  let touched = 0;
  await withDeps({
    getAindriveAccountToken: async () => { touched++; return 't'; },
    getSessionProof: async () => { touched++; return 'eyJ.idtoken.sig'; },
    invokeSharedAgent: async () => { touched++; return { task: taskRef as TaskRef, text: '' }; },
  }, async () => {
    for (const b of [fakeJwt('user-42'), 'h.e30.s', signedJwt('user-42', { key: 'wrong-key-wrong-key-wrong-key-wrong-key' }), signedJwt('', { sub: null })]) {
      const res = await post(body, b);
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error.code, 'auth_required');
    }
    const q = await post(body, undefined, `/api/ain/invoke?token=${encodeURIComponent(signedJwt('user-42'))}`);
    assert.equal(q.status, 401);
    assert.equal(touched, 0);
  });
}));

test('응답 HTTP status 는 코드 표(HTTP_STATUS_FOR)에서 온다 — 원본의 status(upstreamStatus)는 되비추지 않는다', withEnv({ ...ON, ...SSO_ENV }, async () => {
  await withDeps({
    getAindriveAccountToken: async () => 't', getSessionProof: async () => 'eyJ.idtoken.sig', saveTaskRef: async () => {},
    invokeSharedAgent: async () => { throw new AinContractError('unsupported_input', 'agentKey 모양'); },
  }, async () => {
    const res = await post(body, signedJwt('u1'));
    assert.equal(res.status, HTTP_STATUS_FOR.unsupported_input);
    assert.equal((await res.json()).error.code, 'unsupported_input');
  });
  await withDeps({
    getAindriveAccountToken: async () => 't', getSessionProof: async () => 'eyJ.idtoken.sig', saveTaskRef: async () => {},
    invokeSharedAgent: async () => { throw new AinContractError('temporary_failure', '에이전트가 요청을 처리하지 못했습니다.', { retryable: true, detail: 'agent_rpc_error', upstreamStatus: 502 }); },
  }, async () => {
    const res = await post(body, signedJwt('u1'));
    assert.equal(res.status, 503);
    const b = await res.json();
    assert.equal(b.error.code, 'temporary_failure');
    assert.equal(b.error.detail, 'agent_rpc_error');
    assert.equal(findSecretKey(b), null);
    assert.ok(!('upstreamStatus' in b.error));
  });
  // 원본이 200 대가 아닌 어떤 status 를 주든(예: 418) 응답은 코드 표.
  await withDeps({
    getAindriveAccountToken: async () => 't', getSessionProof: async () => 'eyJ.idtoken.sig', saveTaskRef: async () => {},
    invokeSharedAgent: async () => { throw new AinContractError('forbidden', '볼 수 없음', { upstreamStatus: 418 }); },
  }, async () => {
    const res = await post(body, signedJwt('u1'));
    assert.equal(res.status, 403);
  });
}));

test('20.1 C: requestId(차례 id)는 검증 뒤 그대로 어댑터로 간다; 모양이 틀리면 400(원본 호출 없음)', withEnv({ ...ON, ...SSO_ENV }, async () => {
  const seen: unknown[] = [];
  await withDeps({
    getAindriveAccountToken: async () => 't', getSessionProof: async () => 'eyJ.idtoken.sig', saveTaskRef: async () => {},
    invokeSharedAgent: async (_o, req) => { seen.push(req); return { task: taskRef as TaskRef, text: '답' }; },
  }, async () => {
    assert.equal((await post({ ...body, requestId: 'turn_1' }, signedJwt('u1'))).status, 200);
    const bad = await post({ ...body, requestId: 'has space' }, signedJwt('u1'));
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, 'unsupported_input');
    assert.deepEqual(seen, [{ ...body, requestId: 'turn_1' }]);
  });
}));
