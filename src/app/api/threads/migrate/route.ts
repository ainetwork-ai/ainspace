import { NextRequest, NextResponse } from 'next/server';
import { migrateThreadsToWallet } from '@/lib/redis';
import { isValidUUID, isValidEthAddress } from '@/lib/utils';

/**
 * POST /api/threads/migrate
 * Migrate threads from sessionId to walletAddress
 *
 * Security: This endpoint relies on the fact that sessionId is:
 * 1. Generated client-side and stored in localStorage
 * 2. Only known to the user who owns it
 * 3. The user must have both sessionId AND walletAddress to call this
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { sessionId, walletAddress } = body;

        if (!sessionId || !walletAddress) {
            return NextResponse.json(
                { error: 'sessionId and walletAddress are required' },
                { status: 400 }
            );
        }

        // Validate sessionId format (must be UUID v4)
        if (!isValidUUID(sessionId)) {
            return NextResponse.json(
                { error: 'Invalid sessionId format' },
                { status: 400 }
            );
        }

        // Validate walletAddress format
        if (!isValidEthAddress(walletAddress)) {
            return NextResponse.json(
                { error: 'Invalid walletAddress format' },
                { status: 400 }
            );
        }

        const result = await migrateThreadsToWallet(sessionId, walletAddress);

        return NextResponse.json({
            success: true,
            migratedCount: result.migratedCount,
            skippedCount: result.skippedCount,
        });
    } catch (error) {
        console.error('Error migrating threads:', error);
        return NextResponse.json(
            { error: 'Failed to migrate threads' },
            { status: 500 }
        );
    }
}
