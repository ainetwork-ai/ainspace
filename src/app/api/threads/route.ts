import { NextRequest, NextResponse } from 'next/server';
import { saveThread } from '@/lib/redis';
import { generateAgentComboId } from '@/lib/hash';
import { Thread } from '@/stores';
import { backendFetch, decodeWorkspaceId, getBearer } from '@/lib/backend/server-client';
import { BackendDmListItem, mapDmToThread } from '@/lib/backend/dm-mapping';

/**
 * GET /api/threads
 * EPIC14: list the user's backend DMs (architecture C — BFF forwards the
 * browser-held Bearer to the new backend server-to-server). Response shape
 * matches the legacy orchestration response so chat UI is unchanged:
 *   { success: true, threads: { [id]: Thread } }
 * Guests (no Bearer) get an empty list — chat now requires wallet login since
 * the orchestration server is being decommissioned.
 */
export async function GET(request: NextRequest) {
    const token = getBearer(request);
    if (!token) {
        return NextResponse.json({ success: true, threads: {} });
    }

    const workspaceId = decodeWorkspaceId(token);
    if (!workspaceId) {
        return NextResponse.json({ error: 'workspaceId missing in token' }, { status: 400 });
    }

    try {
        const res = await backendFetch(
            token,
            `/dm?workspaceId=${encodeURIComponent(workspaceId)}`,
        );
        if (!res.ok) {
            const body = await res.text();
            return new NextResponse(body, {
                status: res.status,
                headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
            });
        }
        const list = (await res.json()) as BackendDmListItem[];
        const entries = await Promise.all(
            list.map(async (dm) => [dm.id, await mapDmToThread(dm)] as const),
        );
        return NextResponse.json({
            success: true,
            threads: Object.fromEntries(entries),
        });
    } catch (error) {
        console.error('Error listing backend DMs:', error);
        return NextResponse.json({ error: 'Failed to get threads' }, { status: 500 });
    }
}

/**
 * POST /api/threads
 * Save a thread
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { userId, threadName, id, agentNames } = body;

        if (!userId || !threadName || !id || !agentNames) {
            return NextResponse.json({ error: 'userId, threadName, id, and agentNames are required' }, { status: 400 });
        }

        const agentComboId = await generateAgentComboId(agentNames);
        const thread: Thread = {
            id,
            threadName,
            agentNames,
            agentComboId,
            createdAt: new Date().toISOString(),
            lastMessageAt: new Date().toISOString()
        };

        await saveThread(userId, thread);

        return NextResponse.json({
            success: true,
            threadName,
            id
        });
    } catch (error) {
        console.error('Error saving thread:', error);
        return NextResponse.json({ error: 'Failed to save thread' }, { status: 500 });
    }
}
