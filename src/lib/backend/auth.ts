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
  setKioskFlag,
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
  // EPIC18: a wallet login is never a kiosk session — clear any stale kiosk flag
  // (e.g. left on a device that was previously a kiosk) so the wallet user isn't
  // mistaken for kiosk on the next hydrate (which would hide their own threads).
  setKioskFlag(false);
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
// Exhibition kiosk: a shared, wallet-less service account. Kiosk-ness is decided
// by the BFF (it holds the private key): /api/backend-auth/kiosk-login signs the
// challenge server-side and returns a session, or 404 when no key is configured.
// The client is kiosk-agnostic — it just tries to bootstrap; a 404 means "not a
// kiosk deployment" and is a no-op. Token storage/refresh are reused unchanged.

/**
 * Try to bootstrap a kiosk session via the BFF.
 * - 200 -> store the session, mark it kiosk, return the user.
 * - 404 -> not a kiosk deployment (public web) -> null, no-op.
 * - other -> non-blocking failure (e.g. backend rejected EOA) -> null + log.
 */
export async function bootstrapKioskSession(): Promise<BackendUser | null> {
  const res = await fetch('/api/backend-auth/kiosk-login', { method: 'POST' });
  console.log('[kiosk] bootstrap status:', res.status);
  if (res.status === 404) return null; // not a kiosk deployment
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[kiosk] bootstrap failed:', res.status, body.slice(0, 300));
    return null;
  }
  const { user, tokens } = (await res.json()) as VerifyResponse;
  console.log('[kiosk] bootstrap ok | hasUser =', !!user, '| userId =', user?.id);
  setSession(user, tokens);
  setKioskFlag(true);
  return user;
}

// EPIC19: shared single-flight + circuit breaker for kiosk re-bootstrap, used by
// the reactive 401 recovery in both the API (bffAuthFetch) and SSE paths. Collapses
// concurrent recoveries into one /kiosk-login and bounds churn when the backend is
// down (so an unattended kiosk doesn't retry-storm).
let bootstrapInFlight: Promise<BackendUser | null> | null = null;
let bootstrapBlockedUntil = 0;
const BOOTSTRAP_COOLDOWN_MS = 30000;

export function bootstrapKioskSessionShared(): Promise<BackendUser | null> {
  if (Date.now() < bootstrapBlockedUntil) return Promise.resolve(null);
  if (bootstrapInFlight) return bootstrapInFlight;

  bootstrapInFlight = (async () => {
    const user = await bootstrapKioskSession();
    if (!user) bootstrapBlockedUntil = Date.now() + BOOTSTRAP_COOLDOWN_MS;
    return user;
  })().finally(() => {
    bootstrapInFlight = null;
  });

  return bootstrapInFlight;
}

/**
 * Mount-time session resolution shared by kiosk and public builds:
 * - valid stored session -> reuse (no network)
 * - expired but refreshable -> silent refresh (works for wallet or kiosk session)
 * - otherwise -> try a kiosk bootstrap (null/no-op on public web)
 */
export async function ensureKioskSession(): Promise<BackendUser | null> {
  if (hasSession() && !isAccessExpired()) return getUser();

  if (isAccessExpired() && getRefreshToken()) {
    if (await refreshTokens()) return getUser();
  }

  return bootstrapKioskSession();
}
