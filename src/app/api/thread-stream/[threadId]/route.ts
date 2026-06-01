import { NextRequest } from 'next/server';
import { BACKEND_BASE_URL } from '@/lib/backend/config';
import { getBearer } from '@/lib/backend/server-client';

// Configure route to handle long-lived streaming connections
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800; // Vercel Pro streaming limit

/**
 * GET /api/thread-stream/{conversationId}?token=<accessToken>
 * EPIC14: proxy the new backend orchestration SSE
 * (`GET /orchestration/dm/:id/stream`). EventSource can't send the
 * Authorization header, so the browser passes the access token via `?token=`
 * and the BFF forwards it as a Bearer header server-to-server.
 *
 * Backend (`@Sse`) emits only `{type:"message"|"block", data:{...}}` — no
 * `connected` event and no `[DONE]` sentinel. ChatBox.handleStreamEvent waits
 * for a `connected` event (line 160-167) for the new-thread flow; we emit one
 * synthetically as soon as the upstream stream opens so the handler resolves.
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

  try {
    const controller = new AbortController();

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
      signal: controller.signal,
      // @ts-expect-error - undici specific options to prevent body timeout
      bodyTimeout: 0,
      headersTimeout: 0,
    });

    if (!response.ok) {
      console.error('Failed to connect to backend stream:', response.status);
      return new Response(`Failed to connect: ${response.statusText}`, {
        status: response.status,
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(streamController) {
        // Synthetic `connected` event (backend @Sse doesn't emit one) so the
        // chat's sseConnectedResolverRef resolves on the new-thread send path.
        streamController.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));

        const reader = response.body?.getReader();
        if (!reader) {
          streamController.close();
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
          try {
            streamController.error(error);
          } catch {
            // Stream already closed
          }
        } finally {
          try {
            streamController.close();
          } catch {
            // Stream already closed
          }
          controller.abort();
        }
      },
      cancel() {
        console.log('Stream cancelled for thread:', threadId);
        controller.abort();
      }
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
  } catch (error) {
    console.error('SSE proxy error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
