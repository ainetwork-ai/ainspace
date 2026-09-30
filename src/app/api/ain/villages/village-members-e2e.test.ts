/**
 * 17.5 끝까지: 마을 생성자 = 소유자·멤버 → 소유자가 멤버를 넣고 뺀다 → 방문자·멤버가 보는 자료가 다르다 →
 * 마을 자료 invoke 는 (배치된 에이전트 + 멤버 또는 검증된 체류)일 때만, 그리고 고른 파일과 **똑같은 경로**(해석·위임·전송)를 탄다.
 * 라우트(members·materials·presence·invoke) → 실제 invokeSharedAgent → 가짜 aindrive·SSO·Ainize.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { invokeDeps, villageDeps, villageMaterialsDeps } from '@/lib/ain-integration/deps';
import { resetNativeSupport } from '@/lib/ain-integration/http';
import { invokeSharedAgent } from '@/lib/ain-integration/invoke';
import { memoryKv } from '@/lib/ain-integration/kv';
import { AIN_CONTRACT_VERSION, DELEGATION_PART_TYPE, FILE_REFS_PART_TYPE, fileKey, type AgentRef, type FileRef } from '@/lib/ain-integration/types';
import { memoryVillageDirectory, PRESENCE_TTL_MS, recordVillageCreator } from '@/lib/ain-integration/village-membership';
import { SESSION_ENV, fakeFetch, jsonResponse, signedJwt, withEnv } from '@/lib/ain-integration/__tests__/helpers';
import { DELETE as MEMBERS_DELETE, GET as MEMBERS_GET, POST as MEMBERS_POST } from '@/app/api/villages/[slug]/members/route';
import { GET as MATERIALS_GET, PUT as MATERIALS_PUT } from './[slug]/materials/route';
import { PUT as PRESENCE_PUT, DELETE as PRESENCE_DELETE } from './[slug]/presence/route';
import { POST as INVOKE } from '../invoke/route';

const AINDRIVE = 'https://aindrive.example';
const AINIZE = 'https://ainize.example';
const SSO = 'https://sso.example';
const AGENT_KEY = `${AINIZE}#gallery-guide`;
const OTHER_AGENT = `${AINIZE}#stranger`;
const SESSION_PROOF = 'eyJhbGciOiJFUzI1NiJ9.idtoken.sig';
const ENV = {
  ...SESSION_ENV, AIN_INTEGRATION_ENABLED: 'true', NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined, AINDRIVE_URL: AINDRIVE, AINIZE_URL: AINIZE,
  AIN_SSO_ISSUER: SSO, AIN_SSO_CLIENT_ID: 'client-ainspace', AIN_SSO_CLIENT_SECRET: 's3cret', AIN_SSO_CONNECT_URL: `${SSO}/connect`,
  AINDRIVE_CONNECT_URL: undefined, NEXT_PUBLIC_URL: undefined,
};
const POP_JWK = { kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0', kid: 'k1' };

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
const PUB = ref('pub'); const MEM = ref('mem'); const AGT = ref('agt');

const bearer = (user: string) => ({ authorization: `Bearer ${signedJwt(user)}` });
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const req = (method: string, path: string, user?: string | null, body?: unknown, extra: Record<string, string> = {}) => new NextRequest(`http://localhost${path}`, {
  method, headers: { 'content-type': 'application/json', ...(user ? bearer(user) : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}),
});
const names = (b: { items: { ref: FileRef }[] }) => b.items.map((i) => i.ref.displayName);

/** 가짜 원본: aindrive 공유 목록(PUB·MEM·AGT 모두 호출자에게 보임), SSO 위임, Ainize 목록·A2A. 받은 요청을 기록한다. */
function upstream() {
  const delegations: { resources: unknown; agent: string }[] = [];
  const messages: { parts: { kind: string; data?: Record<string, unknown>; metadata?: { type?: string } }[]; messageId: string; contextId: string }[] = [];
  const f = fakeFetch({
    '/api/shared-agents': () => jsonResponse({ contract: '1.0', asOf: '2026-09-29T06:00:00Z', nextCursor: null, items: [{ ref: agent, canInvoke: true }] }),
    '/api/oauth/shared': (url) => jsonResponse({ contract: '1.0', asOf: '2026-09-29T06:00:00Z', nextCursor: null,
      items: url.searchParams.get('scope') === 'shared_with_me' ? [PUB, MEM, AGT].map((r) => ({ ref: r, role: 'viewer', shareOrigin: 'direct' })) : [] }),
    '/api/delegations/resource': (_u, init) => {
      const b = JSON.parse(String(init?.body));
      delegations.push({ resources: b.resources, agent: b.agent });
      if (b.sessionProof !== SESSION_PROOF) return jsonResponse({ error: 'session_proof_invalid' }, 400);
      return jsonResponse({ jti: 'rdlg_1', token: 'eyJ.dlg.sig', expiresAt: Math.floor(Date.now() / 1000) + b.ttlSeconds, reused: false }, 201);
    },
    '/agents/gallery-guide': (_u, init) => {
      const b = JSON.parse(String(init?.body));
      messages.push(b.params.message);
      return jsonResponse({ jsonrpc: '2.0', id: b.id, result: { id: 'task_1', contextId: b.params.message.contextId, status: { state: 'completed' }, artifacts: [{ parts: [{ kind: 'text', text: '안내' }] }] } });
    },
  });
  return { f, delegations, messages };
}

