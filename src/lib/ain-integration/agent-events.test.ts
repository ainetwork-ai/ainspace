import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StoredAgent } from '@/lib/redis';
import { applyAgentEvents, latestStatusByAgent, type AgentStore } from './agent-events';
import type { ResourceEvent } from './types';

const AINIZE = 'https://ainize.example';

/** 가짜 Redis: StoredAgent 를 url 로 든 맵 + 저장 호출 기록. */
function fakeStore(agents: StoredAgent[]): AgentStore & { saved: StoredAgent[]; byUrl: Map<string, StoredAgent> } {
  const byUrl = new Map(agents.map((a) => [a.url, a]));
  const saved: StoredAgent[] = [];
  return {
    byUrl, saved,
    getAgents: async () => [...byUrl.values()].map((a) => ({ ...a })),
    saveAgent: async (a) => { byUrl.set(a.url, a); saved.push(a); },
  };
}

const stored = (over: Partial<StoredAgent>): StoredAgent => ({
  url: 'https://node.example/agents/guide', card: { name: 'guide' } as StoredAgent['card'],
  state: { x: 12, y: 7, behavior: 'random', color: '#fff', moveInterval: 700 } as StoredAgent['state'],
  isPlaced: true, creator: '0xwallet', timestamp: 1, backendStatus: 'active', commonAgentId: `${AINIZE}#gallery-guide`, ...over,
});

const ev = (type: ResourceEvent['type'], version: number, resourceId = `${AINIZE}#gallery-guide`, kind: 'agent' | 'file' = 'agent'): ResourceEvent =>
  ({ kind, type, eventId: `evt_${type}_${version}`, resourceId, version, occurredAt: '2026-09-29T06:00:00Z' } as ResourceEvent);

test('agent.disabled/deleted/unpublished/revoked → inactive, 배치(isPlaced·state)는 그대로', async () => {
  for (const type of ['agent.disabled', 'agent.deleted', 'agent.unpublished', 'agent.revoked'] as const) {
    const store = fakeStore([stored({})]);
    const r = await applyAgentEvents([ev(type, 5)], store);
    assert.equal(r.matched, 1, type);
    assert.equal(r.changed.length, 1, type);
    assert.deepEqual(r.changed[0], { url: 'https://node.example/agents/guide', commonAgentId: `${AINIZE}#gallery-guide`, backendStatus: 'inactive', version: 5 });
    const a = store.byUrl.get('https://node.example/agents/guide')!;
    assert.equal(a.backendStatus, 'inactive');
    assert.equal(a.ainStatusVersion, 5);
    assert.equal(a.isPlaced, true);
    assert.deepEqual(a.state, { x: 12, y: 7, behavior: 'random', color: '#fff', moveInterval: 700 });
    assert.equal(a.commonAgentId, `${AINIZE}#gallery-guide`);
  }
});

test('agent.published/updated → 다시 active; 더 작은 version 의 이벤트는 되돌리지 못한다(중복·역순 안전)', async () => {
  const store = fakeStore([stored({})]);
  await applyAgentEvents([ev('agent.disabled', 5)], store);
  assert.equal(store.byUrl.get('https://node.example/agents/guide')!.backendStatus, 'inactive');
  // 오래된 published(version 4) 는 무시
  let r = await applyAgentEvents([ev('agent.published', 4)], store);
  assert.equal(r.changed.length, 0);
  assert.equal(store.byUrl.get('https://node.example/agents/guide')!.backendStatus, 'inactive');
  // 같은 version 의 재전송도 무시
  r = await applyAgentEvents([ev('agent.disabled', 5)], store);
  assert.equal(r.changed.length, 0);
  // 새 published(version 6) → active
  r = await applyAgentEvents([ev('agent.published', 6)], store);
  assert.equal(r.changed.length, 1);
  assert.equal(r.changed[0].backendStatus, 'active');
  const a = store.byUrl.get('https://node.example/agents/guide')!;
  assert.equal(a.backendStatus, 'active');
  assert.equal(a.ainStatusVersion, 6);
  assert.equal(a.isPlaced, true);
  // agent.updated 도 활성으로
  await applyAgentEvents([ev('agent.revoked', 7)], store);
  r = await applyAgentEvents([ev('agent.updated', 8)], store);
  assert.equal(r.changed[0]?.backendStatus, 'active');
});

test('한 페이지 안에서는 리소스별로 가장 큰 version 만 적용한다(역순으로 와도)', async () => {
  const store = fakeStore([stored({})]);
  const r = await applyAgentEvents([ev('agent.published', 9), ev('agent.disabled', 3), ev('agent.updated', 1)], store);
  assert.equal(r.changed.length, 0, '활성 에이전트에 온 활성 이벤트는 쓰기 없음');
  const { byKey, ignored } = latestStatusByAgent([ev('agent.disabled', 3), ev('agent.published', 9), ev('agent.moved', 11), ev('file.deleted', 2, 'https://aindrive.example#d#p1:x', 'file')]);
  assert.deepEqual(byKey.get(`${AINIZE}#gallery-guide`), { status: 'active', version: 9 });
  assert.equal(ignored, 2);
  const store2 = fakeStore([stored({})]);
  const r2 = await applyAgentEvents([ev('agent.published', 2), ev('agent.disabled', 3)], store2);
  assert.equal(r2.changed[0].backendStatus, 'inactive');
});

test('commonAgentId 가 다르거나 없는 에이전트, agent.moved·file.* 이벤트는 건드리지 않는다; issuer 끝 슬래시는 같은 키다', async () => {
  const store = fakeStore([
    stored({}),
    stored({ url: 'https://node.example/agents/other', commonAgentId: `${AINIZE}#other-agent` }),
    stored({ url: 'https://node.example/agents/legacy', commonAgentId: undefined }),
    stored({ url: 'https://node.example/agents/slash', commonAgentId: `${AINIZE}/#gallery-guide` }),
  ]);
  const r = await applyAgentEvents([ev('agent.moved', 5), ev('file.deleted', 2, 'https://aindrive.example#d#p1:x', 'file'), ev('agent.disabled', 6, `${AINIZE}/#gallery-guide`)], store);
  assert.equal(r.ignored, 2);
  assert.equal(r.matched, 2);
  assert.deepEqual(r.changed.map((c) => c.url).sort(), ['https://node.example/agents/guide', 'https://node.example/agents/slash']);
  assert.equal(store.byUrl.get('https://node.example/agents/other')!.backendStatus, 'active');
  assert.equal(store.byUrl.get('https://node.example/agents/legacy')!.backendStatus, 'active');
  assert.equal(store.saved.length, 2);
});

test('roster sync 가 inactive 로 둔 에이전트도 agent.published 로 다시 active 가 된다; 이벤트가 없으면 저장소를 읽지 않는다', async () => {
  const store = fakeStore([stored({ backendStatus: 'inactive' })]);
  const r = await applyAgentEvents([ev('agent.published', 1)], store);
  assert.equal(r.changed.length, 1);
  assert.equal(store.byUrl.get('https://node.example/agents/guide')!.backendStatus, 'active');
  let read = false;
  const empty: AgentStore = { getAgents: async () => { read = true; return []; }, saveAgent: async () => {} };
  const r2 = await applyAgentEvents([ev('agent.moved', 1)], empty);
  assert.equal(read, false);
  assert.deepEqual(r2, { changed: [], matched: 0, ignored: 1 });
});
