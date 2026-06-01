import { getAccessToken } from './token-store';

// Browser-side fetch wrapper for same-origin BFF routes that proxy to the new
// backend. Injects the JWT access token (held in localStorage by EPIC13) as a
// Bearer header so the BFF can forward it. Same-origin call, no CORS concern.
//
// Note: 401 → refresh → retry is intentionally NOT handled here for EPIC14.
// EventSource cannot send headers (the SSE proxy uses ?token=), and a
// dedicated refresh-and-retry wrapper will be added with the resource-call
// client in a follow-up EPIC.
export async function bffAuthFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
