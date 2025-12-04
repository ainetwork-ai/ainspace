import { NextRequest, NextResponse } from 'next/server';
import { getThreads, saveThread, generateAgentComboId } from '@/lib/redis';
import { Thread } from '@/types/thread';

/**
 * GET /api/threads?userId={address}
 * Get all threads for a user
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');

        if (!userId) {
            return NextResponse.json({ error: 'userId is required' }, { status: 400 });
        }

        const threads = await getThreads(userId);

        return NextResponse.json({
            success: true,
            threads,
        });
    } catch (error) {
        console.error('Error getting threads:', error);
        return NextResponse.json(
            { error: 'Failed to get threads' },
            { status: 500 }
        );
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
            return NextResponse.json(
                { error: 'userId, threadName, id, and agentNames are required' },
                { status: 400 }
            );
        }

        const agentComboId = generateAgentComboId(agentNames);
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
            id,
        });
    } catch (error) {
        console.error('Error saving thread:', error);
        return NextResponse.json(
            { error: 'Failed to save thread' },
            { status: 500 }
        );
    }
}

