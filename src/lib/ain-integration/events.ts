/**
 * 변경 이벤트 소비 (adapter-invoke-spec §events, docs/10-change-propagation.md).
 *
 * 원본 피드를 계약 그대로 전달한다:
 *   aindrive  GET {AINDRIVE_URL}/api/oauth/events?cursor=        (계정 토큰 aind_aat_, drives:read)
 *   Ainize    GET {AINIZE_URL}/api/shared-agents/events?cursor=  (세션 선택)
 * 그리고 제품 캐시(즐겨찾기·최근·목록 캐시)에 적용하는 순수 reducer 를 둔다:
 *   - 같은 resourceId 는 더 큰 version 만 적용(중복·역순 안전)
 *   - `gap:true` 면 전체 재목록 신호
 *   - 철회 계열(REVOKING_TYPES)은 항목을 "접근 불가"로 표시하고 숨기지 않는다.
 */
import { getJson, qs, type FetchLike } from './http';
import { AinContractError, REVOKING_TYPES, isEventPage, type EventPage, type EventSource, type ResourceEvent } from './types';

export interface EventsSourceOptions {
  source: EventSource;
  /** 원본 오리진(issuer). */
  baseUrl: string;
  /** aindrive: 계정 토큰(필수). Ainize: 세션 토큰(선택). */
  token?: string | null;
  connectUrl?: string;
  fetch?: FetchLike;
}

const FEED_PATH: Record<EventSource, string> = { aindrive: '/api/oauth/events', ainize: '/api/shared-agents/events' };

export async function fetchEvents(opts: EventsSourceOptions, cursor: string | null | undefined): Promise<EventPage> {
  if (opts.source === 'aindrive' && !opts.token) {
    throw new AinContractError('auth_required', 'aindrive 계정이 연결되어 있지 않습니다. 연결하면 변경 이벤트를 받을 수 있습니다.', {
      ...(opts.connectUrl ? { actionUrl: opts.connectUrl } : {}),
    });
  }
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = opts.token ? { authorization: `Bearer ${opts.token}` } : {};
  const r = await getJson<unknown>(f, `${base}${FEED_PATH[opts.source]}${qs({ cursor: cursor ?? undefined })}`, headers);
  if (!isEventPage(r)) throw new AinContractError('temporary_failure', '원본 이벤트 피드가 계약 모양이 아닙니다.', { retryable: true });
  return r;
}

// ------------------------------------------------------------------------------- reducer

/** 소비자가 가진 상태: 리소스별 마지막 version, 접근 불가로 표시된 키, 다음 커서. 직렬화 가능(클라이언트 저장 OK). */
export interface EventCacheState {
  versions: Record<string, number>;
  /** REVOKING_TYPES 이벤트를 본 리소스 키. 목록에서는 숨기지 않고 "접근 불가"로 그린다. */
  inaccessible: string[];
  cursor: string | null;
}

export const emptyEventCache = (): EventCacheState => ({ versions: {}, inaccessible: [], cursor: null });

/** 더 큰 version 만 적용. 적용된 이벤트를 순서대로 돌려준다(중복·역순은 버려진다). */
export function applyEvents(versions: Record<string, number>, events: ResourceEvent[]): { versions: Record<string, number>; applied: ResourceEvent[] } {
  const next = { ...versions };
  const applied: ResourceEvent[] = [];
  for (const e of events) {
    const have = next[e.resourceId] ?? -1;
    if (e.version <= have) continue;
    next[e.resourceId] = e.version;
    applied.push(e);
  }
  return { versions: next, applied };
}

export interface ReduceResult {
  state: EventCacheState;
  applied: ResourceEvent[];
  /** `gap:true` — 캐시를 버리고 `scope=shared_with_me` 첫 페이지부터 다시 목록을 받아야 한다. */
  relist: boolean;
}

/**
 * 한 페이지를 캐시 상태에 적용한다. 철회 이벤트는 `inaccessible` 에 더하고, 같은 리소스에 그보다 새로운
 * `file.shared`/`agent.published`(다시 공유·게시)가 오면 뺀다. gap 이면 version 맵과 접근 불가 표시를
 * 비우고 재목록을 요청한다(재목록 결과가 진실이다).
 */
export function reduceEventPage(state: EventCacheState, page: EventPage): ReduceResult {
  if (page.gap) {
    return { state: { versions: {}, inaccessible: [], cursor: page.nextCursor }, applied: [], relist: true };
  }
  const { versions, applied } = applyEvents(state.versions, page.events);
  const inaccessible = new Set(state.inaccessible);
  for (const e of applied) {
    if (REVOKING_TYPES.has(e.type)) inaccessible.add(e.resourceId);
    else if (e.type === 'file.shared' || e.type === 'agent.published') inaccessible.delete(e.resourceId);
  }
  return { state: { versions, inaccessible: [...inaccessible], cursor: page.nextCursor ?? state.cursor }, applied, relist: false };
}

/** 목록 항목에 접근 불가 표시를 붙인다(숨기지 않는다). `keyOf` 는 fileKey/agentKey. */
export function markInaccessible<T>(items: T[], state: Pick<EventCacheState, 'inaccessible'>, keyOf: (item: T) => string): (T & { inaccessible: boolean })[] {
  const set = new Set(state.inaccessible);
  return items.map((item) => ({ ...item, inaccessible: set.has(keyOf(item)) }));
}
