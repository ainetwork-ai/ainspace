/**
 * `/api/ain/*` 라우트 공용 — 플래그·세션 가드, 쿼리 파싱, 계약 오류 응답.
 *
 * 세션: 다른 BFF 라우트와 같이 브라우저가 든 backend JWT(`getBearer`)로 보호한다. 토큰은
 * 원본(aindrive/Ainize)으로 전달하지 않고 호출자 식별(`sub`)에만 쓴다.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getBearer } from '@/lib/backend/server-client';
import { isAinIntegrationEnabled } from './config';
import { stripSecretKeys } from './http';
import {
  HTTP_STATUS_FOR, LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, makeError, toErrorBody,
  type ErrorBody,
} from './types';

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export function errorResponse(body: ErrorBody, status = HTTP_STATUS_FOR[body.error.code]): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function okResponse<T>(body: T): NextResponse {
  return NextResponse.json(stripSecretKeys(body), { headers: NO_STORE });
}

/**
 * 플래그 off → 404 (라우트가 "없는" 것처럼). 세션 없음 → 401 `auth_required`.
 * 통과하면 bearer 를 돌려준다.
 */
export function guardAinRoute(request: NextRequest): { bearer: string } | NextResponse {
  if (!isAinIntegrationEnabled()) {
    return errorResponse(makeError('temporary_failure', 'AIN 통합이 이 배포에서 꺼져 있습니다.', { retryable: false, detail: 'ain_integration_disabled' }), 404);
  }
  const bearer = getBearer(request);
  if (!bearer) {
    return errorResponse(makeError('auth_required', '로그인이 필요합니다.'));
  }
  return { bearer };
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

export const failureResponse = (e: unknown): NextResponse => {
  const body = toErrorBody(e);
  if (body.error.code === 'temporary_failure') {
    // 원본 호출 실패의 원인은 서버 로그에만 남긴다(메시지에 토큰·URL 쿼리가 실릴 수 있는 종류라 응답에는 일반 문구).
    console.error('AIN integration upstream failure:', e instanceof Error ? e.message : e);
  }
  return errorResponse(body);
};
