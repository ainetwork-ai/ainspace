import { NextResponse } from 'next/server';
import { BACKEND_BASE_URL, isBackendConfigured } from '@/lib/backend/config';

/**
 * GET /api/backend-auth/challenge
 * Proxies the new backend's wallet challenge (server-to-server).
 */
export async function GET() {
    if (!isBackendConfigured()) {
        return NextResponse.json({ error: 'backend not configured' }, { status: 503 });
    }

    try {
        const res = await fetch(`${BACKEND_BASE_URL}/auth/challenge`);
        const data = await res.json();
        return NextResponse.json(data, { status: res.status });
    } catch (error) {
        console.error('backend-auth challenge proxy failed:', error);
        return NextResponse.json({ error: 'challenge request failed' }, { status: 502 });
    }
}
