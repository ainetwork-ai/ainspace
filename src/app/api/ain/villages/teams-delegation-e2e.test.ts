/**
 * 공통 항목 B(Space) 끝까지: 위임을 Teams 가 발급한다.
 * 라우트(materials·presence·invoke) → 실제 invokeSharedAgent → **진짜 HTTP 로 띄운 가짜 Teams** `POST /api/ain/delegation`
 * + 가짜 aindrive·Ainize(fetch 주입). 마을 자료와 사용자가 고른 파일이 이제 에이전트에 도착한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { verifyHs256Session } from '@/lib/ain-integration/app-session';
import { invokeDeps, villageDeps, villageMaterialsDeps } from '@/lib/ain-integration/deps';
import { findSecretKey, resetNativeSupport } from '@/lib/ain-integration/http';
import { invokeSharedAgent } from '@/lib/ain-integration/invoke';
import { memoryKv } from '@/lib/ain-integration/kv';
import { AIN_CONTRACT_VERSION, DELEGATION_PART_TYPE, FILE_REFS_PART_TYPE, conversationContextId, fileKey, type AgentRef, type FileRef } from '@/lib/ain-integration/types';
import { memoryVillageDirectory } from '@/lib/ain-integration/village-membership';
import { SESSION_ENV, TEST_SIGNING_KEY, fakeFetch, jsonResponse, signedJwt, withEnv } from '@/lib/ain-integration/__tests__/helpers';
import { PUT as MATERIALS_PUT } from './[slug]/materials/route';
import { PUT as PRESENCE_PUT } from './[slug]/presence/route';
import { POST as INVOKE } from '../invoke/route';

const AINDRIVE = 'https://aindrive.example';
const AINIZE = 'https://ainize.example';
const SSO = 'https://sso.example';
const AGENT_KEY = `${AINIZE}#gallery-guide`;
const POP_JWK = { kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0', kid: 'k1' };
const TEAMS_ACTION_URL = 'https://teams.example/settings/ain-sso';
const DLG_TOKEN = 'eyJ0eXAiOiJhaW4tcmRsZytqd3QifQ.teams-issued.sig';

const agent: AgentRef = {
  contract: AIN_CONTRACT_VERSION, registryIssuer: AINIZE, agentId: 'gallery-guide', releaseId: 'v1',
  ownerRef: { kind: 'wallet', issuer: AINIZE, subject: '0xabc' }, visibility: 'public',
  agentCardUrl: `${AINIZE}/agents/gallery-guide/.well-known/agent-card.json`, endpoint: `${AINIZE}/agents/gallery-guide`,
  supportedProtocolVersions: ['0.3.0'], skills: [], inputModes: ['text/plain'], outputModes: ['text/plain'], uiCapabilities: [],
  popJwk: POP_JWK, status: 'active', displayName: '갤러리 안내', updatedAt: '2026-09-29T06:00:00Z',
};
const ref = (id: string): FileRef => ({
  contract: AIN_CONTRACT_VERSION, issuer: AINDRIVE, driveId: 'drv_1', fileId: `p1:${id.padEnd(32, '0')}`, revision: 'm1-s1', kind: 'file',
  displayName: `${id}.pdf`, ownerRef: { kind: 'principal', issuer: AINDRIVE, subject: 'owner' }, availability: { state: 'online' }, sourceUrl: `${AINDRIVE}/d/drv_1/${id}.pdf`,
});
const PUB = ref('pub'); const MEM = ref('mem'); const AGT = ref('agt'); const PICK = ref('pick'); const SECRET = ref('secret');

interface TeamsCall { user: string | null; body: { agentRef?: AgentRef; fileKeys?: string[]; conversationContextId?: string; actions?: string[] } }

/**
 * 가짜 Teams web `/api/ain/delegation` — 계약 그대로: Bearer 는 **Teams backend access JWT**(iss `a2a-backend`,
 * aud `client-access`, backend 키) — 실제 Teams web 이 backend `/auth/me` 로 확인하는 바로 그 토큰(ainteams
 * `web/src/lib/ain-integration/space-caller-auth.ts`)이고, 그 밖의 발급자·audience·키는 401 `{error:'Unauthorized'}`.
 * 봉인된 세션 증명이 있는 사용자만, 그 사용자가 자기 aindrive 연결로 볼 수 있는 fileKey 만. 플래그 off 면 404.
 */
