import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveHuddleLaunch } from './resolve-huddle-launch';

test('uses the authenticated same-origin fetcher and accepts only the configured source launch shape', async () => {
  const controller = new AbortController();
  const url = await resolveHuddleLaunch(async (path, init) => {
    assert.equal(path, '/api/ain/villages/my-space/huddle');
    assert.equal(init?.signal, controller.signal);
    return Response.json({ joinUrl: 'https://teams.example/meetings/space?slug=my-space' });
  }, 'my-space', controller.signal);
  assert.equal(url, 'https://teams.example/meetings/space?slug=my-space');
  for (const joinUrl of ['https://teams.example/meetings/space?slug=other', 'https://teams.example/meetings/space?slug=my-space&token=secret', 'http://teams.example/meetings/space?slug=my-space', 'https://user:password@teams.example/meetings/space?slug=my-space', 'javascript:alert(1)']) {
    await assert.rejects(resolveHuddleLaunch(async () => Response.json({ joinUrl }), 'my-space', controller.signal));
  }
});

test('cancellation releases the UI even when authentication refresh ignores the abort signal', async () => {
  const controller = new AbortController();
  const pending = resolveHuddleLaunch(async () => new Promise<Response>(() => {}), 'my-space', controller.signal);
  const reason = new Error('Owned timeout'); controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
});

test('cancellation also bounds stalled JSON bodies and prevents a late navigation result', async () => {
  const controller = new AbortController(); let finish!: (value: unknown) => void;
  const body = new Promise(resolve => { finish = resolve; });
  const pending = resolveHuddleLaunch(async () => ({ ok: true, json: () => body }) as Response, 'my-space', controller.signal);
  await Promise.resolve(); controller.abort(); await assert.rejects(pending);
  finish({ joinUrl: 'https://teams.example/meetings/space?slug=my-space' });
});

test('already cancelled requests never fetch and source denial never yields a destination', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(resolveHuddleLaunch(async () => { calls++; return Response.json({}); }, 'my-space', controller.signal));
  assert.equal(calls, 0);
  await assert.rejects(resolveHuddleLaunch(async () => new Response(null, { status: 404 }), 'my-space', new AbortController().signal), /권한/);
});