function wire(opts: { sessionProof: string | null }) {
  const kv = memoryKv();
  const dir = memoryVillageDirectory({ villages: ['alpha', 'beta'] });
  const up = upstream();
  let clock = new Date('2026-09-30T00:00:00Z').getTime();
  const prev = { inv: { ...invokeDeps }, mat: { ...villageMaterialsDeps }, vil: { ...villageDeps } };
  villageDeps.directory = dir;
  villageDeps.now = () => clock;
  villageMaterialsDeps.store = { kv, isMember: (s, u) => dir.isMember(s, u) };
  villageMaterialsDeps.getAindriveAccountToken = async (u) => `aind_aat_${u}`;
  villageMaterialsDeps.resolveFiles = async (_o, keys) => keys.map((k) => [PUB, MEM, AGT].find((r) => fileKey(r) === k)!);
  invokeDeps.getAindriveAccountToken = async (u) => (u ? `aind_aat_${u}` : null);
  invokeDeps.getSessionProof = async () => opts.sessionProof;
  invokeDeps.saveTaskRef = async () => {};
  invokeDeps.observeResolvedAgent = async () => {};
  invokeDeps.verifyVillageAgentOwner = async () => true;
  invokeDeps.invokeSharedAgent = (o, r) => invokeSharedAgent({ ...o, fetch: up.f }, r);
  resetNativeSupport();
  return {
    kv, dir, up, advance: (ms: number) => { clock += ms; },
    restore: () => { Object.assign(invokeDeps, prev.inv); Object.assign(villageMaterialsDeps, prev.mat); Object.assign(villageDeps, prev.vil); resetNativeSupport(); },
  };
}