const TEAMS_BACKEND_ISSUER = 'a2a-backend';
const TEAMS_BACKEND_AUDIENCE = 'client-access';
async function startTeams(state: { proofs: Set<string>; visible: Map<string, Set<string>>; enabled: boolean; backendKey?: string }) {
  const calls: TeamsCall[] = [];
  const read = (r: IncomingMessage) => new Promise<string>((ok) => { let s = ''; r.on('data', (c) => { s += c; }); r.on('end', () => ok(s)); });
  const server: Server = createServer(async (rq, rs) => {
    const send = (status: number, body: unknown) => { rs.writeHead(status, { 'content-type': 'application/json' }); rs.end(JSON.stringify(body)); };
    if (rq.method !== 'POST' || rq.url !== '/api/ain/delegation') return send(404, { error: 'not found' });
    const raw = await read(rq);
    const bearer = /^Bearer (.+)$/.exec(rq.headers.authorization ?? '')?.[1] ?? '';
    const session = bearer ? verifyHs256Session(bearer, state.backendKey ?? TEST_SIGNING_KEY, { issuer: TEAMS_BACKEND_ISSUER, audience: TEAMS_BACKEND_AUDIENCE }) : null;
    let body: TeamsCall['body'] = {};
    try { body = JSON.parse(raw); } catch { /* bad */ }
    calls.push({ user: session?.userId ?? null, body });
    if (!state.enabled) return send(404, { error: { code: 'temporary_failure', message: 'off', retryable: false } });
    if (!session) return send(401, { error: 'Unauthorized' });
    if (!state.proofs.has(session.userId)) return send(401, { error: { code: 'auth_required', message: 'connect AIN SSO', retryable: false, actionUrl: TEAMS_ACTION_URL } });
    const can = state.visible.get(session.userId) ?? new Set();
    if (!body.fileKeys?.length || !body.fileKeys.every((k) => can.has(k))) return send(403, { error: { code: 'forbidden', message: 'not listable', retryable: false } });
    return send(200, { delegation: { token: DLG_TOKEN, exp: Math.floor(Date.now() / 1000) + 900, jti: `rdlg_${calls.length}` } });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ain/delegation`;
  return { url, calls, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

function upstream() {
  const ssoCalls: unknown[] = [];
  const messages: { parts: { kind: string; data?: Record<string, unknown>; metadata?: { type?: string } }[]; contextId: string }[] = [];
  const f = fakeFetch({
    '/api/shared-agents': () => jsonResponse({ contract: '1.0', asOf: '2026-09-29T06:00:00Z', nextCursor: null, items: [{ ref: agent, canInvoke: true }] }),
    '/api/oauth/shared': (url) => jsonResponse({ contract: '1.0', asOf: '2026-09-29T06:00:00Z', nextCursor: null,
      items: url.searchParams.get('scope') === 'shared_with_me' ? [PUB, MEM, AGT, PICK, SECRET].map((r) => ({ ref: r, role: 'viewer', shareOrigin: 'direct' })) : [] }),
    '/api/delegations/resource': (_u, init) => { ssoCalls.push(init?.body); return jsonResponse({ error: 'invalid_client' }, 401); },
    '/agents/gallery-guide': (_u, init) => {
      const b = JSON.parse(String(init?.body));
      messages.push(b.params.message);
      return jsonResponse({ jsonrpc: '2.0', id: b.id, result: { id: 'task_1', contextId: b.params.message.contextId, status: { state: 'completed' }, artifacts: [{ parts: [{ kind: 'text', text: '안내' }] }] } });
    },
  });
  // Teams(진짜 HTTP 서버)로 가는 요청은 실제 fetch 로, 나머지는 가짜 원본으로.
  const routed = async (input: string, init?: RequestInit) => (input.startsWith('http://127.0.0.1:') ? fetch(input, init) : f(input, init));
  return { f, routed, ssoCalls, messages };
}

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const req = (method: string, path: string, user: string | null, body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${signedJwt(user)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
});

async function wire(teamsState: Parameters<typeof startTeams>[0]) {
  const teams = await startTeams(teamsState);
  const kv = memoryKv();
  const dir = memoryVillageDirectory({ villages: ['alpha'], agents: [{ commonAgentId: AGENT_KEY, isPlaced: true, state: { x: 0, y: 0, behavior: 'idle', color: '#000', mapName: 'alpha' } }] });
  const up = upstream();
  const prev = { inv: { ...invokeDeps }, mat: { ...villageMaterialsDeps }, vil: { ...villageDeps } };
  let proofAsked = 0;
  villageDeps.directory = dir;
  villageDeps.now = () => Date.now();
  villageMaterialsDeps.store = { kv, isMember: (s, u) => dir.isMember(s, u) };
  villageMaterialsDeps.getAindriveAccountToken = async (u) => `aind_aat_${u}`;
  villageMaterialsDeps.resolveFiles = async (_o, keys) => keys.map((k) => [PUB, MEM, AGT].find((r) => fileKey(r) === k)!);
  invokeDeps.getAindriveAccountToken = async (u) => (u ? `aind_aat_${u}` : null);
  invokeDeps.getSessionProof = async () => { proofAsked++; return null; };
  invokeDeps.saveTaskRef = async () => {};
  invokeDeps.observeResolvedAgent = async () => {};
  invokeDeps.verifyVillageAgentOwner = async () => true;
  invokeDeps.invokeSharedAgent = (o, r) => invokeSharedAgent({ ...o, fetch: up.routed }, r);
  resetNativeSupport();
  await dir.setOwner('alpha', 'owner-1');
  for (const [r, audience] of [[PUB, 'public'], [MEM, 'members'], [AGT, 'agent']] as const) {
    assert.equal((await MATERIALS_PUT(req('PUT', '/api/ain/villages/alpha/materials', 'owner-1', { fileKey: fileKey(r), audience }), ctx('alpha'))).status, 200);
  }
  return {
    teams, up, proofAsked: () => proofAsked,
    restore: async () => { Object.assign(invokeDeps, prev.inv); Object.assign(villageMaterialsDeps, prev.mat); Object.assign(villageDeps, prev.vil); resetNativeSupport(); await teams.close(); },
  };
}

const ENV = {
  ...SESSION_ENV, AIN_INTEGRATION_ENABLED: 'true', NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined, AINDRIVE_URL: AINDRIVE, AINIZE_URL: AINIZE,
  AIN_SSO_ISSUER: SSO, AIN_SSO_CLIENT_ID: undefined, AIN_SSO_CLIENT_SECRET: undefined, AIN_SSO_CONNECT_URL: `${SSO}/connect`,
  AINDRIVE_CONNECT_URL: undefined, NEXT_PUBLIC_URL: undefined, AIN_TEAMS_DELEGATION_URL: undefined,
};

const invoke = (user: string | null, body: Record<string, unknown>) =>
  INVOKE(req('POST', '/api/ain/invoke', user, { agentKey: AGENT_KEY, text: '이 마을을 안내해 줘', conversation: 'thr_v', room: 'alpha', fileKeys: [], ...body }));

test('B: Teams 가 위임을 발급 → 마을 자료(public·agent)와 고른 파일이 에이전트에 도착한다(SSO 직접 호출·세션 증명 조회 없음)', withEnv(ENV, async () => {
  const state = { proofs: new Set(['visitor-9']), visible: new Map([['visitor-9', new Set([PUB, MEM, AGT, PICK].map(fileKey))]]), enabled: true };
  const w = await wire(state);
  try {
    await withEnv({ AIN_TEAMS_DELEGATION_URL: w.teams.url }, async () => {
      assert.equal((await PRESENCE_PUT(req('PUT', '/api/ain/villages/alpha/presence', 'visitor-9'), ctx('alpha'))).status, 200);
      const res = await invoke('visitor-9', { villageMaterials: true, fileKeys: [fileKey(PICK)] });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(findSecretKey(json), null);
      assert.ok(!JSON.stringify(json).includes(DLG_TOKEN), '위임 토큰은 응답에 없다');

      // Teams 가 받은 것: 호출자의 Teams JWT(= 검증된 visitor-9), 계약 바디
      assert.equal(w.teams.calls.length, 1);
      const call = w.teams.calls[0];
      assert.equal(call.user, 'visitor-9');
      assert.deepEqual(Object.keys(call.body).sort(), ['actions', 'agentRef', 'conversationContextId', 'fileKeys']);
      assert.deepEqual(call.body.actions, ['read']);
      assert.equal(call.body.agentRef?.agentId, 'gallery-guide');
      assert.deepEqual(call.body.agentRef?.popJwk, POP_JWK);
      assert.deepEqual([...(call.body.fileKeys ?? [])].sort(), [PICK, PUB, AGT].map(fileKey).sort());
      assert.equal(call.body.conversationContextId, conversationContextId({ account: 'visitor-9', org: null, product: 'ainspace', room: 'alpha', conversation: 'thr_v' }));

      // 에이전트가 받은 것: file-refs(고른 파일 + 마을 자료, members 자료 제외) + Teams 가 준 위임
      assert.equal(w.up.messages.length, 1);
      const m = w.up.messages[0];
      assert.deepEqual(m.parts.map((p) => p.metadata?.type ?? p.kind), ['text', FILE_REFS_PART_TYPE, DELEGATION_PART_TYPE]);
      assert.deepEqual((m.parts[1].data as { refs: FileRef[] }).refs.map((r) => r.displayName).sort(), ['agt.pdf', 'pick.pdf', 'pub.pdf']);
      assert.ok(!JSON.stringify(m).includes(MEM.fileId));
      const dlg = m.parts[2].data as { token: string; audience: string[]; jti: string; expiresAt: string };
      assert.equal(dlg.token, DLG_TOKEN);
      assert.deepEqual(dlg.audience, [AINDRIVE]);
      assert.equal(dlg.jti, 'rdlg_1');
      assert.ok(Date.parse(dlg.expiresAt) > Date.now());
      assert.equal(m.contextId, call.body.conversationContextId);

      // Space 는 SSO 를 직접 부르지 않고(클라이언트 자격도 없다) 세션 증명도 찾지 않는다
      assert.equal(w.up.ssoCalls.length, 0);
      assert.equal(w.proofAsked(), 0);
    })();
  } finally { await w.restore(); }
}));

test('B: Teams 오류 표 — 세션 증명 없음 401(actionUrl 전달), 볼 수 없는 파일 403, Teams 플래그 off 404 → 503, 파일 없는 대화는 Teams 를 부르지 않는다', withEnv(ENV, async () => {
  const state = { proofs: new Set<string>(), visible: new Map([['owner-1', new Set([PUB, AGT].map(fileKey))]]), enabled: true };
  const w = await wire(state);
  try {
    await withEnv({ AIN_TEAMS_DELEGATION_URL: w.teams.url }, async () => {
      const noProof = await invoke('owner-1', { villageMaterials: true });
      assert.equal(noProof.status, 401);
      const e1 = (await noProof.json()).error;
      assert.equal(e1.code, 'auth_required');
      assert.equal(e1.actionUrl, TEAMS_ACTION_URL);
      assert.ok(!e1.message.includes('connect AIN SSO'), 'Teams 문장은 되비추지 않는다');
      assert.equal(w.up.messages.length, 0, '위임이 없으면 에이전트를 부르지 않는다');

      state.proofs.add('owner-1');
      const forbidden = await invoke('owner-1', { villageMaterials: true, fileKeys: [fileKey(SECRET)] });
      assert.equal(forbidden.status, 403);
      assert.equal((await forbidden.json()).error.code, 'forbidden');
      assert.equal(w.up.messages.length, 0);

      assert.equal((await invoke('owner-1', { villageMaterials: true })).status, 200);
      assert.equal(w.up.messages.length, 1);

      state.enabled = false;
      const off = await invoke('owner-1', { villageMaterials: true });
      assert.equal(off.status, 503);
      assert.equal((await off.json()).error.detail, 'teams_delegation_disabled');

      const before = w.teams.calls.length;
      assert.equal((await invoke('owner-1', {})).status, 200, '파일 없는 대화');
      assert.equal(w.teams.calls.length, before);
    })();
  } finally { await w.restore(); }
}));

test('B: AIN_TEAMS_DELEGATION_URL 미설정 → 예전대로 auth_required(Teams 를 부르지 않는다); https 가 아닌 원격 URL 은 무시', withEnv(ENV, async () => {
  const state = { proofs: new Set(['owner-1']), visible: new Map([['owner-1', new Set([PUB, AGT].map(fileKey))]]), enabled: true };
  const w = await wire(state);
  try {
    // 미설정: SSO 클라이언트도 없는 배포 → temporary_failure(ain_sso_client_missing); 설정돼 있으면 세션 증명 없음 → auth_required
    const r1 = await invoke('owner-1', { villageMaterials: true });
    assert.equal(r1.status, 503);
    assert.equal((await r1.json()).error.detail, 'ain_sso_client_missing');
    await withEnv({ AIN_SSO_CLIENT_ID: 'client-ainspace', AIN_SSO_CLIENT_SECRET: 's3cret' }, async () => {
      const r2 = await invoke('owner-1', { villageMaterials: true });
      assert.equal(r2.status, 401);
      assert.equal((await r2.json()).error.actionUrl, `${SSO}/connect`);
    })();
    await withEnv({ AIN_TEAMS_DELEGATION_URL: 'http://teams.example/api/ain/delegation' }, async () => {
      assert.equal((await invoke('owner-1', { villageMaterials: true })).status, 503);
    })();
    assert.equal(w.teams.calls.length, 0);
  } finally { await w.restore(); }
}));

test('B: Teams 가 Space 의 Bearer 를 받지 않으면(발급자·키 불일치) 401 teams_session_invalid — AIN SSO 연결 안내로 바꾸지 않는다', withEnv(ENV, async () => {
  const state = { proofs: new Set(['owner-1']), visible: new Map([['owner-1', new Set([PUB, AGT].map(fileKey))]]), enabled: true, backendKey: 'a-different-teams-backend-signing-key-32+' };
  const w = await wire(state);
  try {
    await withEnv({ AIN_TEAMS_DELEGATION_URL: w.teams.url }, async () => {
      const res = await invoke('owner-1', { villageMaterials: true });
      assert.equal(res.status, 401);
      const e = (await res.json()).error;
      assert.equal(e.code, 'auth_required');
      assert.equal(e.detail, 'teams_session_invalid');
      assert.equal(e.actionUrl, undefined);
      assert.equal(w.teams.calls.length, 1);
      assert.equal(w.teams.calls[0].user, null);
      assert.equal(w.up.messages.length, 0);
    })();
  } finally { await w.restore(); }
}));
