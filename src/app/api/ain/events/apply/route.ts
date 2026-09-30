import { NextRequest } from 'next/server';
import { getAinizeUrl } from '@/lib/ain-integration/config';
import { eventsDeps as deps } from '@/lib/ain-integration/deps';
import { errorResponse, failureResponse, guardAinRoute, okResponse } from '@/lib/ain-integration/route';
import { AIN_CONTRACT_VERSION, makeError } from '@/lib/ain-integration/types';
import { ownerCheckKeys } from '@/lib/ain-integration/agent-ownership';

export const runtime = 'nodejs';

/**
 * POST /api/ain/events/apply  { cursor?: string }
 *   → 200 { contract, nextCursor, gap, applied: number, matched, ignored, changed: [{ url, commonAgentId, backendStatus, version }] }
 *
 * 계획 17.3: Ainize 변경 이벤트(agent.disabled/deleted/unpublished/revoked → inactive, agent.published/updated → active)를
 * 마을에 배치된 에이전트(StoredAgent.commonAgentId 일치)의 `backendStatus` 에 반영한다. 배치는 지우지 않는다.
 * 이벤트는 **서버가 Ainize 에서 직접** 받는다 — 클라이언트가 보낸 이벤트를 믿지 않는다(누구나 남의 에이전트를 비활성화할 수 있게 된다).
 * `gap:true` 면 원본이 그만큼 오래된 이벤트를 갖고 있지 않다: 적용할 것이 없고, 호출자는 처음부터 다시 받아야 한다.
 * 소유권(17.3): `agent.updated`/`agent.moved` 가 온 에이전트 중 이 제품에 배치된 것은 Ainize 레지스트리에서 다시 resolve 해
 * 소유자가 배치 때와 다르면 **배치는 두고** 마을 소유자 재확인 대기로 표시한다(`ownerChanges`). 레지스트리 조회가 실패하면
 * 요청 전체를 실패로 돌려 호출자가 같은 cursor 로 다시 부르게 한다(상태 반영은 version 으로 멱등).
 * 앱 세션(검증된 backend JWT)으로 보호한다.
 */
export async function POST(request: NextRequest) {
  const guard = await guardAinRoute(request);
  if (!('userId' in guard)) return guard;

  let body: unknown = null;
  try { body = await request.json(); } catch { body = null; }
  const cursorRaw = body && typeof body === 'object' && !Array.isArray(body) ? (body as { cursor?: unknown }).cursor : undefined;
  if (cursorRaw !== undefined && cursorRaw !== null && (typeof cursorRaw !== 'string' || cursorRaw.length === 0 || cursorRaw.length > 4096)) {
    return errorResponse(makeError('unsupported_input', 'cursor 가 올바르지 않습니다.'), 400);
  }
  const cursor = typeof cursorRaw === 'string' ? cursorRaw : undefined;

  try {
    const page = await deps.fetchEvents({ source: 'ainize', baseUrl: getAinizeUrl(), token: null }, cursor);
    const applied = page.gap ? { changed: [], matched: 0, ignored: 0 } : await deps.applyAgentEvents(page.events);
    let ownerChanges: { url: string; commonAgentId: string; change: { from: string | null; to: string; detectedAt: string } }[] = [];
    if (!page.gap) {
      const tracked = await deps.trackedAgentKeys(ownerCheckKeys(page.events));
      if (tracked.length) {
        const owners = await deps.resolveAgentOwners({ ainizeUrl: getAinizeUrl() }, tracked);
        ownerChanges = (await deps.observeAgentOwners(owners)).flagged;
      }
    }
    return okResponse({
      ownerChanges,
      contract: AIN_CONTRACT_VERSION, nextCursor: page.nextCursor, gap: page.gap,
      applied: page.gap ? 0 : page.events.length, matched: applied.matched, ignored: applied.ignored, changed: applied.changed,
    });
  } catch (e) {
    return failureResponse(e);
  }
}
