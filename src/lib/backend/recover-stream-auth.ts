import { getKioskFlag } from './token-store';
import { refreshTokens, bootstrapKioskSessionShared } from './auth';
import { useUserStore } from '@/stores/useUserStore';
import { useUIStore } from '@/stores/useUIStore';

// EPIC19: SSE counterpart of the bffAuthFetch 401 ladder. EventSource can't send
// headers (token rides in ?token=), so recovery = refresh/re-bootstrap then
// reconnect with a fresh token (the caller bumps a token epoch to rebuild the URL).
// Shares the same single-flight refresh/bootstrap primitives, so a simultaneous
// API + SSE expiry collapses to one refresh and at most one kiosk-login.
//
// Returns true if the session was recovered (caller should reconnect once), false
// if unrecoverable (caller should surface a fatal error).
export async function recoverStreamAuth(): Promise<boolean> {
  if (await refreshTokens()) return true;
  if (getKioskFlag()) return !!(await bootstrapKioskSessionShared());
  // Wallet: prompt re-login; the stream can't recover on its own.
  useUserStore.getState().clearBackendAuth();
  useUIStore.getState().setWalletModalOpen(true);
  return false;
}
