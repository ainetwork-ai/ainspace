/**
 * 계획 17.3 — 공유 에이전트의 **소유권 변경**을 마을 배치에 반영한다. 서버 전용.
 *
 * 마을 소유자는 "그 사람의 에이전트"를 믿고 배치했다. Ainize 에서 그 에이전트의 소유자가 바뀌면(양도·조직 이동)
 * 같은 agentKey 가 이제 다른 사람의 코드·정책으로 돌 수 있다. 그래서:
 *   - **배치는 그대로 둔다**(isPlaced·state 를 건드리지 않는다 — 다시 확인하면 같은 자리에서 계속).
 *   - StoredAgent 에 `ainOwnerChange = { from, to, detectedAt }` 를 표시한다 = "마을 소유자의 재확인 대기".
 *   - 재확인 전까지는 마을 자료를 그 에이전트에게 넘기지 않는다(village-membership `isPlacedIn`).
 *   - 마을 소유자가 `POST /api/ain/villages/:slug/agents` { agentKey, decision:'confirm' } 로 확인하면
 *     `ainOwnerKey` 를 새 소유자로 바꾸고 표시를 지운다.
 *
 * 소유자 관찰은 **서버가 Ainize 레지스트리에서 직접** 얻는다(클라이언트가 보낸 소유자를 믿지 않는다):
 *   1) `agent.updated` / `agent.moved` 이벤트(events/apply)가 오면 그 에이전트를 레지스트리에서 다시 resolve 한다
 *      — 계약 이벤트에는 소유자가 없다.
 *   2) invoke 가 에이전트를 resolve 할 때마다(`onAgentResolved`) 같은 비교를 한다.
 * 기준(`ainOwnerKey`)은 **가져올 때** 기록한다(`POST /api/agents` 가 레지스트리의 ownerRef 로 — `registryOwnerKey`).
 * 기준이 없는 에이전트(이 기능 전에 가져왔거나 가져올 때 레지스트리를 못 본 것)를 처음 관찰하면:
 *   - 마을에 **배치돼 있으면** 재확인 대기로 표시한다(`from: null`) — 배치 후 기준 없이 소유자가 바뀐 경우를 놓치지 않는다.
 *     마을 소유자가 한 번 확인하면 그 소유자가 기준이 된다(기준 채우기).
 *   - 배치돼 있지 않으면 기준으로만 기록한다(재확인할 마을 소유자가 없다).
 * 소유자가 원래대로 돌아오면 표시를 지운다.
 *
 * 마을 자료를 넘기는 invoke 는 관찰을 **기다린 뒤**(`verifyVillageAgentOwner`) 넘긴다 — 소유자가 바뀐 첫 호출에서
 * 자료가 새 소유자의 에이전트에 가지 않게.
 */
import type { StoredAgent } from '@/lib/redis';
import { listSharedAgents } from './agents';
import { redisAgentStore, type AgentStore } from './agent-events';
import type { FetchLike } from './http';
import { agentKey, parseAgentKey, type AgentRef, type OwnerRef, type ResourceEvent } from './types';

export interface OwnerChange { from: string | null; to: string; detectedAt: string }

/** 소유자 비교 키 — kind·issuer·subject(표시 이름은 비교하지 않는다). */
export const ownerKeyOf = (o: Pick<OwnerRef, 'kind' | 'issuer' | 'subject'>): string =>
  `${o.kind}:${o.issuer.replace(/\/+$/, '')}#${o.subject}`;

const normalizeKey = (key: string | undefined): string | null => {
  if (!key) return null;
  const p = parseAgentKey(key);
  return p ? `${p.registryIssuer}#${p.agentId}` : null;
};

/** 재확인 대기 중인가. */
export const needsOwnerReconfirm = (a: Pick<StoredAgent, 'ainOwnerChange'>): boolean => !!a.ainOwnerChange;

/** 소유자를 다시 봐야 하는 이벤트(계약 이벤트에는 소유자가 없어서 레지스트리를 다시 본다). */
export const OWNER_CHECK_EVENTS: ReadonlySet<string> = new Set(['agent.updated', 'agent.moved']);

