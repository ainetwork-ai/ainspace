import { NextRequest, NextResponse } from "next/server";
import { deleteThread } from "@/lib/redis";
import { backendFetch, getBearer } from "@/lib/backend/server-client";
import { BackendDmMessage, mapBackendMessageToAinspace } from "@/lib/backend/dm-mapping";

/**
 * GET /api/threads/{conversationId}
 * EPIC14: fetch DM messages from the new backend, translated to the existing
 * ainspace shape consumed by ChatBox.fetchThreadMessages (line 108-120):
 *   { success: true, messages: [{ id, content, timestamp, speaker }] }
 * Backend returns messages in createdAt DESC; ainspace renders chronological,
 * so we reverse before mapping.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    const token = getBearer(request);
    if (!token) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    try {
        const res = await backendFetch(token, `/dm/${id}/messages`);
        if (!res.ok) {
            const body = await res.text();
            return new NextResponse(body, {
                status: res.status,
                headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
            });
        }
        const data = (await res.json()) as { messages: BackendDmMessage[] };
        // [PROFILE-DEBUG] TEMPORARY (dev experiment) — does the backend send
        // user.avatarUrl per message? Log the raw author shape of agent messages.
        console.log('[PROFILE-DEBUG] raw /dm messages users:', JSON.stringify(
            data.messages.slice(0, 8).map((m) => ({ userId: m.userId, user: m.user })),
        ));
        const messages = [...data.messages].reverse().map(mapBackendMessageToAinspace);
        return NextResponse.json({ success: true, messages });
    } catch (error) {
        console.error('Error getting thread messages:', error);
        return NextResponse.json({ error: 'Failed to get thread messages' }, { status: 500 });
    }
}

/**
 * DELETE /api/threads/{threadId}?userId={userId}
 * Delete a specific thread
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: threadId } = await params;
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');

        if (!userId) {
            return NextResponse.json(
                { error: 'userId is required' },
                { status: 400 }
            );
        }

        await deleteThread(userId, threadId);

        return NextResponse.json({
            success: true,
            message: `Thread ${threadId} deleted successfully`,
        });
    } catch (error) {
        console.error('Error deleting thread:', error);
        return NextResponse.json(
            { error: 'Failed to delete thread' },
            { status: 500 }
        );
    }
}