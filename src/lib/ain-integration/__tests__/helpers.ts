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

/** `sub` 만 든, 서명 없는 JWT 모양(BFF 는 서명을 검증하지 않고 sub 만 읽는다). */
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
