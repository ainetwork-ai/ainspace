import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { AinStateStore } from './ain-state-store';
import { VillageConnections } from './village-connections';
import { storageServer } from './server';
const player = { x: 1, y: 2, direction: 'stop', displayName: 'Owned player', spriteKey: 'sprite_user.png' };
function fixture() {
  const records = new Map<string, Record<string, string>>([['ainspace:village:owned', { slug: 'owned', name: 'Owned room', createdAt: '1000' }]]);
  // Revision CAS is covered with the real AinStateStore and competing chain writers.
  const store = {
    async hGetAll(key: string) { return { ...records.get(key) }; },
    async hInitializeExisting(key: string, field: string, value: string, expected: Record<string, string>) {
      const row = records.get(key);
      if (!row || !Object.entries(expected).every(([k, v]) => row[k] === v)) return null;
      return row[field] ?? (row[field] = value);
    },
  } as unknown as AinStateStore;
  return { records, store };
}
test('authenticated gateway commands retain the replacement tab and reject unsigned commands', async () => {
  const { store } = fixture(), secret = 'g'.repeat(40), server = storageServer(store, secret);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/command`;
  const command = async (body: Record<string, unknown>, auth = true) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + secret } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as { result: unknown } };
  };
  try {
    assert.equal((await command({ operation: 'village.instance', village: 'owned' }, false)).status, 401);
    const initialized = await command({ operation: 'village.instance', village: 'owned' });
    const instanceId = (initialized.body.result as { instanceId: string }).instanceId;
    const scope = { village: 'owned', instanceId, userId: 'account' };
    assert.equal((await command({ ...scope, operation: 'presence.join', connectionId: 'old', player })).body.result, true);
    assert.equal((await command({ ...scope, operation: 'presence.join', connectionId: 'new', player: { ...player, x: 4 } })).body.result, true);
    assert.equal((await command({ ...scope, operation: 'presence.release', connectionId: 'old' })).body.result, true);
    assert.deepEqual((await command({ ...scope, operation: 'presence.list' })).body.result, [{ ...player, x: 4, userId: 'account' }]);
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
test('deleted or replaced village authority denies stale stream mutations and does not recreate metadata', async () => {
  const { records, store } = fixture(), events: Record<string, unknown>[] = [];
  const connections = new VillageConnections(store, (_village, event) => events.push(event));
  const instance = await connections.execute({ operation: 'village.instance', village: 'owned' }) as { instanceId: string };
  const scope = { village: 'owned', instanceId: instance.instanceId, userId: 'account', connectionId: 'tab' };
  await connections.execute({ ...scope, operation: 'presence.join', player });
  records.delete('ainspace:village:owned');
  await assert.rejects(connections.execute({ ...scope, operation: 'presence.renew' }), /unavailable/);
  assert.equal(await connections.execute({ operation: 'village.instance', village: 'owned' }), null);
  assert.equal(records.size, 0);
  records.set('ainspace:village:owned', { slug: 'owned', name: 'New room', createdAt: '2000' });
  const replacement = await connections.execute({ operation: 'village.instance', village: 'owned' }) as { instanceId: string };
  assert.notEqual(replacement.instanceId, instance.instanceId);
  await assert.rejects(connections.execute({ ...scope, operation: 'presence.release' }), /instance changed/);
  assert.deepEqual(await connections.execute({ operation: 'presence.list', village: 'owned', instanceId: replacement.instanceId }), []);
  assert.equal(events.length, 1);
});
test('invalid coordinates fail before acquiring a lease or publishing an event', async () => {
  const { store } = fixture(), events: unknown[] = [];
  const connections = new VillageConnections(store, (_village, event) => events.push(event));
  const { instanceId } = await connections.execute({ operation: 'village.instance', village: 'owned' }) as { instanceId: string };
  const scope = { village: 'owned', instanceId, userId: 'account', connectionId: 'tab' };
  await assert.rejects(connections.execute({ ...scope, operation: 'presence.join', player: { ...player, x: Infinity } }), /Invalid presence player/);
  assert.equal(await connections.execute({ ...scope, operation: 'presence.has' }), false);
  assert.deepEqual(events, []);
});
