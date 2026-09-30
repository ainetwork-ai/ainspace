import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import SharedAgentPicker, { agentUrlForImport } from './SharedAgentPicker';
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
