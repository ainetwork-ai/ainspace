import { NextRequest } from 'next/server';
import { Agent } from 'undici';
import { BACKEND_BASE_URL } from '@/lib/backend/config';
import { getBearer } from '@/lib/backend/server-client';

// Configure route to handle long-lived streaming connections
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800; // Vercel Pro streaming limit

// Long-lived SSE: disable undici's default header/body read timeouts so an idle
// orchestration stream (gaps between agent events) isn't killed with
// UND_ERR_BODY_TIMEOUT. (The inline `bodyTimeout` RequestInit option is ignored
// by fetch — it must be set on the dispatcher.)
const streamDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

/**
 * GET /api/thread-stream/{conversationId}?token=<accessToken>
 * EPIC14/15: proxy the new backend orchestration SSE
 * (`GET /orchestration/dm/:id/stream`). EventSource can't send the
 * Authorization header, so the browser passes the access token via `?token=`
 * and the BFF forwards it as a Bearer header server-to-server.
 *
 * The synthetic `connected` event is emitted IMMEDIATELY (before the backend
 * fetch resolves) and the Response is returned right away. This is deliberate:
 * ChatBox waits for `connected` before sending the first message, and that
 * message is what triggers backend orchestration — which is what makes the
 * backend stream produce output. Waiting on the backend's response headers
 * first would deadlock (client times out → no message → no orchestration → no
 * headers). So we connect to the backend and pump inside the stream's start().
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await params;

  if (!threadId) {
    return new Response('Thread ID is required', { status: 400 });
  }

  const token = getBearer(request);
  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = `${BACKEND_BASE_URL}/orchestration/dm/${threadId}/stream`;
  const encoder = new TextEncoder();
  const controller = new AbortController();

  const stream = new ReadableStream({
    async start(streamController) {
      // Emit `connected` immediately — don't make the client wait on the
      // backend's (possibly deferred) response headers (see route doc above).
      streamController.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
          },
          signal: controller.signal,
          // @ts-expect-error - undici dispatcher to disable read timeouts
          dispatcher: streamDispatcher,
        });
      } catch (error) {
        console.error('SSE proxy connect error:', error);
        try { streamController.close(); } catch { /* already closed */ }
        return;
      }

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.error(
          `Failed to connect to backend stream: ${response.status} ${url} :: ${errBody}`,
        );
        try {
          streamController.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'error', data: { status: response.status, body: errBody } })}\n\n`,
          ));
        } catch { /* already closed */ }
        try { streamController.close(); } catch { /* already closed */ }
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        try { streamController.close(); } catch { /* already closed */ }
        return;
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log('Stream completed for thread:', threadId);
            break;
          }
          streamController.enqueue(value);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log('Stream aborted for thread:', threadId);
        } else {
          console.error('Stream error:', error);
        }
        try { streamController.error(error); } catch { /* already closed */ }
      } finally {
        try { streamController.close(); } catch { /* already closed */ }
        controller.abort();
      }
    },
    cancel() {
      console.log('Stream cancelled for thread:', threadId);
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    },
  });
}
