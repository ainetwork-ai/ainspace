import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import agentListFixture from './__fixtures__/agent-list-response.json';
import { hostedAgentToRef, infoAgentToRef, listSharedAgents } from './agents';
import { findSecretKey, resetNativeSupport } from './http';
import { agentKey, isAgentListResponse } from './types';
import { fakeFetch, jsonResponse } from './__tests__/helpers';

const ISSUER = 'https://ainize.example';
const NOW = new Date('2026-09-29T06:00:00Z');
const opts = (fetch: ReturnType<typeof fakeFetch>, sessionToken: string | null = null) => ({ ainizeUrl: ISSUER, sessionToken, fetch, now: () => NOW });

beforeEach(() => resetNativeSupport());

test('fixture: 계약 agent-list-response 를 파싱해 그대로 전달한다', async () => {
  assert.ok(isAgentListResponse(agentListFixture));
  const f = fakeFetch({ '/api/shared-agents': () => jsonResponse(agentListFixture) });
  const res = await listSharedAgents(opts(f), { scope: 'shared_with_me', limit: 50 });
  assert.deepEqual(res, agentListFixture);
  assert.equal(agentKey(res.items[0].ref), 'https://ainize.ai#gallery-guide');
  assert.equal(findSecretKey(res), null);
  // 세션이 없으면 Authorization 헤더도 없다.
  assert.equal((f.calls[0].init?.headers as Record<string, string>).authorization, undefined);
});

test('세션 토큰은 헤더로만 나간다', async () => {
  const f = fakeFetch({ '/api/shared-agents': () => jsonResponse(agentListFixture) });
  await listSharedAgents(opts(f, 'sess_secret'), { scope: 'mine', limit: 10 });
  assert.equal((f.calls[0].init?.headers as Record<string, string>).authorization, 'Bearer sess_secret');
  assert.ok(!f.calls[0].url.includes('sess_secret'));
});

const info = { node: { address: '0xABCDEF', agents: [
  { id: 'proxied-1', name: 'Proxied', description: 'via node', url: 'https://up.example/a2a', reachable: true, protocols: ['0.3.0'], extensions: ['https://a2ui.org/a2a-extension/a2ui/v0.9'] },
  { id: 'hosted-1', name: 'Hosted (from info)', url: `${ISSUER}/agents/hosted-1`, reachable: true },
  { id: 'down', name: 'Down', url: 'https://down.example', reachable: false },
] } };
const hosted = { agents: [
  { id: 'hosted-1', name: 'Hosted', description: 'built here', owner: '0xOWNER', version: 3, status: 'ready', a2a_url: `${ISSUER}/agents/hosted-1`, card_url: `${ISSUER}/agents/hosted-1/.well-known/agent-card.json`, updated_at: 1790000000000, a2ui: true },
  { id: 'building', name: 'Building', owner: '0xOWNER', version: 1, status: 'building', a2a_url: `${ISSUER}/agents/building` },
] };

test('fallback: /api/shared-agents 404 → /api/info + /api/hosted-agents 를 AgentRef 로 변환한다', async () => {
  const f = fakeFetch({ '/api/info': () => jsonResponse(info), '/api/hosted-agents': () => jsonResponse(hosted) });
  const res = await listSharedAgents(opts(f), { scope: 'public', limit: 50 });
  assert.ok(isAgentListResponse(res));
  const byId = Object.fromEntries(res.items.map((i) => [i.ref.agentId, i]));
  // hosted 가 같은 id 의 info 항목보다 우선한다.
  assert.equal(Object.keys(byId).length, 4);
  assert.equal(byId['hosted-1'].ref.displayName, 'Hosted');
  assert.equal(byId['hosted-1'].ref.releaseId, 'v3');
  assert.equal(byId['hosted-1'].ref.status, 'active');
  assert.equal(byId['hosted-1'].canInvoke, true);
  assert.deepEqual(byId['hosted-1'].ref.uiCapabilities, ['streaming', 'cancel', 'a2ui_basic']);
  assert.equal(byId['hosted-1'].ref.ownerRef.subject, '0xowner');
  assert.equal(byId['hosted-1'].ref.updatedAt, new Date(1790000000000).toISOString());
  assert.equal(byId['hosted-1'].ref.registryIssuer, ISSUER);
  // proxied: releaseId upstream, a2ui 확장 → a2ui_basic, 카드 URL 은 endpoint 에서 파생
  assert.equal(byId['proxied-1'].ref.releaseId, 'upstream');
  assert.deepEqual(byId['proxied-1'].ref.uiCapabilities, ['streaming', 'a2ui_basic']);
  assert.equal(byId['proxied-1'].ref.agentCardUrl, 'https://up.example/a2a/.well-known/agent-card.json');
  assert.equal(byId['proxied-1'].ref.ownerRef.subject, '0xabcdef');
  assert.ok(byId['proxied-1'].ref.outputModes.includes('application/a2ui+json'));
  // 상태 매핑
  assert.equal(byId['down'].ref.status, 'stopped');
  assert.equal(byId['down'].canInvoke, false);
  assert.equal(byId['building'].ref.status, 'disabled');
  assert.equal(byId['building'].canInvoke, false);
  assert.equal(findSecretKey(res), null);
});

test('fallback: mine 은 hosted 만(?mine=1), shared_with_org 는 빈 목록, q 는 이름·설명 매칭', async () => {
  const f = fakeFetch({ '/api/info': () => jsonResponse(info), '/api/hosted-agents': () => jsonResponse(hosted) });
  const mine = await listSharedAgents(opts(f), { scope: 'mine', limit: 50 });
  assert.deepEqual(mine.items.map((i) => i.ref.agentId).sort(), ['building', 'hosted-1']);
  assert.ok(f.calls.some((c) => c.url.endsWith('/api/hosted-agents?mine=1')));
  const org = await listSharedAgents(opts(f), { scope: 'shared_with_org', limit: 50 });
  assert.deepEqual(org.items, []);
  const q = await listSharedAgents(opts(f), { scope: 'public', limit: 50, q: 'via node' });
  assert.deepEqual(q.items.map((i) => i.ref.agentId), ['proxied-1']);
  const p1 = await listSharedAgents(opts(f), { scope: 'public', limit: 3 });
  assert.equal(p1.items.length, 3);
  const p2 = await listSharedAgents(opts(f), { scope: 'public', limit: 3, cursor: p1.nextCursor! });
  assert.equal(p2.items.length, 1);
  assert.equal(p2.nextCursor, null);
});

test('변환 단위: version 없는 hosted 는 upstream, endpoint 없는 info 행은 버린다', () => {
  const r = hostedAgentToRef(ISSUER, '0xNODE', { id: 'x', name: 'X', a2a_url: 'https://x.example' }, NOW);
  assert.equal(r.releaseId, 'upstream');
  assert.equal(r.ownerRef.subject, '0xnode');
  assert.equal(r.agentCardUrl, 'https://x.example/.well-known/agent-card.json');
  assert.equal(infoAgentToRef(ISSUER, '0xNODE', { id: 'y', name: 'Y', reachable: true }, NOW), null);
});