export function ownerCheckKeys(events: ResourceEvent[]): string[] {
  const out = new Set<string>();
  for (const e of events) {
    if (e.kind !== 'agent' || !OWNER_CHECK_EVENTS.has(e.type)) continue;
    const k = normalizeKey(e.resourceId);
    if (k) out.add(k);
  }
  return [...out];
}

export interface OwnerObservationResult {
  /** 새로 재확인 대기로 표시된 배치. */
  flagged: { url: string; commonAgentId: string; change: OwnerChange }[];
  /** 기준으로만 기록한 것(처음 관찰). */
  baselined: number;
  /** 소유자가 원래대로 돌아와 표시를 지운 것. */
  cleared: number;
}

/** 관찰한 소유자(agentKey → OwnerRef)를 StoredAgent 에 반영한다. 저장은 바뀐 것만. */
export async function observeAgentOwners(observed: Map<string, OwnerRef>, store: AgentStore = redisAgentStore, now: () => Date = () => new Date()): Promise<OwnerObservationResult> {
  const result: OwnerObservationResult = { flagged: [], baselined: 0, cleared: 0 };
  if (!observed.size) return result;
  const want = new Map<string, string>();
  for (const [k, o] of observed) { const nk = normalizeKey(k); if (nk) want.set(nk, ownerKeyOf(o)); }
  for (const agent of await store.getAgents()) {
    const key = normalizeKey(agent.commonAgentId);
    const owner = key ? want.get(key) : undefined;
    if (!key || !owner) continue;
    if (!agent.ainOwnerKey) {
      if (isVillagePlaced(agent)) {
        // 기준 없이 배치된 에이전트 — 지금 소유자가 배치 때 소유자인지 알 수 없다. 마을 소유자의 확인을 받는다.
        if (agent.ainOwnerChange?.to === owner) continue;
        const change: OwnerChange = { from: null, to: owner, detectedAt: now().toISOString() };
        await store.saveAgent({ ...agent, ainOwnerChange: change });
        result.flagged.push({ url: agent.url, commonAgentId: key, change });
        continue;
      }
      await store.saveAgent({ ...agent, ainOwnerKey: owner });
      result.baselined++;
      continue;
    }
    if (agent.ainOwnerKey === owner) {
      if (agent.ainOwnerChange) {
        const { ainOwnerChange: _drop, ...rest } = agent; // eslint-disable-line @typescript-eslint/no-unused-vars
        await store.saveAgent(rest);
        result.cleared++;
      }
      continue;
    }
    if (agent.ainOwnerChange?.to === owner) continue; // 이미 같은 변경으로 대기 중
    const change: OwnerChange = { from: agent.ainOwnerKey, to: owner, detectedAt: now().toISOString() };
    await store.saveAgent({ ...agent, ainOwnerChange: change });
    result.flagged.push({ url: agent.url, commonAgentId: key, change });
  }
  return result;
}

const isVillagePlaced = (a: Pick<StoredAgent, 'isPlaced' | 'state'>): boolean => a.isPlaced === true && !!a.state?.mapName;

/**
 * 마을 자료를 넘기기 전의 **동기** 확인: resolve 한 에이전트의 소유자를 관찰(기다린다)한 뒤, 그 마을에 배치된 같은
 * agentKey 의 StoredAgent 가 모두 재확인 대기가 아니고 기준 소유자가 지금 소유자와 같을 때만 true.
 * 저장소 오류 등으로 확인할 수 없으면 false(자료를 넘기지 않는다).
 */
export async function verifyVillageAgentOwner(slug: string, ref: AgentRef, store: AgentStore = redisAgentStore): Promise<boolean> {
  try {
    const key = agentKey(ref);
    const owner = ownerKeyOf(ref.ownerRef);
    await observeAgentOwners(new Map([[key, ref.ownerRef]]), store);
    const nk = normalizeKey(key);
    const placed = (await store.getAgents()).filter((a) => normalizeKey(a.commonAgentId) === nk && isVillagePlaced(a) && a.state.mapName === slug);
    return placed.length > 0 && placed.every((a) => !a.ainOwnerChange && a.ainOwnerKey === owner);
  } catch (e) {
    console.error('agent owner verification failed:', e instanceof Error ? e.message : 'unknown');
    return false;
  }
}

