import { NextRequest } from 'next/server';
import { getAinizeUrl } from '@/lib/ain-integration/config';
import { sharedAgentsDeps as deps } from '@/lib/ain-integration/deps';
import { failureResponse, guardAinRoute, okResponse, parseListQuery } from '@/lib/ain-integration/route';
import { AGENT_LIST_SCOPES, type AgentListScope } from '@/lib/ain-integration/types';

export const runtime = 'nodejs';

/**
 * GET /api/ain/shared-agents?scope=public|mine|shared_with_me|shared_with_org&q&cursor&limit
 *
 * 어댑터 사양 §제품에 넣을 것 2. 앱 세션(backend JWT)으로 보호한다. Space 는 Ainize 세션을
 * 갖고 있지 않으므로 원본은 익명으로 부른다(public 범위가 의미 있고, 나머지는 원본이 판단).
 * 계약 응답을 그대로 전달하고, 플래그 off 면 404. 원본 호출은 `sharedAgentsDeps` 를 거친다.
 */

export async function GET(request: NextRequest) {
  const guard = guardAinRoute(request);
  if (!('bearer' in guard)) return guard;

  const query = parseListQuery<AgentListScope>(request.nextUrl.searchParams, AGENT_LIST_SCOPES, 'shared_with_me');
  if (!('scope' in query)) return query;

  try {
    const res = await deps.listSharedAgents({ ainizeUrl: getAinizeUrl(), sessionToken: null }, query);
    return okResponse(res);
  } catch (e) {
    return failureResponse(e);
  }
}
