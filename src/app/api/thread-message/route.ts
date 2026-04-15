import { NextRequest, NextResponse } from 'next/server';
import { sendMessage } from '@/lib/a2aOrchestration';

interface RequestBody {
    message: string;
    threadId: string;
    userId: string;
}

export async function POST(request: NextRequest) {
    try {
        const body: RequestBody = await request.json();
        const { message, threadId, userId } = body;

        if (!message || !threadId || !userId) {
            return NextResponse.json(
                { error: 'message, threadId, and userId are required' },
                { status: 400 }
            );
        }

        await sendMessage(threadId, message);

        return NextResponse.json({
            success: true,
            threadId,
        });
    } catch (error: unknown) {
        console.error('Thread message error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to send thread message' },
            { status: 500 }
        );
    }
}
