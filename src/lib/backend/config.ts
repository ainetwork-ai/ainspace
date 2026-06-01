// Server-only config for the new NestJS backend.
// The BFF (Next.js API routes) calls the backend server-to-server; the browser
// never talks to the backend directly, so these are NOT NEXT_PUBLIC vars.
export const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL ?? '';
export const BACKEND_CLIENT_ID = process.env.BACKEND_CLIENT_ID ?? 'ainspace';

export const isBackendConfigured = (): boolean => BACKEND_BASE_URL.trim().length > 0;
