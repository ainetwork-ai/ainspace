import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_BASE_URL, isBackendConfigured } from '@/lib/backend/config';

/**
 * POST /api/backend-auth/refresh
 * Forwards a refresh token to the backend for rotation.
 * Body: { refreshToken }
 */
export async function POST(request: NextRequest) {
    if (!isBackendConfigured()) {
        return NextResponse.json({ error: 'backend not configured' }, { status: 503 });
    }

    try {
        const { refreshToken } = await request.json();

        const res = await fetch(`${BACKEND_BASE_URL}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
        });

        const data = await res.json();
        return NextResponse.json(data, { status: res.status });
    } catch (error) {
        console.error('backend-auth refresh proxy failed:', error);
        return NextResponse.json({ error: 'refresh request failed' }, { status: 502 });
    }
}
