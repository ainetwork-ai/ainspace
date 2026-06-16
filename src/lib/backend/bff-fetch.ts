import { getAccessToken, getKioskFlag } from './token-store';
import { refreshTokens, bootstrapKioskSessionShared } from './auth';
import { useUserStore } from '@/stores/useUserStore';
import { useUIStore } from '@/stores/useUIStore';

// Browser-side fetch wrapper for same-origin BFF routes that proxy to the new
// backend. Injects the JWT access token (held in localStorage by EPIC13) as a
// Bearer header so the BFF can forward it.
//
// EPIC19: reactive 401 recovery ladder (in-place, so all callers get it for free,
// signature unchanged). On 401: refresh + retry once; if still 401, escalate by
// session type — kiosk re-bootstraps silently (single-flight + breaker), wallet
// clears the session and prompts the connect modal. Retry is capped at one per
// tier (no loops/recursion).

/** Build headers with a FRESH token each (re)try and fetch. */
async function doFetch(input: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}

export async function bffAuthFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const res = await doFetch(input, init);
  if (res.status !== 401) return res; // non-401 path is unchanged

  // Snapshot kiosk-ness BEFORE refresh — a failed refresh calls clearSession(),
  // which wipes the kiosk flag.
  const wasKiosk = getKioskFlag();

  // Tier 1: refresh (single-flight) + one retry with the rotated token.
  if (await refreshTokens()) {
    const res2 = await doFetch(input, init);
    if (res2.status !== 401) return res2;
  }

  // Tier 2: escalate by session type.
  if (wasKiosk) {
    // Silent re-login for the unattended kiosk; retry once. No further retry,
    // and never the wallet modal (a kiosk has no wallet to connect).
    if (await bootstrapKioskSessionShared()) {
      return doFetch(input, init);
    }
    return res;
  }

  // Wallet: can't silently re-auth — clear and prompt re-login. Surface the
  // original 401 to the caller (which already branches on response.ok).
  useUserStore.getState().clearBackendAuth();
  useUIStore.getState().setWalletModalOpen(true);
  return res;
}
