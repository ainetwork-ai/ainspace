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
    console.log('[kiosk:server] POST /api/backend-auth/kiosk-login | backendConfigured =',
        isBackendConfigured(), '| kioskConfigured =', isKioskConfigured(), '| base =', BACKEND_BASE_URL);
    if (!isBackendConfigured()) {
        console.log('[kiosk:server] -> 503 backend not configured');
        return NextResponse.json({ error: 'backend not configured' }, { status: 503 });
    }
    if (!isKioskConfigured()) {
        console.log('[kiosk:server] -> 404 kiosk not enabled (BACKEND_KIOSK_PRIVATE_KEY empty)');
        return NextResponse.json({ error: 'kiosk not enabled' }, { status: 404 });
    }

    try {
        // 1) Challenge — backend issues a single-use nonce + message to sign.
        const challengeRes = await fetch(`${BACKEND_BASE_URL}/auth/challenge`);
        console.log('[kiosk:server] challenge status:', challengeRes.status);
        if (!challengeRes.ok) {
            const body = await challengeRes.text().catch(() => '');
            console.error('[kiosk:server] challenge failed body:', body.slice(0, 300));
            return NextResponse.json({ error: 'kiosk login failed' }, { status: 502 });
        }
        const { nonce, message } = (await challengeRes.json()) as {
            nonce: string;
            message: string;
        };
        console.log('[kiosk:server] challenge ok | hasNonce =', !!nonce, '| hasMessage =', !!message);

        // 2) Sign locally with the env-held key. Key stays in this process.
        const raw = BACKEND_KIOSK_PRIVATE_KEY.trim();
        const pk = (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`;
        const account = privateKeyToAccount(pk);
        const signature = await account.signMessage({ message });
        // address is a public key derivative — safe to log; signature is NOT logged.
        console.log('[kiosk:server] signed locally | address =', account.address, '| sigLen =', signature.length);

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
        console.log('[kiosk:server] verify status:', verifyRes.status,
            '| body shape:', { hasUser: !!data?.user, hasTokens: !!data?.tokens, keys: data ? Object.keys(data) : null });
        if (!verifyRes.ok) {
            console.error('[kiosk:server] verify rejected:', JSON.stringify(data).slice(0, 300));
        }
        return NextResponse.json(data, { status: verifyRes.status });
    } catch (error) {
        // Never log the key; only the error shape.
        console.error('[kiosk:server] kiosk-login threw:', error instanceof Error ? error.message : error);
        return NextResponse.json({ error: 'kiosk login failed' }, { status: 502 });
    }
}
