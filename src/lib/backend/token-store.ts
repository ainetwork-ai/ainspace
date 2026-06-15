import { BackendTokens, BackendUser } from '@/types/backend';

// Single source of truth for the browser-held backend JWT (architecture C).
const ACCESS_TOKEN_KEY = 'ainspace-backend-access-token';
const REFRESH_TOKEN_KEY = 'ainspace-backend-refresh-token';
const EXPIRES_AT_KEY = 'ainspace-backend-expires-at';
const USER_KEY = 'ainspace-backend-user';
// EPIC18: marks the current session as a kiosk (wallet-less, server-bootstrapped)
// session. Server-originated — set only after a successful kiosk bootstrap, tied
// to the token lifecycle. Read to keep the kiosk session alive despite the wallet
// being absent, and to drive Ctrl+K forceNew.
const KIOSK_KEY = 'ainspace-backend-kiosk';

const isBrowser = (): boolean => typeof window !== 'undefined';

export function getAccessToken(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getExpiresAt(): number | null {
  if (!isBrowser()) return null;
  const raw = localStorage.getItem(EXPIRES_AT_KEY);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function getUser(): BackendUser | null {
  if (!isBrowser()) return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BackendUser;
  } catch {
    return null;
  }
}

export function setSession(user: BackendUser, tokens: BackendTokens): void {
  if (!isBrowser()) return;
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  localStorage.setItem(EXPIRES_AT_KEY, String(Date.now() + tokens.expiresIn * 1000));
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function setTokens(accessToken: string, refreshToken: string, expiresIn: number): void {
  if (!isBrowser()) return;
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  localStorage.setItem(EXPIRES_AT_KEY, String(Date.now() + expiresIn * 1000));
}

export function clearSession(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(EXPIRES_AT_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(KIOSK_KEY);
}

export function setKioskFlag(on: boolean): void {
  if (!isBrowser()) return;
  if (on) localStorage.setItem(KIOSK_KEY, '1');
  else localStorage.removeItem(KIOSK_KEY);
}

export function getKioskFlag(): boolean {
  if (!isBrowser()) return false;
  return localStorage.getItem(KIOSK_KEY) === '1';
}

export function hasSession(): boolean {
  return !!getAccessToken();
}

export function isAccessExpired(skewMs = 30000): boolean {
  const expiresAt = getExpiresAt();
  if (expiresAt === null) return true;
  return Date.now() >= expiresAt - skewMs;
}
