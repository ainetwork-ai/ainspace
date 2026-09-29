import { NextRequest } from 'next/server';
import { decodeUserId } from '@/lib/backend/server-client';
import { getAindriveConnectUrl, getAindriveUrl, getAinizeUrl } from '@/lib/ain-integration/config';
import { eventsDeps as deps } from '@/lib/ain-integration/deps';
import { errorResponse, failureResponse, guardAinRoute, okResponse } from '@/lib/ain-integration/route';
import { EVENT_SOURCES, makeError, type EventSource } from '@/lib/ain-integration/types';

export const runtime = 'nodejs';

/**
 * GET /api/ain/events?source=aindrive|ainize&cursor=
 *   → 계약 event-page 그대로 (adapter-invoke-spec §GET /api/ain/events)
 *
 * 앱 세션으로 보호한다. aindrive 피드는 사용자의 aindrive 계정 토큰으로(없으면 `auth_required` + actionUrl),
 * Ainize 피드는 익명으로 부른다. 소비자(클라이언트 캐시)는 `reduceEventPage` 로 적용한다.
 */
export async function GET(request: NextRequest) {
  const guard = guardAinRoute(request);
  if (!('bearer' in guard)) return guard;

  const params = request.nextUrl.searchParams;
  const source = params.get('source') ?? '';
  if (!(EVENT_SOURCES as readonly string[]).includes(source)) {
    return errorResponse(makeError('unsupported_input', `source 는 ${EVENT_SOURCES.join('|')} 중 하나여야 합니다.`), 400);
  }
  const cursor = params.get('cursor') ?? undefined;
  if (cursor !== undefined && (cursor.length === 0 || cursor.length > 4096)) {
    return errorResponse(makeError('unsupported_input', 'cursor 가 올바르지 않습니다.'), 400);
  }

  try {
    if (source === 'aindrive') {
      const token = await deps.getAindriveAccountToken(decodeUserId(guard.bearer));
      const page = await deps.fetchEvents({ source: 'aindrive', baseUrl: getAindriveUrl(), token, connectUrl: getAindriveConnectUrl() }, cursor);
      return okResponse(page);
    }
    const page = await deps.fetchEvents({ source: source as EventSource, baseUrl: getAinizeUrl(), token: null }, cursor);
    return okResponse(page);
  } catch (e) {
    return failureResponse(e);
  }
}
