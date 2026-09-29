import { test } from 'node:test';
import assert from 'node:assert/strict';
import eventPageFixture from './__fixtures__/event-page.json';
import { applyEvents, emptyEventCache, fetchEvents, markInaccessible, reduceEventPage } from './events';
import { findSecretKey } from './http';
import { AinContractError, isEventPage, type EventPage, type ResourceEvent } from './types';
import { fakeFetch, jsonResponse } from './__tests__/helpers';

const FILE = 'https://aindrive.example#drv_1#p1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const AGENT = 'https://ainize.example#doc-summary';
const ev = (over: Partial<ResourceEvent> & { type: ResourceEvent['type']; version: number }): ResourceEvent =>
  ({ kind: over.type.startsWith('file.') ? 'file' : 'agent', eventId: `evt_${over.version}`, resourceId: over.type.startsWith('file.') ? FILE : AGENT, occurredAt: '2026-09-29T06:00:00Z', ...over } as ResourceEvent);

test('fixture: 계약 event-page 를 파싱한다', () => {
  assert.ok(isEventPage(eventPageFixture));
  assert.equal(eventPageFixture.events.length, 3);
});

test('전달: aindrive 는 계정 토큰 헤더로 /api/oauth/events, Ainize 는 익명으로 /api/shared-agents/events; 계약 그대로', async () => {
  const f = fakeFetch({
    '/api/oauth/events': (url) => jsonResponse({ ...eventPageFixture, nextCursor: `after-${url.searchParams.get('cursor') ?? 'start'}` }),
    '/api/shared-agents/events': () => jsonResponse({ contract: '1.0', events: [], nextCursor: 'ev_0', gap: false }),
  });
  const a = await fetchEvents({ source: 'aindrive', baseUrl: 'https://aindrive.example/', token: 'aind_aat_secret', fetch: f }, 'ev_2');
  assert.equal(a.events.length, 3);
  assert.equal(a.nextCursor, 'after-ev_2');
  assert.equal((f.calls[0].init?.headers as Record<string, string>).authorization, 'Bearer aind_aat_secret');
  assert.ok(f.calls[0].url.startsWith('https://aindrive.example/api/oauth/events?cursor=ev_2'));
  assert.ok(!f.calls[0].url.includes('aind_aat_'));
  assert.equal(findSecretKey(a), null);
  const b = await fetchEvents({ source: 'ainize', baseUrl: 'https://ainize.example', token: null, fetch: f }, null);
  assert.deepEqual(b, { contract: '1.0', events: [], nextCursor: 'ev_0', gap: false });
  assert.equal((f.calls[1].init?.headers as Record<string, string>).authorization, undefined);
  assert.equal(f.calls[1].url, 'https://ainize.example/api/shared-agents/events');
});

test('전달: aindrive 토큰 없음 → auth_required + actionUrl; 계약 모양이 아니면 temporary_failure; 원본 오류 바디는 그대로', async () => {
  const f = fakeFetch({ '/api/oauth/events': () => jsonResponse({ nope: true }), '/api/shared-agents/events': () => jsonResponse({ error: { code: 'rate_limited', message: 'slow down', retryable: true, retryAfterSeconds: 3 } }, 429) });
  await assert.rejects(() => fetchEvents({ source: 'aindrive', baseUrl: 'https://aindrive.example', token: null, connectUrl: 'https://aindrive.example/oauth/authorize', fetch: f }, null), (e: AinContractError) => e.code === 'auth_required' && e.actionUrl === 'https://aindrive.example/oauth/authorize');
  await assert.rejects(() => fetchEvents({ source: 'aindrive', baseUrl: 'https://aindrive.example', token: 't', fetch: f }, null), (e: AinContractError) => e.code === 'temporary_failure');
  await assert.rejects(() => fetchEvents({ source: 'ainize', baseUrl: 'https://ainize.example', fetch: f }, null), (e: AinContractError) => e.code === 'rate_limited' && e.status === 429);
});

test('reducer: 같은 resourceId 는 더 큰 version 만 적용(중복·역순 안전)', () => {
  const events = [ev({ type: 'file.renamed', version: 2 }), ev({ type: 'file.shared', version: 1 }), ev({ type: 'file.renamed', version: 2 }), ev({ type: 'agent.updated', version: 5 })];
  const r = applyEvents({ [FILE]: 1 }, events);
  assert.deepEqual(r.applied.map((e) => e.eventId), ['evt_2', 'evt_5']);
  assert.deepEqual(r.versions, { [FILE]: 2, [AGENT]: 5 });
  // 순서가 뒤바뀌어도 최종 상태는 같다
  const rev = applyEvents({ [FILE]: 1 }, [...events].reverse());
  assert.deepEqual(rev.versions, r.versions);
});

test('reducer: 철회 계열은 접근 불가로 표시(숨기지 않음), 다시 공유되면 해제, 커서 전진', () => {
  const page1: EventPage = { contract: '1.0', events: [ev({ type: 'file.shared', version: 1 }), ev({ type: 'agent.published', version: 1 })], nextCursor: 'c1', gap: false };
  const s1 = reduceEventPage(emptyEventCache(), page1);
  assert.equal(s1.relist, false);
  assert.deepEqual(s1.state.inaccessible, []);
  assert.equal(s1.state.cursor, 'c1');
  const page2: EventPage = { contract: '1.0', events: [ev({ type: 'file.revoked', version: 2 }), ev({ type: 'agent.disabled', version: 2 })], nextCursor: 'c2', gap: false };
  const s2 = reduceEventPage(s1.state, page2);
  assert.deepEqual(s2.state.inaccessible.sort(), [FILE, AGENT].sort());
  const items = markInaccessible([{ key: FILE, name: 'a' }, { key: 'other', name: 'b' }], s2.state, (i) => i.key);
  assert.equal(items.length, 2, '숨기지 않는다');
  assert.deepEqual(items.map((i) => i.inaccessible), [true, false]);
  // 오래된(낮은 version) 재공유는 무시되고, 새 재공유는 해제한다
  const stale = reduceEventPage(s2.state, { contract: '1.0', events: [ev({ type: 'file.shared', version: 1 })], nextCursor: 'c3', gap: false });
  assert.ok(stale.state.inaccessible.includes(FILE));
  assert.equal(stale.applied.length, 0);
  const fresh = reduceEventPage(s2.state, { contract: '1.0', events: [ev({ type: 'file.shared', version: 3 })], nextCursor: 'c3', gap: false });
  assert.ok(!fresh.state.inaccessible.includes(FILE));
  assert.ok(fresh.state.inaccessible.includes(AGENT));
});

test('reducer: gap → 상태를 비우고 전체 재목록 신호', () => {
  const s = reduceEventPage({ versions: { [FILE]: 4 }, inaccessible: [FILE], cursor: 'old' }, { contract: '1.0', events: [], nextCursor: 'new', gap: true });
  assert.equal(s.relist, true);
  assert.deepEqual(s.state, { versions: {}, inaccessible: [], cursor: 'new' });
});
