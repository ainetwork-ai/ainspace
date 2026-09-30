import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import SharedAgentPicker, { agentListTitle, agentUrlForImport, loadSharedAgents } from './SharedAgentPicker';
import { withEnv } from '@/lib/ain-integration/__tests__/helpers';

test('플래그 off(기본) → 아무것도 렌더링하지 않는다', withEnv({ NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined }, () => {
  assert.equal(renderToStaticMarkup(<SharedAgentPicker onPick={() => {}} />), '');
}));

test('플래그 on → "공유 에이전트에서 선택" 진입점이 보인다', withEnv({ NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: 'true' }, () => {
  const html = renderToStaticMarkup(<SharedAgentPicker onPick={() => {}} />);
  assert.ok(html.includes('공유 에이전트에서 선택'));
}));

test('enabled prop 이 env 보다 우선한다', withEnv({ NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: 'true' }, () => {
  assert.equal(renderToStaticMarkup(<SharedAgentPicker onPick={() => {}} enabled={false} />), '');
}));

test('import 에 넣는 URL 은 endpoint 우선, 없으면 카드 URL', () => {
  assert.equal(agentUrlForImport({ endpoint: 'https://a/rpc', agentCardUrl: 'https://a/card' }), 'https://a/rpc');
  assert.equal(agentUrlForImport({ endpoint: '', agentCardUrl: 'https://a/card' }), 'https://a/card');
});

// ---------------------------------------------------------------- 20.1 결함 B: shared_with_me 401 → public/org 로 내려간다

const listBody = { contract: '1.0', asOf: '2026-09-30T00:00:00Z', nextCursor: null, items: [] };
const res = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('20.1 B: 기본은 scope 없이 불러 서버가 고른 범위(헤더)를 제목으로 쓴다', async () => {
  const urls: string[] = [];
  const r = await loadSharedAgents(async (u) => { urls.push(u); return res(listBody, 200, { 'x-ain-agent-scope': 'public' }); });
  assert.deepEqual(urls, ['/api/ain/shared-agents']);
  assert.equal(r.scope, 'public');
  assert.equal(r.error, null);
  assert.equal(agentListTitle(r.scope), '공개 에이전트');
  assert.equal(agentListTitle('shared_with_org'), '조직에 공유된 에이전트');
});

test('20.1 B: 명시한 범위가 401 auth_required(연결 안내 없음)면 기본 범위로 한 번 다시 묻는다 — "sign in to list…" 를 띄우지 않는다', async () => {
  const urls: string[] = [];
  const r = await loadSharedAgents(async (u) => {
    urls.push(u);
    return u.includes('shared_with_me')
      ? res({ error: { code: 'auth_required', message: 'sign in to list the agents shared with you', retryable: false } }, 401)
      : res({ ...listBody, items: [{ ref: { agentId: 'doc-summary' }, canInvoke: true }] }, 200, { 'x-ain-agent-scope': 'shared_with_org' });
  }, 'shared_with_me');
  assert.deepEqual(urls, ['/api/ain/shared-agents?scope=shared_with_me', '/api/ain/shared-agents']);
  assert.equal(r.error, null);
  assert.equal(r.items.length, 1);
  assert.equal(r.scope, 'shared_with_org');
});

test('20.1 B: 연결 안내(actionUrl)가 있는 401·그 밖의 오류는 그대로 보여 준다(다시 묻지 않는다)', async () => {
  let n = 0;
  const r = await loadSharedAgents(async () => { n++; return res({ error: { code: 'auth_required', message: '연결 필요', actionUrl: 'https://sso.example/connect' } }, 401); }, 'shared_with_me');
  assert.equal(n, 1);
  assert.deepEqual(r.error, { message: '연결 필요', actionUrl: 'https://sso.example/connect' });
  const down = await loadSharedAgents(async () => { throw new Error('x'); });
  assert.equal(down.error?.message, '공유 에이전트 목록을 불러오지 못했습니다.');
});

test('label prop 이 진입 버튼 문구를 바꾼다', withEnv({ NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: 'true' }, () => {
  assert.ok(renderToStaticMarkup(<SharedAgentPicker onPick={() => {}} label="다른 공유 에이전트 고르기" />).includes('다른 공유 에이전트 고르기'));
}));
