import { NextRequest, NextResponse } from 'next/server';
import { backendFetch, getBearer } from '@/lib/backend/server-client';

interface RequestBody {
    message: string;
    threadId: string;
    userId?: string;
    metadata?: Record<string, unknown>;
}

/**
 * POST /api/thread-message
 * EPIC14: send a user message to the new backend DM. Backend's
 * `POST /dm/:id/messages` inserts the message AND auto-triggers orchestration
 * internally (non-builder ≥2 agents → orchestration / else single send), so
 * ainspace doesn't need to call /orchestration/.../send separately. The agent
 * responses arrive via the SSE stream (proxied by /api/thread-stream).
 */
export async function POST(request: NextRequest) {
    const token = getBearer(request);
    if (!token) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    try {
        const body: RequestBody = await request.json();
        const { message, threadId, metadata } = body;

        if (!message || !threadId) {
            return NextResponse.json(
                { error: 'message and threadId are required' },
                { status: 400 }
            );
        }

        const res = await backendFetch(token, `/dm/${threadId}/messages`, {
            method: 'POST',
            body: JSON.stringify({ content: message, metadata }),
        });

        if (!res.ok) {
            const errBody = await res.text();
            return new NextResponse(errBody, {
                status: res.status,
                headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
            });
        }

        return NextResponse.json({ success: true, threadId });
    } catch (error: unknown) {
        console.error('Thread message error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to send thread message' },
            { status: 500 }
        );
    }
}