test('17.5 멤버십: 생성자 = 소유자·멤버, 소유자만 멤버를 넣고 뺀다 → 방문자·멤버 가시성이 그에 따라 바뀐다', withEnv(ENV, async () => {
  const w = wire({ sessionProof: SESSION_PROOF });
  try {
    // 마을 생성(POST /api/villages 가 저장 뒤 부르는 것): 검증된 bearer 의 사용자가 소유자가 된다
    assert.equal(await recordVillageCreator(req('POST', '/api/villages', 'owner-1'), 'alpha', w.dir), 'owner-1');
    // 재저장·다른 사람 bearer 로 소유자가 바뀌지 않는다; bearer 없음·위조·플래그 off 는 기록하지 않는다
    assert.equal(await recordVillageCreator(req('POST', '/api/villages', 'intruder'), 'alpha', w.dir), 'owner-1');
    assert.equal(await recordVillageCreator(req('POST', '/api/villages'), 'beta', w.dir), null);
    assert.equal(await recordVillageCreator(req('POST', '/api/villages', null, undefined, { authorization: 'Bearer h.e30.s' }), 'beta', w.dir), null);
    await withEnv({ AIN_INTEGRATION_ENABLED: undefined }, async () => {
      assert.equal(await recordVillageCreator(req('POST', '/api/villages', 'owner-2'), 'beta', w.dir), null);
    })();
    assert.equal(await w.dir.getOwner('beta'), null);

    const members = async (user: string) => (await MEMBERS_GET(req('GET', '/api/villages/alpha/members', user), ctx('alpha'))).json();
    assert.deepEqual(await members('owner-1'), { owner: 'owner-1', members: ['owner-1'] });
    assert.equal((await MEMBERS_GET(req('GET', '/api/villages/alpha/members', 'visitor-9'), ctx('alpha'))).status, 403);

    // 소유자가 자료를 붙인다(소유자는 멤버)
    for (const [r, audience] of [[PUB, 'public'], [MEM, 'members'], [AGT, 'agent']] as const) {
      const res = await MATERIALS_PUT(req('PUT', '/api/ain/villages/alpha/materials', 'owner-1', { fileKey: fileKey(r), audience }), ctx('alpha'));
      assert.equal(res.status, 200);
    }
    const view = async (user: string) => (await (await MATERIALS_GET(req('GET', '/api/ain/villages/alpha/materials', user), ctx('alpha'))).json()) as { viewer: string; items: { ref: FileRef }[] };
    let m2 = await view('member-2');
    assert.equal(m2.viewer, 'visitor');
    assert.deepEqual(names(m2), ['pub.pdf']);
    // 멤버가 아닌 사람은 자료를 붙일 수 없다
    assert.equal((await MATERIALS_PUT(req('PUT', '/api/ain/villages/alpha/materials', 'member-2', { fileKey: fileKey(PUB), audience: 'public' }), ctx('alpha'))).status, 403);

    // 멤버 추가: 방문자·잘못된 입력·없는 마을은 거절, 소유자는 된다
    assert.equal((await MEMBERS_POST(req('POST', '/api/villages/alpha/members', 'visitor-9', { userId: 'member-2' }), ctx('alpha'))).status, 403);
    assert.equal((await MEMBERS_POST(req('POST', '/api/villages/alpha/members', null, { userId: 'member-2' }), ctx('alpha'))).status, 401);
    assert.equal((await MEMBERS_POST(req('POST', '/api/villages/alpha/members', 'owner-1', { userId: 'bad id/../' }), ctx('alpha'))).status, 400);
    assert.equal((await MEMBERS_POST(req('POST', '/api/villages/nowhere/members', 'owner-1', { userId: 'member-2' }), ctx('nowhere'))).status, 404);
    assert.equal((await MEMBERS_POST(req('POST', '/api/villages/alpha/members', 'owner-1', { userId: 'member-2', owner: true }), ctx('alpha'))).status, 403, '소유자 지정은 관리자만');
    const added = await MEMBERS_POST(req('POST', '/api/villages/alpha/members', 'owner-1', { userId: 'member-2' }), ctx('alpha'));
    assert.equal(added.status, 200);
    assert.deepEqual(await added.json(), { owner: 'owner-1', members: ['member-2', 'owner-1'] });

    m2 = await view('member-2');
    assert.equal(m2.viewer, 'member');
    assert.deepEqual(names(m2), ['pub.pdf', 'mem.pdf']);
    assert.deepEqual(names(await view('visitor-9')), ['pub.pdf']);
    // 멤버가 된 사람도 다른 멤버를 넣을 수는 없다(소유자만)
    assert.equal((await MEMBERS_POST(req('POST', '/api/villages/alpha/members', 'member-2', { userId: 'visitor-9' }), ctx('alpha'))).status, 403);
    assert.deepEqual(await members('member-2'), { owner: 'owner-1', members: ['member-2', 'owner-1'] });

    // 빼기: 멤버 자신·방문자는 못 하고, 소유자 자신은 뺄 수 없다
    assert.equal((await MEMBERS_DELETE(req('DELETE', '/api/villages/alpha/members?userId=member-2', 'member-2'), ctx('alpha'))).status, 403);
    assert.equal((await MEMBERS_DELETE(req('DELETE', '/api/villages/alpha/members?userId=owner-1', 'owner-1'), ctx('alpha'))).status, 400);
    assert.equal((await MEMBERS_DELETE(req('DELETE', '/api/villages/alpha/members?userId=member-2', 'owner-1'), ctx('alpha'))).status, 200);
    m2 = await view('member-2');
    assert.equal(m2.viewer, 'visitor');
    assert.deepEqual(names(m2), ['pub.pdf']);

    // 소유자가 없는 기존 마을(beta): 관리자(미들웨어가 붙인 x-admin-verified)만 소유자를 정한다
    assert.equal((await MEMBERS_POST(req('POST', '/api/villages/beta/members', 'someone', { userId: 'someone' }), ctx('beta'))).status, 403);
    const admin = await MEMBERS_POST(req('POST', '/api/villages/beta/members', null, { userId: 'owner-b', owner: true }, { 'x-admin-verified': 'true' }), ctx('beta'));
    assert.equal(admin.status, 200);
    assert.equal(await w.dir.getOwner('beta'), 'owner-b');
    assert.equal(await w.dir.isMember('beta', 'owner-b'), true);

    // 플래그 off → 404
    await withEnv({ AIN_INTEGRATION_ENABLED: undefined }, async () => {
      assert.equal((await MEMBERS_GET(req('GET', '/api/villages/alpha/members', 'owner-1'), ctx('alpha'))).status, 404);
      assert.equal((await MEMBERS_POST(req('POST', '/api/villages/alpha/members', 'owner-1', { userId: 'x' }), ctx('alpha'))).status, 404);
      assert.equal((await MEMBERS_POST(req('POST', '/api/villages/alpha/members', null, { userId: 'x' }, { 'x-admin-verified': 'true' }), ctx('alpha'))).status, 404);
    })();
  } finally { w.restore(); }
}));

