import { NextResponse } from 'next/server';
import { privateKeyToAccount } from 'viem/accounts';
import {
    BACKEND_BASE_URL,
    BACKEND_CLIENT_ID,
    BACKEND_KIOSK_PRIVATE_KEY,
    isBackendConfigured,
    isKioskConfigured,
} from '@/lib/backend/config';

/**
 * POST /api/backend-auth/kiosk-login
 * EPIC18: log in the shared kiosk service account (a plain EOA) without a wallet
 * UI. Runs the same challenge -> sign -> verify flow as a browser wallet, but the
 * signature is produced server-side from the env-held key. The private key is used
 * ONLY for local signing — it is never transmitted (no /auth/key-login, no key in
 * any request body, response, or log). Only the signature crosses to the backend.
 *
 * Returns 404 when the kiosk key is not configured. This 404 is the single
 * source of truth for kiosk mode: the client bootstraps unconditionally and
 * treats 404 as "not a kiosk deployment" (public web), 200 as a kiosk session.
 */
export async function POST() {
    if (!isBackendConfigured()) {
        return NextResponse.json({ error: 'backend not configured' }, { status: 503 });
    }
    if (!isKioskConfigured()) {
        return NextResponse.json({ error: 'kiosk not enabled' }, { status: 404 });
    }

    try {
        // 1) Challenge — backend issues a single-use nonce + message to sign.
        const challengeRes = await fetch(`${BACKEND_BASE_URL}/auth/challenge`);
        if (!challengeRes.ok) {
            return NextResponse.json({ error: 'kiosk login failed' }, { status: 502 });
        }
        const { nonce, message } = (await challengeRes.json()) as {
            nonce: string;
            message: string;
        };

        // 2) Sign locally with the env-held key. Key stays in this process.
        const raw = BACKEND_KIOSK_PRIVATE_KEY.trim();
        const pk = (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`;
        const account = privateKeyToAccount(pk);
        const signature = await account.signMessage({ message });

        // 3) Verify — send only the signature. Plain EOA: provider 'eth', no
        //    walletType (the 'smart'/ERC-1271 path is for browser Base Accounts).
        const verifyRes = await fetch(`${BACKEND_BASE_URL}/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                signature,
                address: account.address,
                provider: 'eth',
                challengeNonce: nonce,
                clientId: BACKEND_CLIENT_ID,
            }),
        });

        const data = await verifyRes.json();
        return NextResponse.json(data, { status: verifyRes.status });
    } catch (error) {
        // Never log the key; only the error shape.
        console.error('kiosk-login failed:', error instanceof Error ? error.message : error);
        return NextResponse.json({ error: 'kiosk login failed' }, { status: 502 });
    }
}
