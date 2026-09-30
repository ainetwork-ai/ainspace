import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import taskRef from '@/lib/ain-integration/__fixtures__/task-ref.json';
import AskSharedAgentPanel, { AskResultCard } from './AskSharedAgentPanel';
import { cancelTurn, startTurn, type AskTurn } from '@/lib/ain-integration/ask-client';
import type { TaskRef } from '@/lib/ain-integration/types';
import { withEnv } from '@/lib/ain-integration/__tests__/helpers';

const placed = { agentKey: 'https://ainize.example#guide', name: '갤러리 안내', placedIn: 'alpha' };
const shared = { agentKey: 'https://ainize.example#doc-summary', name: '문서 요약', placedIn: null };
const turn = (o: Partial<AskTurn> = {}): AskTurn => ({ ...startTurn({ target: placed, text: '개관 시간?', files: [], conversation: 'ask_1', room: 'alpha' }, 'turn_1'), ...o });

test('플래그 off·로그아웃 → 렌더링하지 않는다', withEnv({ NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined }, () => {
  assert.equal(renderToStaticMarkup(<AskSharedAgentPanel slug="alpha" placedAgents={[placed]} loggedIn />), '');
  assert.equal(renderToStaticMarkup(<AskSharedAgentPanel slug="alpha" placedAgents={[placed]} loggedIn={false} enabled />), '');
}));

test('플래그 on → 채팅에 "공유 에이전트에게 묻기" 진입점', withEnv({ NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: 'true' }, () => {
  const html = renderToStaticMarkup(<AskSharedAgentPanel slug="alpha" placedAgents={[placed]} loggedIn />);
  assert.ok(html.includes('data-testid="ask-shared-agent-panel"'));
  assert.ok(html.includes('공유 에이전트에게 묻기'));
  assert.ok(!html.includes('data-testid="ask-form"'), '닫혀 있다');
}));

test('열린 폼: 이 마을의 배치 에이전트, 공유 에이전트 선택기, 공유 파일 선택기, 마을 자료 체크(배치 에이전트일 때만), 묻기', () => {
  const html = renderToStaticMarkup(<AskSharedAgentPanel slug="alpha" placedAgents={[placed]} loggedIn enabled initialOpen initialTarget={placed} />);
  assert.ok(html.includes('data-testid="ask-placed-agents"'));
  assert.ok(html.includes('갤러리 안내'));
  assert.ok(html.includes('다른 공유 에이전트 고르기'));
  assert.ok(html.includes('공유 파일'));
  assert.ok(html.includes('이 마을의 자료도 넘기기'));
  assert.ok(!html.includes('(이 마을에 배치된 에이전트만)'));
  assert.ok(html.includes('묻기'));

  const other = renderToStaticMarkup(<AskSharedAgentPanel slug="alpha" placedAgents={[placed]} loggedIn enabled initialOpen initialTarget={shared} />);
  assert.ok(other.includes('(이 마을에 배치된 에이전트만)'), '배치되지 않은 에이전트는 마을 자료를 고를 수 없다');
  const outside = renderToStaticMarkup(<AskSharedAgentPanel slug={null} placedAgents={[]} loggedIn enabled initialOpen />);
  assert.ok(!outside.includes('이 마을의 자료도 넘기기'), '마을 밖');
});

test('결과 카드(완료): 상태·답·Sources(원본 열기 링크, 인용)', () => {
  const html = renderToStaticMarkup(<AskResultCard turn={turn({ phase: 'completed', task: taskRef as TaskRef, text: '개관은 10:00 입니다.' })} onCancel={() => {}} onRetry={() => {}} />);
  assert.ok(html.includes('data-status="completed"'));
  assert.ok(html.includes('data-request-id="turn_1"'));
  assert.ok(html.includes('완료'));
  assert.ok(html.includes('개관은 10:00 입니다.'));
  assert.ok(html.includes('data-testid="ask-sources"'));
  assert.ok(html.includes('Sources'));
  assert.ok(html.includes('전시 안내.pdf'));
  assert.ok(html.includes(`href="${(taskRef as TaskRef).sources[0].file.sourceUrl}"`));
  assert.ok(html.includes('원본 열기'));
  assert.ok(html.includes('page 2 — 개관 10:00'));
  assert.ok(!html.includes('취소') && !html.includes('다시 시도'));
});

test('결과 카드(진행 중): 요청 중 + 취소 버튼, 답·Sources 없음', () => {
  const html = renderToStaticMarkup(<AskResultCard turn={turn()} onCancel={() => {}} onRetry={() => {}} />);
  assert.ok(html.includes('data-status="pending"'));
  assert.ok(html.includes('요청 중'));
  assert.ok(html.includes('취소'));
  assert.ok(!html.includes('ask-sources'));
});

test('결과 카드(취소·실패): 취소됨 + 다시 시도, 연결 안내 버튼(actionUrl)', () => {
  const canceled = renderToStaticMarkup(<AskResultCard turn={cancelTurn(turn())} onCancel={() => {}} onRetry={() => {}} />);
  assert.ok(canceled.includes('data-status="canceled"'));
  assert.ok(canceled.includes('취소됨'));
  assert.ok(canceled.includes('다시 시도'));
  const auth = renderToStaticMarkup(<AskResultCard
    turn={turn({ phase: 'failed', error: { code: 'auth_required', message: 'AIN SSO 연결이 필요합니다.', retryable: false, actionUrl: 'https://teams.example/sso' } })}
    onRetry={() => {}} onConnect={() => {}} />);
  assert.ok(auth.includes('실패'));
  assert.ok(auth.includes('AIN SSO 연결이 필요합니다.'));
  assert.ok(auth.includes('연결하기'));
  assert.ok(!auth.includes('다시 시도'), '재시도 불가 오류');
});

test('패널: 이전 차례 카드들이 채팅 위에 쌓인다', () => {
  const html = renderToStaticMarkup(<AskSharedAgentPanel slug="alpha" placedAgents={[placed]} loggedIn enabled initialTurns={[turn({ phase: 'completed', task: taskRef as TaskRef, text: '답' }), turn({ requestId: 'turn_2' })]} />);
  assert.equal(html.split('data-testid="ask-result-card"').length - 1, 2);
});