const invoke = (user: string, body: Record<string, unknown>) => INVOKE(req('POST', '/api/ain/invoke', user, { agentKey: AGENT_KEY, text: '이 마을을 안내해 줘', conversation: 'thr_v', room: 'alpha', fileKeys: [], ...body }));

async function seedAlpha(w: ReturnType<typeof wire>) {
  await w.dir.setOwner('alpha', 'owner-1');
  for (const [r, audience] of [[PUB, 'public'], [MEM, 'members'], [AGT, 'agent']] as const) {
    assert.equal((await MATERIALS_PUT(req('PUT', '/api/ain/villages/alpha/materials', 'owner-1', { fileKey: fileKey(r), audience }), ctx('alpha'))).status, 200);
  }
}

test('17.5 invoke: 마을 자료는 그 마을에 배치된 에이전트에게만, 호출자가 멤버이거나 검증된 체류 중일 때만', withEnv(ENV, async () => {
  const w = wire({ sessionProof: SESSION_PROOF });
  try {
    await seedAlpha(w);
    // 에이전트가 alpha 에 배치되지 않았다 → 403, 원본은 한 번도 불리지 않는다
    const notPlaced = await invoke('owner-1', { villageMaterials: true });
    assert.equal(notPlaced.status, 403);
    assert.equal((await notPlaced.json()).error.detail, 'agent_not_placed_in_village');
    // 다른 마을에 배치됨·비활성·배치 해제도 같은 결과
    w.dir.agents.push({ commonAgentId: AGENT_KEY, isPlaced: true, state: { x: 0, y: 0, behavior: 'idle', color: '#000', mapName: 'beta' } });
    w.dir.agents.push({ commonAgentId: AGENT_KEY, isPlaced: false, state: { x: 0, y: 0, behavior: 'idle', color: '#000', mapName: 'alpha' } });
    w.dir.agents.push({ commonAgentId: AGENT_KEY, isPlaced: true, backendStatus: 'inactive', state: { x: 0, y: 0, behavior: 'idle', color: '#000', mapName: 'alpha' } });
    assert.equal((await invoke('owner-1', { villageMaterials: true })).status, 403);
    assert.equal(w.up.f.calls.length, 0);

    w.dir.agents.push({ commonAgentId: AGENT_KEY, isPlaced: true, state: { x: 0, y: 0, behavior: 'idle', color: '#000', mapName: 'alpha' } });
    // 배치된 에이전트여도 다른 agentKey 를 고르면 403
    assert.equal((await invoke('owner-1', { villageMaterials: true, agentKey: OTHER_AGENT })).status, 403);
    // 방문자: 체류 기록이 없으면 403(not_in_village)
    const away = await invoke('visitor-9', { villageMaterials: true });
    assert.equal(away.status, 403);
    assert.equal((await away.json()).error.detail, 'not_in_village');
    assert.equal(w.up.f.calls.length, 0);
    // 잘못된 room → 400
    assert.equal((await invoke('owner-1', { villageMaterials: true, room: 'Not A Slug' })).status, 400);

    // 멤버(소유자)는 체류 없이 된다
    const owner = await invoke('owner-1', { villageMaterials: true });
    assert.equal(owner.status, 200);
    // 방문자: 검증된 체류를 기록하면 된다. 없는 마을에는 기록할 수 없다.
    assert.equal((await PRESENCE_PUT(req('PUT', '/api/ain/villages/nowhere/presence', 'visitor-9'), ctx('nowhere'))).status, 404);
    assert.equal((await PRESENCE_PUT(req('PUT', '/api/ain/villages/alpha/presence'), ctx('alpha'))).status, 401);
    assert.equal((await PRESENCE_PUT(req('PUT', '/api/ain/villages/alpha/presence', 'visitor-9'), ctx('alpha'))).status, 200);
    assert.equal((await invoke('visitor-9', { villageMaterials: true })).status, 200);
    // 체류가 오래되면 다시 403; 떠나면(DELETE) 403
    w.advance(PRESENCE_TTL_MS + 1);
    assert.equal((await invoke('visitor-9', { villageMaterials: true })).status, 403);
    await PRESENCE_PUT(req('PUT', '/api/ain/villages/alpha/presence', 'visitor-9'), ctx('alpha'));
    assert.equal((await invoke('visitor-9', { villageMaterials: true })).status, 200);
    await PRESENCE_DELETE(req('DELETE', '/api/ain/villages/alpha/presence', 'visitor-9'), ctx('alpha'));
    assert.equal((await invoke('visitor-9', { villageMaterials: true })).status, 403);
    // 다른 마을의 체류는 alpha 에 쓰이지 않는다
    await PRESENCE_PUT(req('PUT', '/api/ain/villages/beta/presence', 'visitor-9'), ctx('beta'));
    assert.equal((await invoke('visitor-9', { villageMaterials: true })).status, 403);
    // villageMaterials 없이 부르는 일반 대화는 이 조건과 무관하다
    assert.equal((await invoke('visitor-9', {})).status, 200);
  } finally { w.restore(); }
}));

