import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** 경로별 응답을 정해 두는 가짜 fetch. 호출 URL 을 기록해 토큰이 헤더로만 갔는지도 검증할 수 있다. */
export function fakeFetch(routes: Record<string, (url: URL, init?: RequestInit) => Response | Promise<Response>>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input, init });
    const url = new URL(input);
    const handler = routes[url.pathname];
    if (!handler) return jsonResponse({ error: 'not found' }, 404);
    return handler(url, init);
  };
  return Object.assign(f, { calls });
}

/** 테스트용 공유 서명 키(backend `JWT_SIGNING_KEY` 역할). 32자 이상. */
export const TEST_SIGNING_KEY = 'test-signing-key-0123456789abcdef-0123456789abcdef';
/** 라우트 테스트의 세션 검증 env — 라우트가 이 키로 HS256 서명을 검사한다. */
export const SESSION_ENV = { BACKEND_JWT_SIGNING_KEY: TEST_SIGNING_KEY, BACKEND_BASE_URL: undefined, BACKEND_JWT_ISSUER: undefined, BACKEND_JWT_AUDIENCE: undefined };

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** backend 가 발급하는 모양의 access JWT(HS256, iss a2a-backend, aud client-access). 검증 통과용. */
export function signedJwt(sub: string, over: { key?: string; alg?: string; iss?: string; aud?: string | string[]; exp?: number; nbf?: number; sub?: string | null } = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: over.alg ?? 'HS256', typ: 'JWT' }));
  const claims: Record<string, unknown> = { iss: over.iss ?? 'a2a-backend', aud: over.aud ?? 'client-access', iat: now, exp: over.exp ?? now + 3600, scope: ['user'], sessionId: 'sess_1', jti: 'jti_1', sub };
  if (over.nbf !== undefined) claims.nbf = over.nbf;
  if (over.sub === null) delete claims.sub;
  const payload = b64url(JSON.stringify(claims));
  const sig = b64url(createHmac('sha256', over.key ?? TEST_SIGNING_KEY).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

/** `sub` 만 든, 서명 없는 JWT 모양 — 위조 토큰. 라우트는 이것을 거절해야 한다. */
export const fakeJwt = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;

export const makeRequest = (path: string, bearer?: string) =>
  new NextRequest(`http://localhost${path}`, { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });

/** env 를 바꾸고 원복하는 헬퍼. */
export function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  return async () => {
    const prev: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { await fn(); } finally {
      for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };
}
