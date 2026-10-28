import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEventStream } from './read-event-stream';

test('fetch SSE preserves named events, multiline Korean data and split CRLF/UTF-8', async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\nevent: presence\r\ndata: 안녕\r\ndata: 함께\r\n\r\ndata: default\n\n');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // One-byte chunks exercise every UTF-8 and line-boundary split.
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const events: [string, string][] = [];
  await readEventStream(body, (event, data) => events.push([event, data]), new AbortController().signal);
  assert.deepEqual(events, [['presence', '안녕\n함께'], ['message', 'default']]);
});

test('abort cancels the pending reader and prevents subsequent event dispatch', async () => {
  let cancelled = false;
  const controller = new AbortController();
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const events: string[] = [];
  const reading = readEventStream(body, (_, data) => events.push(data), controller.signal);
  controller.abort();
  await reading;
  assert.equal(cancelled, true);
  assert.deepEqual(events, []);
});
