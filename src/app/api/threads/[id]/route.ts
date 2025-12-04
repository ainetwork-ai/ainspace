import { NextRequest, NextResponse } from "next/server";
import { deleteThread } from "@/lib/redis";

const A2A_ORCHESTRATION_BASE_URL = process.env.NEXT_PUBLIC_A2A_ORCHESTRATION_BASE_URL;

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const endpoint = `${A2A_ORCHESTRATION_BASE_URL}/threads/${id}/messages`;

    try {
        const response = await fetch(endpoint);
        const data = await response.json();
        return NextResponse.json(data);
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