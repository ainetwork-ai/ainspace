import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionPresence } from './connection-presence';
const player = { x: 1, y: 2, direction: 'down', displayName: 'Owned player', spriteKey: 'sprite_user.png' };
test('an older stream closing cannot evict the replacement stream or another tab', () => {
  const leases = new ConnectionPresence();
  leases.join('room', 'instance', 'alice', 'old', player);
  leases.join('room', 'instance', 'alice', 'new', { ...player, x: 5 });
  assert.equal(leases.release('room', 'instance', 'alice', 'old'), true);
  assert.equal(leases.release('room', 'instance', 'alice', 'old'), false);
  assert.deepEqual(leases.snapshot('room', 'instance'), [{ ...player, x: 5, userId: 'alice' }]);
  assert.equal(leases.has('room', 'instance', 'alice'), true);
});
test('different users connect concurrently and only the final tab removes a player', async () => {
  const leases = new ConnectionPresence();
  await Promise.all(Array.from({ length: 50 }, async (_, i) => leases.join('room', 'instance', 'user-' + i, 'tab', player)));
  leases.join('room', 'instance', 'user-0', 'other-tab', player);
  leases.release('room', 'instance', 'user-0', 'tab');
  assert.equal(leases.snapshot('room', 'instance').length, 50);
  leases.release('room', 'instance', 'user-0', 'other-tab');
  assert.equal(leases.snapshot('room', 'instance').length, 49);
});
test('heartbeats extend only a live lease and cannot revive an expired or released stream', () => {
  let now = 0; const leases = new ConnectionPresence(() => now);
  leases.join('room', 'instance', 'alice', 'tab', player);
  now = 40_000; assert.equal(leases.renew('room', 'instance', 'alice', 'tab'), true);
  now = 80_000; assert.equal(leases.has('room', 'instance', 'alice'), true);
  now = 85_000; assert.equal(leases.renew('room', 'instance', 'alice', 'tab'), false);
  assert.deepEqual(leases.snapshot('room', 'instance'), []);
  assert.equal(leases.renew('room', 'instance', 'alice', 'unknown'), false);
});
test('village and instance boundaries survive late callbacks and gateway restart', () => {
  const leases = new ConnectionPresence();
  leases.join('room', 'new', 'alice', 'tab', player);
  assert.equal(leases.release('room', 'old', 'alice', 'tab'), false);
  assert.equal(leases.renew('other', 'new', 'alice', 'tab'), false);
  leases.invalidate('room', 'old'); assert.equal(leases.has('room', 'new', 'alice'), true);
  leases.invalidate('room', 'new'); assert.equal(leases.has('room', 'new', 'alice'), false);
  assert.deepEqual(new ConnectionPresence().snapshot('room', 'new'), []);
});
test('latest movement wins and removing that tab restores the remaining live position', () => {
  const leases = new ConnectionPresence();
  leases.join('room', 'instance', 'alice', 'one', player);
  leases.join('room', 'instance', 'alice', 'two', { ...player, x: 2 });
  leases.renew('room', 'instance', 'alice', 'one', { ...player, x: 3 });
  const snapshot = leases.snapshot('room', 'instance'); snapshot[0].x = 999;
  assert.equal(leases.snapshot('room', 'instance')[0].x, 3);
  leases.release('room', 'instance', 'alice', 'one');
  assert.equal(leases.snapshot('room', 'instance')[0].x, 2);
});
