import { NextRequest } from 'next/server';

const A2A_ORCHESTRATION_BASE_URL = 'https://a2a-orchestration.ainetwork.ai/api';

// Configure route to handle long-lived streaming connections
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max duration

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await params;

  if (!threadId) {
    return new Response('Thread ID is required', { status: 400 });
  }

  // Create SSE connection to A2A Orchestration
  const url = `${A2A_ORCHESTRATION_BASE_URL}/threads/${threadId}/stream`;

  console.log('Proxying SSE connection to:', url);

  try {
    // Create AbortController to handle connection cleanup
    const controller = new AbortController();

    const response = await fetch(url, {
      headers: {
        'Accept': 'text/event-stream',
      },
      signal: controller.signal,
      // @ts-expect-error - undici specific options to prevent body timeout
      bodyTimeout: 0,
      headersTimeout: 0,
    });

    if (!response.ok) {
      console.error('Failed to connect to A2A stream:', response.status);
      return new Response(`Failed to connect: ${response.statusText}`, {
        status: response.status
      });
    }

    // Create a readable stream from the response
    const stream = new ReadableStream({
      async start(streamController) {
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
          console.error('Stream error:', error);
          // Only close if not already closed
          try {
            streamController.error(error);
          } catch (e) {
            // Stream already closed
          }
        } finally {
          try {
            streamController.close();
          } catch (e) {
            // Stream already closed
          }
          controller.abort(); // Clean up fetch
        }
      },
      cancel() {
        console.log('Stream cancelled for thread:', threadId);
        controller.abort(); // Clean up fetch when client disconnects
      }
    });

    // Return SSE response with proper headers
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      },
    });
  } catch (error) {
    console.error('SSE proxy error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
