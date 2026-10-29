import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanKeys } from './storage';
import { storageClient } from './storage-client';

// Every page load scanned agents:* and auth:* (2026-10-29: one scan per request read every record
// head on the chain). Scans now share a short-lived result, and any write through this process
// drops it so its own changes show at once.
function gateway(t: import('node:test').TestContext) {
  for (const [key, value] of Object.entries({ AINSPACE_STORAGE_URL: 'https://storage.example/api/storage', AINSPACE_STORAGE_TOKEN: 'fixture-token' })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    const command = JSON.parse(options.body as string);
    calls.push(command.operation);
    return Response.json({ result: command.operation === 'scan' ? ['agents:a', 'agents:b'] : 'OK' });
  });
  return calls;
}

test('repeated scans within a few seconds share one gateway scan', async t => {
  const calls = gateway(t);
  let now = 1_000_000; t.mock.method(Date, 'now', () => now);
  assert.deepEqual(await scanKeys('agents:*'), ['agents:a', 'agents:b']);
  assert.deepEqual(await scanKeys('agents:*'), ['agents:a', 'agents:b']);
  assert.equal(calls.filter(c => c === 'scan').length, 1);
  now += 11_000;
  await scanKeys('agents:*');
  assert.equal(calls.filter(c => c === 'scan').length, 2, 'expired results are scanned again');
});

test('a write through this process drops cached scans', async t => {
  const calls = gateway(t);
  const now = 2_000_000; t.mock.method(Date, 'now', () => now);
  await scanKeys('auth:*');
  await storageClient.set('auth:new', 'x');
  await scanKeys('auth:*');
  assert.equal(calls.filter(c => c === 'scan').length, 2);
});
