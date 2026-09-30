import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOwnedByMe } from './agent-mapping';

test('isOwnedByMe: isMine 이 있으면 그것이 결정한다', () => {
  assert.equal(isOwnedByMe({ isMine: true, agentInvitedBy: 'someone-else' }, 'me'), true);
  assert.equal(isOwnedByMe({ isMine: false, agentInvitedBy: 'me' }, 'me'), false);
});

test('isOwnedByMe: isMine 이 없으면(구 백엔드) deprecated agentInvitedBy 로 판단한다', () => {
  assert.equal(isOwnedByMe({ agentInvitedBy: 'me' }, 'me'), true);
  assert.equal(isOwnedByMe({ agentInvitedBy: 'other' }, 'me'), false);
  assert.equal(isOwnedByMe({ agentInvitedBy: null }, 'me'), false);
  assert.equal(isOwnedByMe({}, 'me'), false);
  // 호출자 id 를 모르면 아무것도 내 것이 아니다 (null === null 로 새지 않게).
  assert.equal(isOwnedByMe({ agentInvitedBy: null }, null), false);
});
