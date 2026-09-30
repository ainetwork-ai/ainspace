/**
 * 17.3 소유권 변경 — 배치는 유지하고 마을 소유자 재확인 대기로 표시한다.
 * 단위(observeAgentOwners·confirmOwnerChange·isPlacedIn) + 라우트(events/apply → 레지스트리 재조회, invoke 의 resolve 관찰,
 * `/api/ain/villages/:slug/agents` 재확인, 대기 중에는 마을 자료 invoke 403).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { applyRosterItem, type StoredAgent } from '@/lib/redis';
import type { AgentStore } from './agent-events';
import { confirmOwnerChange, listVillageSharedAgents, observeAgentOwners, ownerCheckKeys, ownerKeyOf, registryOwnerKey, resolveAgentOwners, verifyVillageAgentOwner } from './agent-ownership';
import { eventsDeps, invokeDeps, villageAgentsDeps, villageDeps, villageMaterialsDeps } from './deps';
import { resetNativeSupport } from './http';
import { invokeSharedAgent } from './invoke';
import { memoryKv } from './kv';
import { AIN_CONTRACT_VERSION, type AgentRef, type OwnerRef, type ResourceEvent } from './types';
import { isPlacedIn, memoryVillageDirectory } from './village-membership';
import { SESSION_ENV, fakeFetch, jsonResponse, signedJwt, withEnv } from './__tests__/helpers';
import { POST as APPLY } from '@/app/api/ain/events/apply/route';
import { GET as AGENTS_GET, POST as AGENTS_POST } from '@/app/api/ain/villages/[slug]/agents/route';
import { POST as INVOKE } from '@/app/api/ain/invoke/route';

const AINIZE = 'https://ainize.example';
const KEY = `${AINIZE}#gallery-guide`;
const ALICE: OwnerRef = { kind: 'wallet', issuer: AINIZE, subject: '0xalice', displayName: 'Alice' };
const BOB: OwnerRef = { kind: 'wallet', issuer: AINIZE, subject: '0xbob' };

function fakeStore(agents: StoredAgent[]): AgentStore & { byUrl: Map<string, StoredAgent>; saves: number } {
  const byUrl = new Map(agents.map((a) => [a.url, a]));
  const s = {
    byUrl, saves: 0,
    getAgents: async () => [...byUrl.values()].map((a) => structuredClone(a)),
    saveAgent: async (a: StoredAgent) => { byUrl.set(a.url, a); s.saves++; },
  };
  return s;
}
const stored = (over: Partial<StoredAgent> = {}): StoredAgent => ({
  url: 'https://node.example/agents/guide', card: { name: '갤러리 안내' } as StoredAgent['card'],
  state: { x: 3, y: 4, behavior: 'random', color: '#fff', mapName: 'alpha' } as StoredAgent['state'],
  isPlaced: true, creator: '0xwallet', timestamp: 1, backendStatus: 'active', commonAgentId: KEY, ...over,
});
const agentRef = (owner: OwnerRef): AgentRef => ({
  contract: AIN_CONTRACT_VERSION, registryIssuer: AINIZE, agentId: 'gallery-guide', releaseId: 'v2', ownerRef: owner, visibility: 'public',
  agentCardUrl: `${AINIZE}/agents/gallery-guide/.well-known/agent-card.json`, endpoint: `${AINIZE}/agents/gallery-guide`,
  supportedProtocolVersions: ['0.3.0'], skills: [], inputModes: ['text/plain'], outputModes: ['text/plain'], uiCapabilities: [],
  status: 'active', displayName: '갤러리 안내', updatedAt: '2026-09-30T00:00:00Z',
});
const ev = (type: ResourceEvent['type'], version: number, resourceId = KEY): ResourceEvent =>
  ({ kind: 'agent', type, eventId: `e_${type}_${version}`, resourceId, version, occurredAt: '2026-09-30T00:00:00Z' } as ResourceEvent);

test('17.3 단위: 기준 없는 첫 관찰 — 배치 안 된 것은 기준만, 배치된 것은 재확인 대기(from:null) → 확인하면 기준', async () => {
  const unplaced = stored({ url: 'https://node.example/unplaced', isPlaced: false });
  const store = fakeStore([stored(), unplaced]);
  const r = await observeAgentOwners(new Map([[KEY, BOB]]), store, () => new Date('2026-09-30T02:00:00Z'));
  assert.deepEqual([r.baselined, r.flagged.length], [1, 1]);
  assert.equal(store.byUrl.get(unplaced.url)!.ainOwnerKey, ownerKeyOf(BOB));
  const placed = store.byUrl.get(stored().url)!;
  assert.equal(placed.ainOwnerKey, undefined, '배치된 것은 조용히 기준으로 삼지 않는다');
  assert.deepEqual(placed.ainOwnerChange, { from: null, to: ownerKeyOf(BOB), detectedAt: '2026-09-30T02:00:00.000Z' });
  assert.equal(placed.isPlaced, true);
  assert.equal(isPlacedIn(placed, 'alpha', KEY), false);
  // 같은 관찰을 다시 해도 쓰지 않는다
  const saves = store.saves;
  await observeAgentOwners(new Map([[KEY, BOB]]), store);
  assert.equal(store.saves, saves);
  assert.equal(await confirmOwnerChange('alpha', KEY, store), 1);
  assert.equal(store.byUrl.get(stored().url)!.ainOwnerKey, ownerKeyOf(BOB));
  assert.equal(isPlacedIn(store.byUrl.get(stored().url)!, 'alpha', KEY), true);
});

test('17.3 단위: 기준이 있으면 다른 소유자 → 재확인 대기(배치 유지), 같은 변경 재관찰은 쓰지 않음, 원래대로 → 표시 해제', async () => {
  const store = fakeStore([stored({ ainOwnerKey: ownerKeyOf(ALICE) })]);
  let r = await observeAgentOwners(new Map([[KEY, ALICE]]), store);
  assert.deepEqual([r.baselined, r.flagged.length], [0, 0]);
  assert.equal(store.byUrl.get(stored().url)!.ainOwnerKey, ownerKeyOf(ALICE));
  // 표시 이름만 바뀐 것은 소유자 변경이 아니다
  r = await observeAgentOwners(new Map([[KEY, { ...ALICE, displayName: 'Alice K' }]]), store);
  assert.equal(r.flagged.length, 0);

  r = await observeAgentOwners(new Map([[`${AINIZE}/#gallery-guide`, BOB]]), store, () => new Date('2026-09-30T01:00:00Z'));
  assert.equal(r.flagged.length, 1);
  const a = store.byUrl.get(stored().url)!;
  assert.deepEqual(a.ainOwnerChange, { from: ownerKeyOf(ALICE), to: ownerKeyOf(BOB), detectedAt: '2026-09-30T01:00:00.000Z' });
  assert.equal(a.isPlaced, true);
  assert.deepEqual(a.state, stored().state);
  assert.equal(a.ainOwnerKey, ownerKeyOf(ALICE), '재확인 전에는 기준 소유자가 바뀌지 않는다');
  assert.equal(isPlacedIn(a, 'alpha', KEY), false, '대기 중에는 마을 자료를 받는 배치로 치지 않는다');

  const saves = store.saves;
  await observeAgentOwners(new Map([[KEY, BOB]]), store);
  assert.equal(store.saves, saves);

  r = await observeAgentOwners(new Map([[KEY, ALICE]]), store);
  assert.equal(r.cleared, 1);
  assert.equal(store.byUrl.get(stored().url)!.ainOwnerChange, undefined);
  assert.equal(isPlacedIn(store.byUrl.get(stored().url)!, 'alpha', KEY), true);
});

test('17.3 단위: 재확인은 그 마을의 배치만 — 새 소유자를 기준으로 삼는다', async () => {
  const change = { from: ownerKeyOf(ALICE), to: ownerKeyOf(BOB), detectedAt: 'x' };
  const store = fakeStore([
    stored({ ainOwnerKey: ownerKeyOf(ALICE), ainOwnerChange: change }),
    stored({ url: 'https://node.example/b', state: { ...stored().state, mapName: 'beta' }, ainOwnerKey: ownerKeyOf(ALICE), ainOwnerChange: change }),
  ]);
  assert.deepEqual((await listVillageSharedAgents('alpha', store)).map((v) => [v.commonAgentId, v.ownerChange?.to]), [[KEY, ownerKeyOf(BOB)]]);
  assert.equal(await confirmOwnerChange('alpha', KEY, store), 1);
  assert.equal(store.byUrl.get(stored().url)!.ainOwnerKey, ownerKeyOf(BOB));
  assert.equal(store.byUrl.get(stored().url)!.ainOwnerChange, undefined);
  assert.ok(store.byUrl.get('https://node.example/b')!.ainOwnerChange, 'beta 는 그대로 대기');
  assert.equal(await confirmOwnerChange('alpha', KEY, store), 0);
});

test('17.3 단위: 소유권 확인 대상 이벤트는 agent.updated·agent.moved 뿐; 레지스트리는 한 번 훑어 여러 키를 찾는다', async () => {
  assert.deepEqual(ownerCheckKeys([ev('agent.updated', 1), ev('agent.moved', 2, `${AINIZE}/#other`), ev('agent.disabled', 3, `${AINIZE}#x`)]), [KEY, `${AINIZE}#other`]);
  const f = fakeFetch({ '/api/shared-agents': () => jsonResponse({ contract: '1.0', asOf: 'x', nextCursor: null, items: [{ ref: agentRef(BOB), canInvoke: true }] }) });
  const m = await resolveAgentOwners({ ainizeUrl: AINIZE, fetch: f }, [KEY, `${AINIZE}#gone`]);
  assert.deepEqual([...m.entries()], [[KEY, BOB]]);
  assert.equal(f.calls.length, 1);
});

const ENV = { ...SESSION_ENV, AIN_INTEGRATION_ENABLED: 'true', NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined, AINIZE_URL: AINIZE, AINDRIVE_URL: 'https://aindrive.example', AIN_TEAMS_DELEGATION_URL: undefined };
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const req = (method: string, path: string, user: string | null, body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${signedJwt(user)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
});

test('17.3 라우트: agent.updated → 레지스트리에서 새 소유자 → 재확인 대기(배치 유지) → 대기 중 마을 자료 invoke 403 → 마을 소유자만 재확인 → 다시 200', withEnv(ENV, async () => {
  const store = fakeStore([stored({ ainOwnerKey: ownerKeyOf(ALICE) })]);
  const dir = memoryVillageDirectory({ villages: ['alpha'] });
  await dir.setOwner('alpha', 'owner-1');
  // 멤버십 디렉터리의 배치 판정도 같은 저장소를 본다
  dir.isAgentPlacedIn = async (slug, key) => (await store.getAgents()).some((a) => isPlacedIn(a, slug, key));
  let registryOwner = BOB;
  const f = fakeFetch({
    '/api/shared-agents': () => jsonResponse({ contract: '1.0', asOf: 'x', nextCursor: null, items: [{ ref: agentRef(registryOwner), canInvoke: true }] }),
    '/api/events': () => jsonResponse({ contract: '1.0', events: [ev('agent.updated', 7)], nextCursor: 'c1', gap: false }),
    '/agents/gallery-guide': (_u, init) => { const b = JSON.parse(String(init?.body)); return jsonResponse({ jsonrpc: '2.0', id: b.id, result: { id: 't', contextId: b.params.message.contextId, status: { state: 'completed' }, artifacts: [{ parts: [{ kind: 'text', text: 'ok' }] }] } }); },
  });
  const prev = { ev: { ...eventsDeps }, inv: { ...invokeDeps }, va: { ...villageAgentsDeps }, vil: { ...villageDeps }, mat: { ...villageMaterialsDeps } };
  villageAgentsDeps.store = store;
  villageDeps.directory = dir;
  villageMaterialsDeps.store = { kv: memoryKv(), isMember: (s, u) => dir.isMember(s, u) };
  eventsDeps.fetchEvents = async () => ({ contract: '1.0', events: [ev('agent.updated', 7)], nextCursor: 'c1', gap: false });
  eventsDeps.applyAgentEvents = async () => ({ changed: [], matched: 1, ignored: 0 });
  eventsDeps.resolveAgentOwners = (o, keys) => resolveAgentOwners({ ...o, fetch: f }, keys);
  invokeDeps.invokeSharedAgent = (o, r) => invokeSharedAgent({ ...o, fetch: f }, r);
  invokeDeps.getAindriveAccountToken = async () => null;
  invokeDeps.saveTaskRef = async () => {};
  invokeDeps.verifyVillageAgentOwner = (slug, r) => verifyVillageAgentOwner(slug, r, store);
  resetNativeSupport();
  try {
    const res = await APPLY(req('POST', '/api/ain/events/apply', 'owner-1', {}));
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.ownerChanges.length, 1);
    assert.equal(body.ownerChanges[0].change.to, ownerKeyOf(BOB));
    const a = store.byUrl.get(stored().url)!;
    assert.equal(a.isPlaced, true);
    assert.equal(a.state.mapName, 'alpha');

    // 대기 중: 마을 자료를 붙인 invoke 는 403(배치된 에이전트로 치지 않는다); 일반 대화는 된다
    const inv = (b: Record<string, unknown>) => INVOKE(req('POST', '/api/ain/invoke', 'owner-1', { agentKey: KEY, text: '안내', conversation: 'c', room: 'alpha', fileKeys: [], ...b }));
    const blocked = await inv({ villageMaterials: true });
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).error.detail, 'agent_not_placed_in_village');
    assert.equal((await inv({})).status, 200);

    // 관리 보기·재확인: 마을 소유자만
    assert.equal((await AGENTS_GET(req('GET', '/api/ain/villages/alpha/agents', 'visitor'), ctx('alpha'))).status, 403);
    assert.equal((await AGENTS_GET(req('GET', '/api/ain/villages/alpha/agents', null), ctx('alpha'))).status, 401);
    const list = await (await AGENTS_GET(req('GET', '/api/ain/villages/alpha/agents', 'owner-1'), ctx('alpha'))).json();
    assert.equal(list.items[0].ownerChange.to, ownerKeyOf(BOB));
    assert.equal((await AGENTS_POST(req('POST', '/api/ain/villages/alpha/agents', 'visitor', { agentKey: KEY, decision: 'confirm' }), ctx('alpha'))).status, 403);
    assert.equal((await AGENTS_POST(req('POST', '/api/ain/villages/alpha/agents', 'owner-1', { agentKey: KEY, decision: 'nope' }), ctx('alpha'))).status, 400);
    const ok = await AGENTS_POST(req('POST', '/api/ain/villages/alpha/agents', 'owner-1', { agentKey: KEY, decision: 'confirm' }), ctx('alpha'));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { confirmed: 1 });
    assert.equal((await AGENTS_POST(req('POST', '/api/ain/villages/alpha/agents', 'owner-1', { agentKey: KEY, decision: 'confirm' }), ctx('alpha'))).status, 404);
    assert.equal(store.byUrl.get(stored().url)!.ainOwnerKey, ownerKeyOf(BOB));
    assert.equal((await inv({ villageMaterials: true })).status, 200);

    // invoke 의 resolve 도 관찰한다: 레지스트리가 다시 Alice 로 바뀌면 → 대기(기다리지 않는 관찰이므로 잠깐 뒤 확인)
    registryOwner = ALICE;
    assert.equal((await inv({})).status, 200);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(store.byUrl.get(stored().url)!.ainOwnerChange?.to, ownerKeyOf(ALICE));

    // 플래그 off → 404
    await withEnv({ AIN_INTEGRATION_ENABLED: undefined }, async () => {
      assert.equal((await AGENTS_GET(req('GET', '/api/ain/villages/alpha/agents', 'owner-1'), ctx('alpha'))).status, 404);
    })();
  } finally {
    Object.assign(eventsDeps, prev.ev); Object.assign(invokeDeps, prev.inv); Object.assign(villageAgentsDeps, prev.va);
    Object.assign(villageDeps, prev.vil); Object.assign(villageMaterialsDeps, prev.mat); resetNativeSupport();
  }
}));

/** 17.3 라우트 공통: 저장소·디렉터리·레지스트리·에이전트 원본을 끼운다. 마을 자료 하나(agent)를 붙여 둔다. */
async function wireOwnership(store: ReturnType<typeof fakeStore>, registry: { owner: OwnerRef }) {
  const dir = memoryVillageDirectory({ villages: ['alpha'] });
  await dir.setOwner('alpha', 'owner-1');
  dir.isAgentPlacedIn = async (slug, key) => (await store.getAgents()).some((a) => isPlacedIn(a, slug, key));
  const agentMessages: unknown[] = [];
  const f = fakeFetch({
    '/api/shared-agents': () => jsonResponse({ contract: '1.0', asOf: 'x', nextCursor: null, items: [{ ref: agentRef(registry.owner), canInvoke: true }] }),
    '/agents/gallery-guide': (_u, init) => { const b = JSON.parse(String(init?.body)); agentMessages.push(b.params.message); return jsonResponse({ jsonrpc: '2.0', id: b.id, result: { id: 't', contextId: b.params.message.contextId, status: { state: 'completed' }, artifacts: [{ parts: [{ kind: 'text', text: 'ok' }] }] } }); },
  });
  const prev = { ev: { ...eventsDeps }, inv: { ...invokeDeps }, va: { ...villageAgentsDeps }, vil: { ...villageDeps }, mat: { ...villageMaterialsDeps } };
  villageAgentsDeps.store = store;
  villageDeps.directory = dir;
  villageMaterialsDeps.store = { kv: memoryKv(), isMember: (sl, u) => dir.isMember(sl, u) };
  eventsDeps.resolveAgentOwners = (o, keys) => resolveAgentOwners({ ...o, fetch: f }, keys);
  invokeDeps.invokeSharedAgent = (o, r) => invokeSharedAgent({ ...o, fetch: f }, r);
  invokeDeps.getAindriveAccountToken = async () => null;
  invokeDeps.saveTaskRef = async () => {};
  invokeDeps.listVillageMaterials = async () => [];
  resetNativeSupport();
  return {
    f, agentMessages,
    restore: () => {
      Object.assign(eventsDeps, prev.ev); Object.assign(invokeDeps, prev.inv); Object.assign(villageAgentsDeps, prev.va);
      Object.assign(villageDeps, prev.vil); Object.assign(villageMaterialsDeps, prev.mat); resetNativeSupport();
    },
  };
}

