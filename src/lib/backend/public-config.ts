// Client-readable backend config for BROWSER-DIRECT auth (verify/refresh).
// NEXT_PUBLIC so it's inlined into the browser bundle. Both values are non-secret
// (a public API origin + the non-secret client id). The private key and the
// server-only base URL stay in config.ts and never reach the browser.
//
// Browser-direct auth is required for the backend's cookie-based refresh: the
// httpOnly refresh cookie is scoped to the backend origin, so the browser must
// call the backend itself (with credentials:'include') to receive/send it — a
// same-origin BFF proxy can't carry a backend-domain cookie.
export const PUBLIC_BACKEND_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? '';
export const PUBLIC_BACKEND_CLIENT_ID = process.env.NEXT_PUBLIC_BACKEND_CLIENT_ID ?? 'ainspace';
