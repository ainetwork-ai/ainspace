// Server-only config for the new NestJS backend.
// The BFF (Next.js API routes) calls the backend server-to-server; the browser
// never talks to the backend directly, so these are NOT NEXT_PUBLIC vars.
export const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL ?? '';
export const BACKEND_CLIENT_ID = process.env.BACKEND_CLIENT_ID ?? 'ainspace';
// ainspace is bound to a single backend workspace. The workspaceId is held here
// (like BACKEND_CLIENT_ID) and injected by the BFF into backend calls, instead of
// being read from the JWT — the token's workspaceId claim is unreliable (e.g. lost
// on refresh). No default: it MUST be set explicitly or backend calls fail fast.
export const BACKEND_WORKSPACE_ID = process.env.BACKEND_WORKSPACE_ID ?? '';

// EPIC18: shared service-account private key (a plain EOA) for the exhibition
// kiosk. Server-only (NOT NEXT_PUBLIC) — the browser never sees it, and it is
// never transmitted: the BFF uses it ONLY to sign the auth challenge locally
// (challenge -> sign -> verify), sending just the signature. Set ONLY on the
// kiosk Vercel project, so its mere presence gates kiosk mode (public web empty).
export const BACKEND_KIOSK_PRIVATE_KEY = process.env.BACKEND_KIOSK_PRIVATE_KEY ?? '';

export const isBackendConfigured = (): boolean => BACKEND_BASE_URL.trim().length > 0;
export const isBackendWorkspaceConfigured = (): boolean =>
  BACKEND_WORKSPACE_ID.trim().length > 0;
export const isKioskConfigured = (): boolean =>
  BACKEND_KIOSK_PRIVATE_KEY.trim().length > 0;
