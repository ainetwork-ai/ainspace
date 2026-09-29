/**
 * `/api/ain/*` 라우트 공용 — 플래그·세션 가드, 쿼리 파싱, 계약 오류 응답.
 *
 * 세션: 브라우저가 든 backend JWT 를 **여기서 검증**한다(`app-session.ts`: 공유 키 HS256 또는 backend
 * `/auth/me` introspection). 이 라우트군은 토큰을 원본(aindrive/Ainize/SSO)으로 전달하지 않고 검증된
 * `sub` 만 호출자 식별에 쓴다. bearer 는 Authorization 헤더에서만 읽는다(`?token=` 불가).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { readBearerHeader, verifyAppSession, type AppSession } from './app-session';
import { isAinIntegrationEnabled } from './config';
import { stripSecretKeys } from './http';
import { HTTP_STATUS_FOR, LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, makeError, toErrorBody, type ErrorBody } from './types';

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export function errorResponse(body: ErrorBody, status = HTTP_STATUS_FOR[body.error.code]): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function okResponse<T>(body: T): NextResponse {
  return NextResponse.json(stripSecretKeys(body), { headers: NO_STORE });
}

/**
 * 플래그 off → 404 (라우트가 "없는" 것처럼). 세션 없음·위조·만료 → 401 `auth_required`.
 * 검증기가 설정되어 있지 않거나 닿지 않으면 503 `temporary_failure`(세션이 없다고 단정하지 않는다).
 * 통과하면 검증된 사용자 id 를 돌려준다 — 서명 없는 `sub` 는 절대 쓰지 않는다.
 */
export async function guardAinRoute(request: NextRequest): Promise<AppSession | NextResponse> {
  if (!isAinIntegrationEnabled()) {
    return errorResponse(makeError('temporary_failure', 'AIN 통합이 이 배포에서 꺼져 있습니다.', { retryable: false, detail: 'ain_integration_disabled' }), 404);
  }
  const bearer = readBearerHeader(request);
  if (!bearer) {
    return errorResponse(makeError('auth_required', '로그인이 필요합니다.'));
  }
  let session: AppSession | null;
  try {
    session = await verifyAppSession(bearer);
  } catch (e) {
    return failureResponse(e);
  }
  if (!session) {
    return errorResponse(makeError('auth_required', '세션이 유효하지 않습니다. 다시 로그인해 주세요.'));
  }
  return session;
}

export interface ParsedListQuery<S extends string> { scope: S; q?: string; cursor?: string; limit: number; org?: string; folder?: string }

/** 계약 list request 규칙: scope 는 enum, limit 1..200(기본 50), q ≤ 200. 위반은 `unsupported_input` 400. */
export function parseListQuery<S extends string>(params: URLSearchParams, scopes: readonly S[], defaultScope: S): ParsedListQuery<S> | NextResponse {
  const scopeRaw = params.get('scope') ?? defaultScope;
  if (!(scopes as readonly string[]).includes(scopeRaw)) {
    return errorResponse(makeError('unsupported_input', `scope 는 ${scopes.join('|')} 중 하나여야 합니다.`), 400);
  }
  const limitRaw = params.get('limit');
  let limit = LIST_LIMIT_DEFAULT;
  if (limitRaw !== null && limitRaw !== '') {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > LIST_LIMIT_MAX) {
      return errorResponse(makeError('unsupported_input', `limit 은 1..${LIST_LIMIT_MAX} 정수여야 합니다.`), 400);
    }
  }
  const q = params.get('q') ?? undefined;
  if (q !== undefined && q.length > 200) return errorResponse(makeError('unsupported_input', 'q 는 200자 이하여야 합니다.'), 400);
  const cursor = params.get('cursor') ?? undefined;
  const org = params.get('org') ?? undefined;
  const folder = params.get('folder') ?? undefined;
  return { scope: scopeRaw as S, ...(q ? { q } : {}), ...(cursor ? { cursor } : {}), limit, ...(org ? { org } : {}), ...(folder ? { folder } : {}) };
}

/** 어댑터 오류 → 계약 바디. HTTP status 는 바디의 code 표(HTTP_STATUS_FOR)에서만 온다 — 원본의 status 를 되비추지 않는다. */
export const failureResponse = (e: unknown): NextResponse => {
  const body = toErrorBody(e);
  if (body.error.code === 'temporary_failure') {
    // 원본 호출 실패의 원인은 서버 로그에만 남긴다(메시지에 토큰·URL 쿼리가 실릴 수 있는 종류라 응답에는 일반 문구).
    console.error('AIN integration upstream failure:', e instanceof Error ? e.message : e);
  }
  return errorResponse(body);
};
