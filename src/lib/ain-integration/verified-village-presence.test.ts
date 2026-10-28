import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryVillageDirectory } from './village-membership';
test('verified presence preserves another tab and fences late renewal after departure', async () => {
  const directory = memoryVillageDirectory({ villages: ['village'] });
  const now = Date.now();
  assert.equal(await directory.markPresent('village', 'user', now, 'tab-a'), true);
  assert.equal(await directory.markPresent('village', 'user', now, 'tab-b'), true);
  await directory.markPresent('village', 'other', now, 'tab-other');
  await directory.clearPresent('village', 'user', 'tab-a');
  assert.equal(await directory.isPresent('village', 'user', now), true);
  assert.equal(await directory.markPresent('village', 'user', now, 'tab-a'), false);
  await directory.clearPresent('village', 'user');
  assert.equal(await directory.isPresent('village', 'user', now), true);
  await directory.clearPresent('village', 'user', 'tab-b');
  assert.equal(await directory.isPresent('village', 'user', now), false);
  assert.equal(await directory.isPresent('village', 'other', now), true);
  assert.equal(await directory.markPresent('village', 'user', now, 'tab-new'), true);
});