test('17.5 invoke: 마을 자료는 고른 파일과 똑같은 해석·위임·전송 경로를 탄다(members 자료는 빠진다)', withEnv(ENV, async () => {
  const w = wire({ sessionProof: SESSION_PROOF });
  try {
    await seedAlpha(w);
    w.dir.agents.push({ commonAgentId: AGENT_KEY, isPlaced: true, state: { x: 0, y: 0, behavior: 'idle', color: '#000', mapName: 'alpha' } });
    await PRESENCE_PUT(req('PUT', '/api/ain/villages/alpha/presence', 'visitor-9'), ctx('alpha'));

    // 사용자가 같은 두 파일을 마을 자료 목록 순서대로 직접 고른 경우와 비교한다
    const manage = await (await MATERIALS_GET(req('GET', '/api/ain/villages/alpha/materials?view=manage', 'owner-1'), ctx('alpha'))).json() as { items: { ref: FileRef; audience: string }[] };
    const order = manage.items.filter((i) => i.audience !== 'members').map((i) => fileKey(i.ref));
    assert.deepEqual([...order].sort(), [fileKey(PUB), fileKey(AGT)].sort());

    const viaMaterials = await invoke('visitor-9', { villageMaterials: true });
    assert.equal(viaMaterials.status, 200);
    const picked = await invoke('visitor-9', { fileKeys: order });
    assert.equal(picked.status, 200);
    const [a, b] = [await viaMaterials.json(), await picked.json()];

    // 같은 위임 요청(같은 에이전트·같은 리소스), 같은 A2A 메시지 모양(text → file-refs → delegation), 같은 idempotencyKey
    assert.equal(w.up.delegations.length, 2);
    assert.deepEqual(w.up.delegations[0], w.up.delegations[1]);
    assert.deepEqual(w.up.delegations[0].resources, order.map((resource) => ({ resource, actions: ['read'] })));
    const [ma, mb] = w.up.messages;
    const kinds = (m: typeof ma) => m.parts.map((p) => p.metadata?.type ?? p.kind);
    assert.deepEqual(kinds(ma), ['text', FILE_REFS_PART_TYPE, DELEGATION_PART_TYPE]);
    assert.deepEqual(kinds(ma), kinds(mb));
    assert.deepEqual(ma.parts[1].data, mb.parts[1].data);
    assert.deepEqual((ma.parts[1].data as { refs: FileRef[] }).refs.map((r) => r.displayName).sort(), ['agt.pdf', 'pub.pdf']);
    assert.ok(!JSON.stringify(ma).includes(MEM.fileId), 'members 자료는 에이전트에 가지 않는다');
    assert.equal(ma.messageId, mb.messageId);
    assert.equal(a.task.idempotencyKey, b.task.idempotencyKey);
    assert.deepEqual(a.task.sources, b.task.sources);
    // 파일 해석은 aindrive 에서 호출자 자신의 토큰으로(고른 파일과 같다)
    const auth = w.up.f.calls.filter((c) => c.url.startsWith(`${AINDRIVE}/api/oauth/shared`)).map((c) => new Headers(c.init?.headers).get('authorization'));
    assert.ok(auth.length >= 2 && auth.every((h) => h === 'Bearer aind_aat_visitor-9'));
  } finally { w.restore(); }
}));

