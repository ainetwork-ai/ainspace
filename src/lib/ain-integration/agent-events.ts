/**
 * 계획 17.3 — Ainize 변경 이벤트(agent.*)를 마을에 배치된 에이전트에 반영한다.
 *
 * `GET /api/ain/events?source=ainize` 의 이벤트 가운데
 *   - `agent.disabled` / `agent.deleted` / `agent.unpublished` / `agent.revoked` → 같은 `commonAgentId` 를 가진
 *     StoredAgent 를 `backendStatus:'inactive'` 로 (AgentTab 이 비활성으로 그린다). **배치(isPlaced·state)는 지우지 않는다** —
 *     에이전트가 다시 게시되면 같은 자리에 돌아온다.
 *   - `agent.published` / `agent.updated` → `backendStatus:'active'` 로 되돌린다.
 *   - `agent.moved`(소유권·위치 변경)는 상태를 바꾸지 않는다. 소유권 변경은 agent-ownership.ts 가 따로 본다
 *     (`agent.updated`/`agent.moved` → 레지스트리 재조회 → 배치 유지 + 마을 소유자 재확인 대기).
 * 같은 리소스는 더 큰 version 만 적용한다(중복·역순 안전): 마지막으로 적용한 version 을 `ainStatusVersion` 에 남겨
 * 다음 페이지의 오래된 이벤트가 최신 상태를 되돌리지 못하게 한다.
 *
 * 저장소는 주입한다(`AgentStore`) — 테스트는 가짜 Redis 로 돌리고, 라우트는 `redisAgentStore` 를 쓴다.
 */
import { getAgents, saveStoredAgent, type StoredAgent } from '@/lib/redis';
import { parseAgentKey, type ResourceEvent } from './types';

export interface AgentStore {
  getAgents(): Promise<StoredAgent[]>;
  saveAgent(agent: StoredAgent): Promise<void>;
}

export const redisAgentStore: AgentStore = { getAgents, saveAgent: saveStoredAgent };

export const DEACTIVATING_AGENT_EVENTS: ReadonlySet<string> = new Set(['agent.disabled', 'agent.deleted', 'agent.unpublished', 'agent.revoked']);
export const ACTIVATING_AGENT_EVENTS: ReadonlySet<string> = new Set(['agent.published', 'agent.updated']);

export interface AgentStatusChange { url: string; commonAgentId: string; backendStatus: 'active' | 'inactive'; version: number }

export interface ApplyAgentEventsResult {
  /** 실제로 저장한 변경(상태가 바뀌었거나 version 이 앞선 것). */
  changed: AgentStatusChange[];
  /** commonAgentId 가 이벤트와 맞은 StoredAgent 수(변경 없음 포함). */
  matched: number;
  /** 상태와 무관한 이벤트(agent.moved·file.*) 수. */
  ignored: number;
}

/** `registryIssuer#agentId` 를 commonAgentId 와 같은 정규형으로(issuer 끝 슬래시 제거). 모양이 아니면 null. */
const normalizeKey = (key: string | undefined): string | null => {
  if (!key) return null;
  const p = parseAgentKey(key);
  return p ? `${p.registryIssuer}#${p.agentId}` : null;
};

/** 리소스별로 가장 큰 version 의 상태 이벤트 하나만 남긴다(같은 version 이면 뒤에 온 것). */
export function latestStatusByAgent(events: ResourceEvent[]): { byKey: Map<string, { status: 'active' | 'inactive'; version: number }>; ignored: number } {
  const byKey = new Map<string, { status: 'active' | 'inactive'; version: number }>();
  let ignored = 0;
  for (const e of events) {
    const status = e.kind === 'agent' && DEACTIVATING_AGENT_EVENTS.has(e.type) ? 'inactive' : e.kind === 'agent' && ACTIVATING_AGENT_EVENTS.has(e.type) ? 'active' : null;
    const key = normalizeKey(e.resourceId);
    if (!status || !key) { ignored++; continue; }
    const have = byKey.get(key);
    if (!have || e.version >= have.version) byKey.set(key, { status, version: e.version });
  }
  return { byKey, ignored };
}

export async function applyAgentEvents(events: ResourceEvent[], store: AgentStore = redisAgentStore): Promise<ApplyAgentEventsResult> {
  const { byKey, ignored } = latestStatusByAgent(events);
  const result: ApplyAgentEventsResult = { changed: [], matched: 0, ignored };
  if (byKey.size === 0) return result;
  const agents = await store.getAgents();
  for (const agent of agents) {
    const key = normalizeKey(agent.commonAgentId);
    if (!key) continue;
    const want = byKey.get(key);
    if (!want) continue;
    result.matched++;
    // 이미 더 새로운(또는 같은) version 을 적용했으면 건너뛴다.
    if (typeof agent.ainStatusVersion === 'number' && want.version <= agent.ainStatusVersion) continue;
    const current = agent.backendStatus ?? 'active';
    if (current === want.status && agent.ainStatusVersion === undefined && want.status === 'active') {
      // 활성인 에이전트에 온 첫 활성 이벤트: 기록만 남길 필요는 없다(쓰기를 아낀다).
      continue;
    }
    const next: StoredAgent = { ...agent, backendStatus: want.status, ainStatusVersion: want.version };
    await store.saveAgent(next);
    result.changed.push({ url: agent.url, commonAgentId: key, backendStatus: want.status, version: want.version });
  }
  return result;
}
