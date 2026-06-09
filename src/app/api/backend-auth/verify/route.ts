import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_BASE_URL, BACKEND_CLIENT_ID, isBackendConfigured } from '@/lib/backend/config';

/**
 * POST /api/backend-auth/verify
 * Forwards the signed challenge to the backend, injecting clientId server-side.
 * Body: { signature, address, provider, challengeNonce }
 */
export async function POST(request: NextRequest) {
    if (!isBackendConfigured()) {
        return NextResponse.json({ error: 'backend not configured' }, { status: 503 });
    }

    try {
        const { signature, address, provider, walletType, challengeNonce } = await request.json();

        const res = await fetch(`${BACKEND_BASE_URL}/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                signature,
                address,
                provider,
                walletType,
                challengeNonce,
                clientId: BACKEND_CLIENT_ID,
            }),
        });

        const data = await res.json();
        return NextResponse.json(data, { status: res.status });
    } catch (error) {
        console.error('backend-auth verify proxy failed:', error);
        return NextResponse.json({ error: 'verify request failed' }, { status: 502 });
    }
}
