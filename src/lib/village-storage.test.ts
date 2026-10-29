import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAllVillages, getNearbyVillages } from './village-storage';

// 2026-10-29: the village list read each village's hash one at a time from Vercel to the on-prem
// storage gateway (~60 sequential round trips, 2–16 s per map load). Reads now overlap, bounded.
function gateway(t: import('node:test').TestContext, slugs: string[]) {
  for (const [key, value] of Object.entries({ AINSPACE_STORAGE_URL: 'https://storage.example/api/storage', AINSPACE_STORAGE_TOKEN: 'fixture-token' })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const state = { inFlight: 0, peak: 0 };
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    const command = JSON.parse(options.body as string);
    if (command.operation === 'sMembers') return Response.json({ result: slugs });
    if (command.operation === 'mGet') return Response.json({ result: command.keys.map((_: string, i: number) => slugs[i] ?? null) });
    assert.equal(command.operation, 'hGetAll');
    state.inFlight++; state.peak = Math.max(state.peak, state.inFlight);
    await new Promise(r => setTimeout(r, 5));
    state.inFlight--;
    const slug = command.key.slice('village:'.length);
    return Response.json({ result: { slug, name: slug, gridX: '0', gridY: '0', tmjUrl: 'x', tilesetBaseUrl: 'y', createdAt: '1', updatedAt: '1' } });
  });
  return state;
}

test('the full village list reads villages concurrently, bounded, in their original order', async t => {
  const slugs = Array.from({ length: 30 }, (_, i) => `v${i}`);
  const state = gateway(t, slugs);
  const villages = await getAllVillages();
  assert.deepEqual(villages.map(v => v.slug), slugs);
  assert.ok(state.peak > 1, 'reads overlap');
  assert.ok(state.peak <= 8, 'reads stay bounded: ' + state.peak);
});

test('nearby villages read concurrently too', async t => {
  const slugs = ['a', 'b', 'c', 'd'];
  const state = gateway(t, slugs);
  const villages = await getNearbyVillages(0, 0);
  assert.deepEqual(villages.map(v => v.slug).sort(), slugs);
  assert.ok(state.peak > 1, 'reads overlap');
});
