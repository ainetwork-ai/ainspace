import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommonAgentId } from './common-agent-id';

test('parseCommonAgentId: 없으면 undefined, 맞으면 정규화, 틀리면 false', () => {
  assert.equal(parseCommonAgentId(undefined), undefined);
  assert.equal(parseCommonAgentId(''), undefined);
  assert.equal(parseCommonAgentId('https://ainize.ai#gallery-guide'), 'https://ainize.ai#gallery-guide');
  assert.equal(parseCommonAgentId('https://ainize.ai/#gallery-guide'), 'https://ainize.ai#gallery-guide');
  assert.equal(parseCommonAgentId('http://localhost:3000#a'), 'http://localhost:3000#a');
  assert.equal(parseCommonAgentId('http://evil.example#a'), false);
  assert.equal(parseCommonAgentId('https://ainize.ai#with/slash'), false);
  assert.equal(parseCommonAgentId('https://ainize.ai#'), false);
  assert.equal(parseCommonAgentId('no-hash'), false);
  assert.equal(parseCommonAgentId(42), false);
});
