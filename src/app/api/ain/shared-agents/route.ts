import { NextRequest } from 'next/server';
import { AGENT_SCOPE_HEADER, getAinizeApiKey, getAinizeUrl } from '@/lib/ain-integration/config';
import { sharedAgentsDeps as deps } from '@/lib/ain-integration/deps';
import { failureResponse, guardAinRoute, okResponse, parseListQuery } from '@/lib/ain-integration/route';
import { AGENT_LIST_SCOPES, type AgentListScope } from '@/lib/ain-integration/types';

export const runtime = 'nodejs';

/** 사용자 본인 신원이 있어야 답할 수 있는 범위 — Space 에는 사용자별 Ainize 세션이 없으므로 기본 범위로 내린다. */
const USER_SCOPES: ReadonlySet<AgentListScope> = new Set<AgentListScope>(['mine', 'shared_with_me']);

/**
 * GET /api/ain/shared-agents?scope=public|mine|shared_with_me|shared_with_org&q&cursor&limit
 *
 * 어댑터 사양 §제품에 넣을 것 2. 앱 세션(검증된 backend JWT)으로 보호한다. 계약 응답을 그대로 전달하고, 플래그 off 면 404.
 *
 * 자격(20.1 결함 B): Space 는 **사용자별 Ainize 세션을 갖고 있지 않다**. 그래서 `shared_with_me` 는 원본에서 언제나
 * 401("sign in to list…")이 되어 목록이 비었다. Teams·Memory 와 같게:
 *  - 설치 단위 조직 API 키(`AINIZE_API_KEY`)가 있으면 그것을 Bearer 로 붙이고 기본 범위는 `shared_with_org`,
 *    없으면 익명으로 `public`.
 *  - `shared_with_me`·`mine`(사용자 본인이 누구인지 있어야 답할 수 있는 범위)을 청해도 위 기본 범위로 내려간다.
 *    특히 `mine` 을 조직 키로 원본에 보내면 Ainize 는 키 **소유자**를 주체로 보아 그 소유자의 비공개·unlisted
 *    에이전트(엔드포인트 포함)까지 돌려준다 — Space 는 공개 앱이라 로그인한 누구나 그것을 보게 되므로 절대 보내지 않는다.
 *  - 호출자가 준 `?org=` 는 버린다. Space 에는 조직 멤버십 검사(Teams 의 assertOrgMember)가 없으므로, 조직은 언제나
 *    설치 키가 속한 조직으로만 정해진다(원본도 키 조직과 다르면 403 이지만 여기서 먼저 막는다).
 *  실제로 물은 범위는 `x-ain-agent-scope` 헤더로 알린다(본문은 계약 모양 그대로).
 * 원본 호출은 `sharedAgentsDeps` 를 거친다. 키는 헤더로만 나간다.
 */
export async function GET(request: NextRequest) {
  const guard = await guardAinRoute(request);
  if (!('userId' in guard)) return guard;

  const apiKey = getAinizeApiKey();
  const fallback: AgentListScope = apiKey ? 'shared_with_org' : 'public';
  const query = parseListQuery<AgentListScope>(request.nextUrl.searchParams, AGENT_LIST_SCOPES, fallback);
  if (!('scope' in query)) return query;
  const { org: _callerOrg, ...rest } = query;
  void _callerOrg;
  const req = USER_SCOPES.has(rest.scope) ? { ...rest, scope: fallback } : rest;

  try {
    const res = await deps.listSharedAgents({ ainizeUrl: getAinizeUrl(), sessionToken: apiKey }, req);
    const out = okResponse(res);
    out.headers.set(AGENT_SCOPE_HEADER, req.scope);
    return out;
  } catch (e) {
    return failureResponse(e);
  }
}
