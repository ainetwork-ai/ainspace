import { NextRequest, NextResponse } from 'next/server';
import { getThreadMappings, saveThreadMapping, getRedisClient } from '@/lib/redis';

/**
 * GET /api/threads?userId={address}
 * Get all thread mappings for a user
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');

        if (!userId) {
            return NextResponse.json({ error: 'userId is required' }, { status: 400 });
        }

        const threads = await getThreadMappings(userId);

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
 * Save a thread mapping
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

        await saveThreadMapping(userId, threadName, id, agentNames);

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

/**
 * DELETE /api/threads?userId={address}&threadName={threadName}
 * Delete a specific thread mapping
 */
export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');
        const threadName = searchParams.get('threadName');

        if (!userId || !threadName) {
            return NextResponse.json(
                { error: 'userId and threadName are required' },
                { status: 400 }
            );
        }

        const redis = await getRedisClient();
        await redis.hDel(`user:${userId}:threads`, threadName);

        return NextResponse.json({
            success: true,
            message: `Thread ${threadName} deleted successfully`,
        });
    } catch (error) {
        console.error('Error deleting thread:', error);
        return NextResponse.json(
            { error: 'Failed to delete thread' },
            { status: 500 }
        );
    }
}
