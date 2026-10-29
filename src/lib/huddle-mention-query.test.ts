import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHuddleMentionQuery } from './huddle-mention-query';
const id = '11111111-1111-4111-8111-111111111111';
test('mention cursor validation rejects extra fields, duplicate cursors and missing instance scope', () => {
  assert.deepEqual(parseHuddleMentionQuery(new URLSearchParams('after=' + id), false), { after: id });
  assert.deepEqual(parseHuddleMentionQuery(new URLSearchParams('instanceId=' + id), true), { instanceId: id });
  for (const query of ['after=invalid', `after=${id}&after=${id}`, `instanceId=${id}`, 'unknown=value']) {
    assert.equal(parseHuddleMentionQuery(new URLSearchParams(query), false), null);
  }
  assert.equal(parseHuddleMentionQuery(new URLSearchParams(), true), null);
});