test('17.5 invoke: 세션 증명이 없으면(Space 운영 = B 미적용) 마을 자료도 고른 파일과 똑같이 auth_required — 조용히 빼지 않는다', withEnv(ENV, async () => {
  const w = wire({ sessionProof: null });
  try {
    await seedAlpha(w);
    w.dir.agents.push({ commonAgentId: AGENT_KEY, isPlaced: true, state: { x: 0, y: 0, behavior: 'idle', color: '#000', mapName: 'alpha' } });
    const viaMaterials = await invoke('owner-1', { villageMaterials: true });
    const picked = await invoke('owner-1', { fileKeys: [fileKey(AGT), fileKey(PUB)] });
    assert.equal(viaMaterials.status, 401);
    assert.equal(picked.status, 401);
    assert.deepEqual(await viaMaterials.json(), await picked.json());
    assert.equal(w.up.messages.length, 0, '에이전트는 불리지 않는다');
    assert.equal(w.up.delegations.length, 0);
    // 자료가 없는 마을이면 파일 없는 대화처럼 위임 없이 간다(고른 파일이 없을 때와 같다)
    await MATERIALS_PUT(req('PUT', '/api/ain/villages/alpha/materials', 'owner-1', { fileKey: fileKey(PUB), audience: 'members' }), ctx('alpha'));
    await MATERIALS_PUT(req('PUT', '/api/ain/villages/alpha/materials', 'owner-1', { fileKey: fileKey(AGT), audience: 'members' }), ctx('alpha'));
    const none = await invoke('owner-1', { villageMaterials: true });
    assert.equal(none.status, 200);
    assert.deepEqual(w.up.messages[0].parts.map((p) => p.kind), ['text']);
  } finally { w.restore(); }
}));
