import {
  BackendUser,
  ChallengeResponse,
  RefreshResponse,
  VerifyResponse,
} from '@/types/backend';
import {
  clearSession,
  getRefreshToken,
  getUser,
  hasSession,
  isAccessExpired,
  setSession,
  setTokens,
} from './token-store';

// Browser-side backend auth. All network calls go through the same-origin BFF
// proxy (/api/backend-auth/*); the wallet signature is the only browser-native step.

interface AuthParams {
  address: string;
  signMessage: (message: string) => Promise<string>;
}

class BackendAuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'BackendAuthError';
  }
}

/** Full login: challenge -> wallet sign -> verify. Triggers a signature prompt. */
export async function loginWithWallet({ address, signMessage }: AuthParams): Promise<BackendUser> {
  // Challenge first — if backend is unavailable this throws before any signature prompt.
  const challengeRes = await fetch('/api/backend-auth/challenge');
  if (!challengeRes.ok) {
    throw new BackendAuthError(challengeRes.status, 'failed to get challenge');
  }
  const challenge = (await challengeRes.json()) as ChallengeResponse;

  const signature = await signMessage(challenge.message);

  const verifyRes = await fetch('/api/backend-auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signature,
      address,
      provider: 'eth',
      // ainspace logs in with Base Account (smart contract wallet) -> ERC-6492/1271
      // signature. The backend uses walletType to pick the right verification path.
      walletType: 'smart',
      challengeNonce: challenge.nonce,
    }),
  });
  if (!verifyRes.ok) {
    throw new BackendAuthError(verifyRes.status, 'verify failed');
  }

  const { user, tokens } = (await verifyRes.json()) as VerifyResponse;
  setSession(user, tokens);
  return user;
}

// Single-flight guard so concurrent 401s don't fire multiple refreshes
// (refresh tokens are single-use; a duplicate would 401 on reuse).
let refreshInFlight: Promise<boolean> | null = null;

/** Rotate tokens with the refresh token. No signature needed. */
export function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;

    try {
      const res = await fetch('/api/backend-auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        clearSession();
        return false;
      }
      const { accessToken, refreshToken: rotated, expiresIn } = (await res.json()) as RefreshResponse;
      setTokens(accessToken, rotated, expiresIn);
      return true;
    } catch {
      clearSession();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Ensure a valid backend session for `address`, minimizing signature prompts:
 * - valid access token (same wallet) -> reuse (no signature, no network)
 * - expired but refresh (same wallet) -> silent refresh (no signature)
 * - no session / different wallet / refresh failed -> full login (signature prompt)
 */
export async function ensureBackendAuth(params: AuthParams): Promise<BackendUser | null> {
  const current = getUser();
  const sameWallet =
    !!current && current.ainAddress.toLowerCase() === params.address.toLowerCase();

  if (hasSession() && sameWallet) {
    if (!isAccessExpired()) return current;
    if (getRefreshToken()) {
      const ok = await refreshTokens();
      if (ok) return getUser();
    }
  }

  // Stale session belonging to a different wallet — drop it before re-login.
  if (hasSession() && !sameWallet) {
    clearSession();
  }

  return loginWithWallet(params);
}

export function logoutBackend(): void {
  clearSession();
}

// --- Kiosk (EPIC18) -------------------------------------------------------
// Exhibition kiosk: a shared, wallet-less service account. No signature step —
// the BFF holds the private key and logs in via /auth/key-login. Token storage
// (token-store) and refresh are reused unchanged.

/** Log in the shared kiosk service account via the BFF. No signature prompt. */
export async function loginAsKiosk(): Promise<BackendUser> {
  const res = await fetch('/api/backend-auth/kiosk-login', { method: 'POST' });
  if (!res.ok) {
    throw new BackendAuthError(res.status, 'kiosk login failed');
  }
  const { user, tokens } = (await res.json()) as VerifyResponse;
  setSession(user, tokens);
  return user;
}

/**
 * Ensure a valid kiosk session, mirroring ensureBackendAuth but with the
 * key-login fallback instead of a wallet signature:
 * - valid access token -> reuse (no network)
 * - expired but refresh present -> silent refresh
 * - no session / refresh failed -> key-login fallback
 */
export async function ensureKioskAuth(): Promise<BackendUser | null> {
  const expired = isAccessExpired();
  if (hasSession() && !expired) return getUser();

  if (expired && getRefreshToken()) {
    const ok = await refreshTokens();
    if (ok) return getUser();
  }

  return loginAsKiosk();
}
