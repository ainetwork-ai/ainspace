import {
  BackendUser,
  ChallengeResponse,
  EmailErrorBody,
  EmailRequestCodeResponse,
  RefreshResponse,
  VerifyResponse,
} from '@/types/backend';
import {
  clearSession,
  getKioskFlag,
  getRefreshToken,
  getUser,
  hasRefreshHint,
  hasSession,
  isAccessExpired,
  setEmailFlag,
  setKioskFlag,
  setSession,
  setTokens,
} from './token-store';
import { PUBLIC_BACKEND_BASE_URL, PUBLIC_BACKEND_CLIENT_ID } from './public-config';

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

// EPIC20: email auth error carrying the backend envelope fields so the modal can
// branch on them (429 cooldown via retryAfterSeconds, code attempts remaining).
export class EmailAuthError extends Error {
  constructor(
    public status: number,
    message: string,
    public reason?: string,
    public retryAfterSeconds?: number,
    public remainingAttempts?: number
  ) {
    super(message);
    this.name = 'EmailAuthError';
  }
}

// Read the backend error envelope ({ error, reason?, retryAfterSeconds?,
// remainingAttempts? }) off a failed response and throw an EmailAuthError.
async function throwEmailError(res: Response): Promise<never> {
  let body: EmailErrorBody | null = null;
  try {
    body = (await res.json()) as EmailErrorBody;
  } catch {
    // non-JSON body — fall through to a generic message
  }
  throw new EmailAuthError(
    res.status,
    body?.error || 'request failed',
    body?.reason,
    body?.retryAfterSeconds,
    body?.remainingAttempts
  );
}

/** Full login: challenge -> wallet sign -> verify. Triggers a signature prompt. */
export async function loginWithWallet({ address, signMessage }: AuthParams): Promise<BackendUser> {
  // Challenge first — if backend is unavailable this throws before any signature
  // prompt. Browser-DIRECT (EPIC26 browser-direct auth flow); credentials:'include'
  // for policy consistency (challenge itself sets no cookie).
  const challengeRes = await fetch(`${PUBLIC_BACKEND_BASE_URL}/auth/challenge`, {
    credentials: 'include',
  });
  if (!challengeRes.ok) {
    throw new BackendAuthError(challengeRes.status, 'failed to get challenge');
  }
  const challenge = (await challengeRes.json()) as ChallengeResponse;

  const signature = await signMessage(challenge.message);

  // Browser-DIRECT verify (not the BFF proxy) with credentials:'include' so the
  // browser receives the backend's httpOnly refresh cookie (Set-Cookie). clientId
  // is sent from the client now (it was injected by the BFF before). Requires the
  // origin to be in the backend EXTERNAL_ORIGIN_ALLOWLIST (else CORS 403).
  const verifyRes = await fetch(`${PUBLIC_BACKEND_BASE_URL}/auth/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signature,
      address,
      provider: 'eth',
      // ainspace logs in with Base Account (smart contract wallet) -> ERC-6492/1271
      // signature. The backend uses walletType to pick the right verification path.
      walletType: 'smart',
      challengeNonce: challenge.nonce,
      clientId: PUBLIC_BACKEND_CLIENT_ID,
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

// --- EPIC20: email (ainteams) auth ----------------------------------------
// Browser-DIRECT like loginWithWallet (NOT the BFF proxy): register/login set the
// httpOnly `rt` cookie via Set-Cookie, so the calls must be credentials:'include'
// to the backend origin for cookie-based refresh to work. clientId is sent from
// the client (PUBLIC_BACKEND_CLIENT_ID) — required for external token issuance
// + workspace auto-join; omitting it falls back to a cookie-only web UI session.

/** Persist an email session ({user, tokens}) and mark it as an email session. */
function commitEmailSession({ user, tokens }: VerifyResponse): BackendUser {
  setSession(user, tokens);
  setKioskFlag(false);
  setEmailFlag(true);
  return user;
}

/** Step 1 of signup: send a verification code to the email. */
export async function requestEmailCode(email: string): Promise<EmailRequestCodeResponse> {
  const res = await fetch(`${PUBLIC_BACKEND_BASE_URL}/auth/email/request-code`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) await throwEmailError(res);
  return (await res.json()) as EmailRequestCodeResponse;
}

/** Step 2 of signup: verify the emailed code (server stamps verifiedAt). */
export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const res = await fetch(`${PUBLIC_BACKEND_BASE_URL}/auth/email/verify-code`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  if (!res.ok) await throwEmailError(res);
}

/** Step 3 of signup: complete registration (must be within 10m of verify). */
export async function registerWithEmail(params: {
  email: string;
  password: string;
  displayName: string;
}): Promise<BackendUser> {
  const res = await fetch(`${PUBLIC_BACKEND_BASE_URL}/auth/email/register`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, clientId: PUBLIC_BACKEND_CLIENT_ID }),
  });
  if (!res.ok) await throwEmailError(res);
  return commitEmailSession((await res.json()) as VerifyResponse);
}

/** Email login (single step). */
export async function loginWithEmail(params: {
  email: string;
  password: string;
}): Promise<BackendUser> {
  const res = await fetch(`${PUBLIC_BACKEND_BASE_URL}/auth/email/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, clientId: PUBLIC_BACKEND_CLIENT_ID }),
  });
  if (!res.ok) await throwEmailError(res);
  return commitEmailSession((await res.json()) as VerifyResponse);
}

// Single-flight guard so concurrent 401s don't fire multiple refreshes
// (refresh tokens are single-use; a duplicate would 401 on reuse).
let refreshInFlight: Promise<boolean> | null = null;

/** Rotate tokens with the refresh token. No signature needed. */
export function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    // EPIC26: kiosk logs in via the BFF (server-to-server), so its httpOnly `rt`
    // cookie is set on the BFF — never the browser. The kiosk browser has nothing
    // to refresh with, so skip refresh and let re-bootstrap handle expiry.
    if (getKioskFlag()) return false;
    // Nothing stored -> never logged in -> nothing to refresh.
    if (!hasRefreshHint()) return false;
    const refreshToken = getRefreshToken();

    try {
      // Wallet: browser-DIRECT refresh with credentials:'include' so the httpOnly
      // `rt` cookie is auto-sent. Body refreshToken only as a legacy fallback when
      // we still hold one (pre-EPIC26); normally the cookie carries it.
      const res = await fetch(`${PUBLIC_BACKEND_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      });
      if (!res.ok) {
        clearSession();
        return false;
      }
      // EPIC26: refresh body returns accessToken only; the rotated rt comes via
      // Set-Cookie (rotated is undefined here, setTokens skips storing it).
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
    if (hasRefreshHint()) {
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

/**
 * EPIC26: explicit logout — revoke the backend session and clear the httpOnly
 * `rt` / `sid` cookies server-side (browser-direct, credentials:'include'), then
 * clear local state. Best-effort: local clear happens even if the call fails.
 * Idempotent on the backend. (Wallet flow only; kiosk has no disconnect.)
 */
export async function logoutBackendSession(): Promise<void> {
  try {
    await fetch(`${PUBLIC_BACKEND_BASE_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // best-effort
  }
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

  if (isAccessExpired() && hasRefreshHint()) {
    if (await refreshTokens()) return getUser();
  }

  return bootstrapKioskSession();
}