test('17.3 라우트: events/apply 전에 온 첫 마을 자료 invoke 도 — 소유자가 바뀌었으면 위임·호출 전에 403 agent_owner_changed(그 자리에서 대기 표시)', withEnv(ENV, async () => {
  const store = fakeStore([stored({ ainOwnerKey: ownerKeyOf(ALICE) })]);
  const w = await wireOwnership(store, { owner: BOB });
  try {
    const inv = (b: Record<string, unknown>) => INVOKE(req('POST', '/api/ain/invoke', 'owner-1', { agentKey: KEY, text: '안내', conversation: 'c', room: 'alpha', fileKeys: [], ...b }));
    const res = await inv({ villageMaterials: true });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.detail, 'agent_owner_changed');
    assert.equal(w.agentMessages.length, 0, '새 소유자의 에이전트를 부르지 않는다');
    assert.equal(store.byUrl.get(stored().url)!.ainOwnerChange?.to, ownerKeyOf(BOB), '관찰은 기다려서 기록됐다');
    // 두 번째부터는 배치 판정 단계에서 막힌다
    assert.equal((await (await inv({ villageMaterials: true })).json()).error.detail, 'agent_not_placed_in_village');
    // 자료 없는 대화는 된다
    assert.equal((await inv({})).status, 200);
    // 소유자가 같으면 마을 자료 invoke 가 된다
    const same = fakeStore([stored({ ainOwnerKey: ownerKeyOf(BOB) })]);
    villageAgentsDeps.store = same;
    villageDeps.directory.isAgentPlacedIn = async (slug, key) => (await same.getAgents()).some((a) => isPlacedIn(a, slug, key));
    assert.equal((await inv({ villageMaterials: true })).status, 200);
  } finally { w.restore(); }
}));

