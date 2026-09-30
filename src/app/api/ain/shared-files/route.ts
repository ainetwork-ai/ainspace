import { NextRequest } from 'next/server';
import { getAindriveConnectUrl, getAindriveUrl } from '@/lib/ain-integration/config';
import { sharedFilesDeps as deps } from '@/lib/ain-integration/deps';
import { failureResponse, guardAinRoute, okResponse, parseListQuery } from '@/lib/ain-integration/route';
import { FILE_LIST_SCOPES, type FileListScope } from '@/lib/ain-integration/types';

export const runtime = 'nodejs';

/**
 * GET /api/ain/shared-files?scope=shared_with_me|mine|shared_with_org|recent&q&cursor&limit
 *
 * 어댑터 사양 §제품에 넣을 것 2. 앱 세션(검증된 backend JWT)으로 보호하고, 사용자의 aindrive 계정
 * 토큰으로 원본을 불러 계약 응답(`{contract, asOf, nextCursor, items}`)을 그대로 전달한다.
 * 토큰이 없으면 `auth_required` + actionUrl(연결 안내). 플래그 off 면 404.
 * 원본 호출·토큰 조회는 `sharedFilesDeps` 를 거친다(테스트 주입 지점).
 */

export async function GET(request: NextRequest) {
  const guard = await guardAinRoute(request);
  if (!('userId' in guard)) return guard;

  const query = parseListQuery<FileListScope>(request.nextUrl.searchParams, FILE_LIST_SCOPES, 'shared_with_me');
  if (!('scope' in query)) return query;

  try {
    const token = await deps.getAindriveAccountToken(guard.userId);
    const res = await deps.listSharedFiles({ aindriveUrl: getAindriveUrl(), token, connectUrl: getAindriveConnectUrl(request.nextUrl.origin) }, query);
    return okResponse(res);
  } catch (e) {
    return failureResponse(e);
  }
}
