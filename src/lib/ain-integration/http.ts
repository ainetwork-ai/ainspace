/**
 * 어댑터 공용 HTTP 도우미 — 순수 함수 + fetch 주입 (어댑터 사양 §제품에 넣을 것 1).
 * reference-client/src/http.ts 와 같은 규칙으로 원본의 계약 오류·HTTP 실패를 `AinContractError` 로 옮긴다.
 */
import { AinContractError, isErrorBody, type ErrorCode } from './types';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function getJson<T>(f: FetchLike, url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await f(url, { headers: { accept: 'application/json', ...headers }, cache: 'no-store' });
  if (res.ok) return (await res.json()) as T;
  let body: unknown = null;
  try { body = await res.json(); } catch { /* not json */ }
  if (isErrorBody(body)) {
    const { code, message, retryable, actionUrl, detail } = body.error;
    throw new AinContractError(code, message, { status: res.status, retryable, actionUrl, detail });
  }
  const code: ErrorCode =
    res.status === 401 ? 'auth_required'
    : res.status === 403 ? 'forbidden'
    : res.status === 404 ? 'resource_deleted'
    : res.status === 429 ? 'rate_limited'
    : 'temporary_failure';
  // URL 은 상태 파악용으로만 남기고 쿼리는 뗀다(쿼리에 무엇이 실렸든 메시지로 새지 않게).
  throw new AinContractError(code, `${res.status} from ${url.split('?')[0]}`, { status: res.status, retryable: res.status >= 500 || res.status === 429 });
}

export const qs = (o: Record<string, string | number | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** 원본 404 = "그 네이티브 라우트가 아직 없다" → fallback 신호. */
export const isNotFound = (e: unknown): boolean => e instanceof AinContractError && e.status === 404;

// 응답에 실리면 안 되는 키. 어댑터는 typed 로 조립하므로 보통 걸리지 않지만, 원본이
// 계약 모양으로 응답하는 네이티브 경로는 그대로 전달하므로 마지막 방어선으로 한 번 더 거른다.
const SECRET_KEY_RE = /token|authorization|cookie|secret|password|credential/i;

/** 비밀로 보이는 키를 깊은 복사하며 제거한다. 배열·원시값은 그대로. */
export function stripSecretKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripSecretKeys(v)) as unknown as T;
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) continue;
    out[k] = stripSecretKeys(v);
  }
  return out as T;
}

/** 테스트·검증용: 어딘가에 비밀로 보이는 키가 있으면 그 경로를 돌려준다. */
export function findSecretKey(value: unknown, path = '$'): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) { const p = findSecretKey(value[i], `${path}[${i}]`); if (p) return p; }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) return `${path}.${k}`;
    const p = findSecretKey(v, `${path}.${k}`);
    if (p) return p;
  }
  return null;
}

/** base64url 오프셋 커서 — fallback 목록의 페이지네이션 (reference client 와 동일). */
export const decodeOffsetCursor = (cursor: string | undefined): number =>
  cursor ? Number(Buffer.from(cursor, 'base64url').toString()) || 0 : 0;
export const encodeOffsetCursor = (offset: number): string => Buffer.from(String(offset)).toString('base64url');

export function paginate<T>(all: T[], cursor: string | undefined, limit: number): { page: T[]; nextCursor: string | null } {
  const start = decodeOffsetCursor(cursor);
  const page = all.slice(start, start + limit);
  const nextCursor = start + limit < all.length ? encodeOffsetCursor(start + limit) : null;
  return { page, nextCursor };
}

/**
 * 네이티브 라우트 존재 여부를 issuer 별로 잠시 기억한다(매 요청 404 한 번을 아낀다).
 * TTL 을 두는 이유: 원본이 나중에 네이티브 라우트를 열면 재시작 없이 따라가게.
 */
const NATIVE_TTL_MS = 10 * 60 * 1000;
const nativeSupport = new Map<string, { value: boolean; at: number }>();
export function getNativeSupport(key: string, now = Date.now()): boolean | null {
  const hit = nativeSupport.get(key);
  if (!hit || now - hit.at > NATIVE_TTL_MS) return null;
  return hit.value;
}
export function setNativeSupport(key: string, value: boolean, now = Date.now()): void {
  nativeSupport.set(key, { value, at: now });
}
export function resetNativeSupport(): void { nativeSupport.clear(); }
