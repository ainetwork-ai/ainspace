/**
 * `/api/ain/*` 의 제품 세션 검증 — 서버 전용.
 *
 * 다른 BFF 라우트는 브라우저의 backend JWT 를 backend 로 그대로 전달하므로 backend 가 서명을 검사한다.
 * `/api/ain/*` 는 토큰을 backend 로 보내지 않고 `sub` 만 쓰기 때문에, 여기서 **직접** 검증해야 한다.
 * 검증하지 않으면 `h.e30.s` 같은 위조 JWT 로 아무 사용자의 aindrive 토큰·AIN SSO ID 토큰(Redis)을 골라
 * 위임을 발급받을 수 있다. 두 방식 중 설정된 것을 쓰고, 둘 다 없으면 **거절**한다(열어 두지 않는다).
 *
 *   1) `BACKEND_JWT_SIGNING_KEY` — backend(ainteams/backend `JWT_SIGNING_KEY`)와 같은 HS256 키. 로컬에서
 *      서명·만료·issuer(`a2a-backend`)·audience(`client-access`)·`sub` 를 검사한다. 네트워크 없음.
 *   2) `BACKEND_BASE_URL` — backend `GET /auth/me` 에 토큰을 그대로 전달해 introspection 한다(다른 BFF
 *      라우트와 같은 전달). 200 이면 응답의 `user.id` 가 검증된 사용자다. 401/403 → 세션 없음.
 *      그 밖의 실패(네트워크·5xx)는 `temporary_failure` — 세션이 없다고 단정하지 않는다.
 *
 * bearer 는 **Authorization 헤더에서만** 읽는다(`?token=` 은 URL·접근 로그에 남으므로 이 라우트군에서는 받지 않는다).
 * 토큰 값은 로그·응답·오류 메시지에 절대 싣지 않는다.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { AinContractError } from './types';

export interface AppSession { userId: string }

export interface VerifyAppSessionOptions {
  fetch?: typeof fetch;
  now?: () => Date;
}

/** backend `token.ts` 의 상수. env 로 덮어쓸 수 있다(다른 backend 를 붙일 때). */
const DEFAULT_ISSUER = 'a2a-backend';
const DEFAULT_AUDIENCE = 'client-access';
/** 시계 차이 허용(초). */
const CLOCK_SKEW_SEC = 30;
const INTROSPECT_TIMEOUT_MS = 5_000;

export const getBackendJwtSigningKey = (): string | null => {
  const v = process.env.BACKEND_JWT_SIGNING_KEY?.trim();
  return v && v.length >= 32 ? v : null;
};
const getIssuer = () => process.env.BACKEND_JWT_ISSUER?.trim() || DEFAULT_ISSUER;
const getAudience = () => process.env.BACKEND_JWT_AUDIENCE?.trim() || DEFAULT_AUDIENCE;
const getBackendBaseUrl = () => (process.env.BACKEND_BASE_URL ?? '').trim().replace(/\/+$/, '');

/** `Authorization: Bearer <token>` 만. 쿼리(`?token=`)는 보지 않는다. */
export function readBearerHeader(request: Pick<NextRequest, 'headers'>): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim();
  return token ? token : null;
}

const b64url = (s: string) => { try { return Buffer.from(s, 'base64url'); } catch { return null; } };
const parseJson = (b: Buffer | null): Record<string, unknown> | null => {
  if (!b) return null;
  try { const v = JSON.parse(b.toString('utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null; } catch { return null; }
};

/**
 * HS256 JWT 를 공유 키로 검증한다. 실패 이유는 돌려주지 않는다(모두 "세션 없음").
 * `alg` 는 반드시 HS256 — `none`·비대칭 alg 를 HMAC 키로 받는 혼동을 막는다.
 */
export function verifyHs256Session(token: string, key: string, opts: { issuer?: string; audience?: string; now?: () => Date } = {}): AppSession | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
  const header = parseJson(b64url(parts[0]));
  if (!header || header.alg !== 'HS256') return null;
  const expected = createHmac('sha256', key).update(`${parts[0]}.${parts[1]}`).digest();
  const given = b64url(parts[2]);
  if (!given || given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const payload = parseJson(b64url(parts[1]));
  if (!payload) return null;
  const nowSec = Math.floor((opts.now ?? (() => new Date()))().getTime() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SEC <= nowSec) return null;
  if (typeof payload.nbf === 'number' && payload.nbf - CLOCK_SKEW_SEC > nowSec) return null;
  if (payload.iss !== (opts.issuer ?? DEFAULT_ISSUER)) return null;
  const aud = opts.audience ?? DEFAULT_AUDIENCE;
  const audOk = typeof payload.aud === 'string' ? payload.aud === aud : Array.isArray(payload.aud) && payload.aud.includes(aud);
  if (!audOk) return null;
  if (typeof payload.sub !== 'string' || !payload.sub) return null;
  return { userId: payload.sub };
}

/** backend `GET /auth/me` introspection. 토큰은 Authorization 헤더로만 나간다. */
export async function introspectSession(token: string, baseUrl: string, opts: VerifyAppSessionOptions = {}): Promise<AppSession | null> {
  const f = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(INTROSPECT_TIMEOUT_MS),
    });
  } catch (e) {
    console.error('app session introspection failed:', e instanceof Error ? e.message : 'unknown');
    throw new AinContractError('temporary_failure', '세션을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.', { status: 503, retryable: true, detail: 'app_session_verifier_unavailable' });
  }
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) {
    console.error(`app session introspection returned ${res.status}`);
    throw new AinContractError('temporary_failure', '세션을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.', { status: 503, retryable: true, detail: 'app_session_verifier_unavailable' });
  }
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  const id = (body as { user?: { id?: unknown } } | null)?.user?.id;
  if (typeof id !== 'string' || !id) return null;
  return { userId: id };
}

/**
 * 제품 세션을 검증해 사용자 id 를 돌려준다. null = 세션 없음(401). 검증기가 설정되어 있지 않거나 닿지 않으면
 * `AinContractError(temporary_failure)` 를 던진다 — 어느 경우에도 검증 없이 `sub` 를 믿지 않는다.
 */
export async function verifyAppSession(token: string, opts: VerifyAppSessionOptions = {}): Promise<AppSession | null> {
  const key = getBackendJwtSigningKey();
  if (key) return verifyHs256Session(token, key, { issuer: getIssuer(), audience: getAudience(), now: opts.now });
  const baseUrl = getBackendBaseUrl();
  if (baseUrl) return introspectSession(token, baseUrl, opts);
  throw new AinContractError('temporary_failure', '이 배포에는 세션 검증이 설정되어 있지 않습니다(BACKEND_JWT_SIGNING_KEY 또는 BACKEND_BASE_URL).', { status: 503, retryable: false, detail: 'app_session_verifier_missing' });
}
