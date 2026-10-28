/** Parse a fetch SSE body, including split UTF-8 characters and CRLF boundaries. */
export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void,
  signal: AbortSignal,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let event = 'message';
  let data: string[] = [];
  let eventBytes = 0;
  const line = (value: string) => {
    if (!value) {
      if (data.length && !signal.aborted) onEvent(event, data.join('\n'));
      event = 'message'; data = []; eventBytes = 0;
      return;
    }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? '' : value.slice(colon + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'event') event = content || 'message';
    if (field === 'data') { data.push(content); eventBytes += content.length; }
    if (eventBytes > 1_048_576) throw new Error('Event stream frame exceeds limit');
  };
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (!signal.aborted) {
      const next = await reader.read();
      pending += decoder.decode(next.value, { stream: !next.done });
      let separator: number;
      while ((separator = pending.indexOf('\n')) >= 0) {
        let value = pending.slice(0, separator);
        if (value.endsWith('\r')) value = value.slice(0, -1);
        pending = pending.slice(separator + 1);
        line(value);
      }
      if (pending.length > 1_048_576) throw new Error('Event stream line exceeds limit');
      if (next.done) break;
    }
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