test('17.3 라우트: 배치 후 한 번도 불리지 않고(기준 없음) 양도된 에이전트 — agent.moved 가 재확인 대기로 표시한다', withEnv(ENV, async () => {
  const store = fakeStore([stored()]);
  const w = await wireOwnership(store, { owner: BOB });
  eventsDeps.fetchEvents = async () => ({ contract: '1.0', events: [ev('agent.moved', 9)], nextCursor: 'c9', gap: false });
  eventsDeps.applyAgentEvents = async () => ({ changed: [], matched: 1, ignored: 0 });
  try {
    const res = await APPLY(req('POST', '/api/ain/events/apply', 'owner-1', {}));
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.ownerChanges.length, 1);
    assert.deepEqual([body.ownerChanges[0].change.from, body.ownerChanges[0].change.to], [null, ownerKeyOf(BOB)]);
    assert.equal(store.byUrl.get(stored().url)!.ainOwnerKey, undefined);
    assert.equal(store.byUrl.get(stored().url)!.isPlaced, true);
  } finally { w.restore(); }
}));

test('17.3 가져오기: 레지스트리 소유자를 기준으로 기록한다(새 에이전트 · 다른 공유 에이전트로 바뀜 · 배치 안 된 기준 없는 것); 배치된 기준 없는 것은 건드리지 않는다', async () => {
  const f = fakeFetch({ '/api/shared-agents': () => jsonResponse({ contract: '1.0', asOf: 'x', nextCursor: null, items: [{ ref: agentRef(ALICE), canInvoke: true }] }) });
  assert.equal(await registryOwnerKey({ ainizeUrl: AINIZE, fetch: f }, KEY), ownerKeyOf(ALICE));
  assert.equal(await registryOwnerKey({ ainizeUrl: AINIZE, fetch: f }, `${AINIZE}#gone`), null);
  const down = fakeFetch({ '/api/shared-agents': () => { throw new Error('ECONNREFUSED'); } });
  const orig = console.error; console.error = () => {};
  try { assert.equal(await registryOwnerKey({ ainizeUrl: AINIZE, fetch: down }, KEY), null); } finally { console.error = orig; }

  const item = { id: 'uuid-1', a2aUrl: 'https://node.example/agents/guide', status: 'active', displayName: '갤러리 안내' } as unknown as Parameters<typeof applyRosterItem>[1];
  const created = applyRosterItem('0xwallet', item, undefined, { commonAgentId: KEY, ainOwnerKey: ownerKeyOf(ALICE) })!;
  assert.equal(created.agent.ainOwnerKey, ownerKeyOf(ALICE));

  const unplaced = applyRosterItem('0xwallet', item, stored({ isPlaced: false, backendUuid: 'uuid-1' }), { commonAgentId: KEY, ainOwnerKey: ownerKeyOf(ALICE) })!;
  assert.deepEqual([unplaced.changed, unplaced.agent.ainOwnerKey], [true, ownerKeyOf(ALICE)]);

  const placedNoBaseline = applyRosterItem('0xwallet', item, stored({ backendUuid: 'uuid-1' }), { commonAgentId: KEY, ainOwnerKey: ownerKeyOf(BOB) })!;
  assert.deepEqual([placedNoBaseline.changed, placedNoBaseline.agent.ainOwnerKey], [false, undefined]);

  const pending = { from: ownerKeyOf(ALICE), to: ownerKeyOf(BOB), detectedAt: 'x' };
  const switched = applyRosterItem('0xwallet', item, stored({ backendUuid: 'uuid-1', commonAgentId: `${AINIZE}#other`, ainOwnerKey: ownerKeyOf(BOB), ainOwnerChange: pending }), { commonAgentId: KEY, ainOwnerKey: ownerKeyOf(ALICE) })!;
  assert.deepEqual([switched.agent.commonAgentId, switched.agent.ainOwnerKey, switched.agent.ainOwnerChange], [KEY, ownerKeyOf(ALICE), undefined]);
});