/** 가져올 때 기준으로 삼을 레지스트리 소유자 키. 레지스트리에서 못 찾거나 실패하면 null(그러면 배치 후 첫 관찰이 재확인을 요구한다). */
export async function registryOwnerKey(opts: { ainizeUrl: string; fetch?: FetchLike }, key: string): Promise<string | null> {
  const nk = normalizeKey(key);
  if (!nk) return null;
  try {
    const owners = await resolveAgentOwners(opts, [nk]);
    const o = owners.get(nk);
    return o ? ownerKeyOf(o) : null;
  } catch (e) {
    console.error('registry owner lookup failed:', e instanceof Error ? e.message : 'unknown');
    return null;
  }
}

/** 배치된 StoredAgent 가 하나라도 있는 agentKey 만 — 상관없는 에이전트 때문에 레지스트리를 훑지 않는다. */
export async function trackedAgentKeys(keys: string[], store: AgentStore = redisAgentStore): Promise<string[]> {
  if (!keys.length) return [];
  const have = new Set((await store.getAgents()).map((a) => normalizeKey(a.commonAgentId)).filter((k): k is string => !!k));
  return keys.filter((k) => have.has(k));
}

const PAGE_LIMIT = 200;
const MAX_PAGES = 5;

/** 레지스트리 public 목록에서 여러 agentKey 의 현재 AgentRef 를 한 번에 찾는다. 없는 것은 빠진다(삭제는 이벤트가 다룬다). */
export async function resolveAgentOwners(opts: { ainizeUrl: string; fetch?: FetchLike }, keys: string[]): Promise<Map<string, OwnerRef>> {
  const out = new Map<string, OwnerRef>();
  if (!keys.length) return out;
  const wanted = new Set(keys);
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES && out.size < wanted.size; page++) {
    const res = await listSharedAgents({ ainizeUrl: opts.ainizeUrl.replace(/\/+$/, ''), sessionToken: null, fetch: opts.fetch }, { scope: 'public', limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) });
    for (const i of res.items) { const k = agentKey(i.ref); if (wanted.has(k)) out.set(k, i.ref.ownerRef); }
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return out;
}

/** invoke 경로의 관찰 한 건(실패해도 호출을 막지 않는다 — 로그에 이유만). */
export async function observeResolvedAgent(ref: AgentRef, store: AgentStore = redisAgentStore): Promise<void> {
  try {
    await observeAgentOwners(new Map([[agentKey(ref), ref.ownerRef]]), store);
  } catch (e) {
    console.error('agent owner observation failed:', e instanceof Error ? e.message : 'unknown');
  }
}

/**
 * 마을 소유자의 재확인: 그 마을에 배치된 같은 agentKey 의 StoredAgent 에서 대기 표시를 지우고 새 소유자를 기준으로 삼는다.
 * 돌려주는 수 = 확인한 배치 수(0 이면 대기 중인 것이 없었다).
 */
export async function confirmOwnerChange(slug: string, key: string, store: AgentStore = redisAgentStore): Promise<number> {
  const nk = normalizeKey(key);
  if (!nk) return 0;
  let n = 0;
  for (const agent of await store.getAgents()) {
    if (normalizeKey(agent.commonAgentId) !== nk || agent.state?.mapName !== slug || !agent.isPlaced || !agent.ainOwnerChange) continue;
    const { ainOwnerChange, ...rest } = agent;
    await store.saveAgent({ ...rest, ainOwnerKey: ainOwnerChange.to });
    n++;
  }
  return n;
}

export interface VillageAgentView {
  commonAgentId: string;
  url: string;
  name: string;
  backendStatus: 'active' | 'inactive';
  ownerChange: OwnerChange | null;
}

/** 그 마을에 배치된 공유 에이전트(commonAgentId 가 있는 것)의 관리 보기. */
export async function listVillageSharedAgents(slug: string, store: AgentStore = redisAgentStore): Promise<VillageAgentView[]> {
  return (await store.getAgents())
    .filter((a) => a.isPlaced && a.state?.mapName === slug && normalizeKey(a.commonAgentId))
    .map((a) => ({
      commonAgentId: normalizeKey(a.commonAgentId)!, url: a.url, name: a.card?.name ?? a.url,
      backendStatus: a.backendStatus ?? 'active', ownerChange: a.ainOwnerChange ?? null,
    }));
}
