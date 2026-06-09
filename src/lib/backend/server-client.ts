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

export function backendFetch(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${BACKEND_BASE_URL}${path}`, { ...init, headers });
}
