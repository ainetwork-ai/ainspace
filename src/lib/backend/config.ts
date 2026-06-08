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

export const isBackendConfigured = (): boolean => BACKEND_BASE_URL.trim().length > 0;
export const isBackendWorkspaceConfigured = (): boolean =>
  BACKEND_WORKSPACE_ID.trim().length > 0;
