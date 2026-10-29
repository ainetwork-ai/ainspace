import type { NextRequest } from 'next/server';
import { BACKEND_BASE_URL } from './config';

// Server-only helpers for BFF routes that proxy to the new backend.
// Architecture C: browser holds the JWT and sends it to same-origin BFF routes
// via Authorization header (fetch) or `?token=` query (EventSource for SSE).
// This module extracts that token and forwards authenticated requests to the
// backend server-to-server. (workspaceId is no longer read from the token — the
// BFF injects BACKEND_WORKSPACE_ID from config instead.)

export function getBearer(req: NextRequest): string | null {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (header) {
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const tokenParam = req.nextUrl.searchParams.get('token');
  if (tokenParam) return tokenParam;
  return null;
}

// EPIC16: decode the caller's backend user id (`sub`) from the JWT payload.
// No signature check — the backend re-verifies the Bearer; the BFF only reads
// the claim to scope the agent roster to the caller's owned agents.
// NOT for routes that do not forward the Bearer to the backend: /api/ain/* verifies
// the session itself (lib/ain-integration/app-session.ts) and never trusts this claim.
export function decodeUserId(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    return (JSON.parse(json) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}

/** The backend could not be reached at all — the request never left (see backendFetch). */
export class BackendUnreachableError extends Error {
  constructor(cause: unknown) {
    super('backend unreachable', { cause });
    this.name = 'BackendUnreachableError';
  }
}

// Failures before a connection exists: nothing was sent, so even a POST can be tried again.
const CONNECT_FAILURES = new Set(['ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);
const connectFailure = (error: unknown) =>
  error instanceof TypeError && CONNECT_FAILURES.has(String((error.cause as { code?: unknown } | undefined)?.code));

/**
 * Forwards to the backend. A connection that could not be made is retried briefly: on 2026-10-29 a short
 * on-prem network blip dropped a chat send before it reached the backend ("fetch failed"). Failures after
 * the request may have left (reset, timeout) are never replayed.
 */
export async function backendFetch(
  token: string,
  path: string,
  init: RequestInit = {},
  { delays = [400, 1200] }: { delays?: number[] } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(`${BACKEND_BASE_URL}${path}`, { ...init, headers });
    } catch (error) {
      if (!connectFailure(error) || init.signal?.aborted) throw error;
      if (attempt >= delays.length) throw new BackendUnreachableError(error);
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    }
  }
}
