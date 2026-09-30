/**
 * 17.5 마을 멤버십·검증된 체류·배치 에이전트 — 서버 전용.
 *
 * 원래 Space 에는 "마을 멤버" 개념이 없다(마을 메타데이터에 만든 사람도 없다). 그래서 여기서 정한다.
 *   - 소유자: KV `village:<slug>:owner` = 마을을 만든 사람의 backend 사용자 id(검증된 세션의 sub).
 *     `POST /api/villages` 가 플래그 on + 검증된 bearer 로 만들 때 기록한다. 소유자는 항상 멤버다.
 *   - 멤버: KV set `village:<slug>:members` = 소유자 + 소유자가 `POST /api/ain/villages/:slug/members` 로 넣은 사람.
 *     소유자가 없는 기존 마을은 관리자 대시보드(미들웨어가 검증한 x-admin-verified)만 소유자를 정할 수 있다.
 *   - 체류(presence): KV hash `village:<slug>:ain_presence` field = 사용자 id, value = 마지막 확인 시각(ms).
 *     기존 위치/SSE presence 는 클라이언트가 보낸 wallet/session id 라 검증된 사용자와 이어지지 않으므로,
 *     검증된 세션으로 `PUT /api/ain/villages/:slug/presence` 를 부른 사람만 "그 마을 안에 있다"고 본다.
 *   - 배치 에이전트: StoredAgent 중 `commonAgentId === agentKey`, `isPlaced`, `state.mapName === slug`, 비활성 아님,
 *     소유권 변경 재확인 대기 아님(17.3, agent-ownership.ts).
 *
 * 마을 자료를 에이전트에 넘기는 invoke 는 (에이전트가 그 마을에 배치됨) AND (호출자가 멤버이거나 체류 중) 일 때만 허용한다.
 */
import { getAgents, getRedisClient, type StoredAgent } from '@/lib/redis';
import { readBearerHeader, verifyAppSession } from './app-session';
import { isAinIntegrationEnabled } from './config';

export const materialsKey = (slug: string) => `village:${slug}:ain_materials`;
export const membersKey = (slug: string) => `village:${slug}:members`;
export const ownerKey = (slug: string) => `village:${slug}:owner`;
export const presenceKey = (slug: string) => `village:${slug}:ain_presence`;
/** 17.7 기존 마을 자산(맵·타일셋)의 Aindrive 링크 — field = 자산 id, value = AssetLink JSON(asset-linking.ts). */
export const assetLinksKey = (slug: string) => `village:${slug}:ain_asset_links`;
/** 체류 확인이 이만큼 지나면 마을을 떠난 것으로 본다(클라이언트는 이보다 자주 갱신). */
export const PRESENCE_TTL_MS = 10 * 60_000;
export const MAX_MEMBERS = 500;

export interface VillageDirectory {
  villageExists(slug: string): Promise<boolean>;
  getOwner(slug: string): Promise<string | null>;
  /** 소유자를 정하고 멤버에도 넣는다. */
  setOwner(slug: string, userId: string): Promise<void>;
  isMember(slug: string, userId: string): Promise<boolean>;
  addMember(slug: string, userId: string): Promise<void>;
  removeMember(slug: string, userId: string): Promise<void>;
  listMembers(slug: string): Promise<string[]>;
  markPresent(slug: string, userId: string, nowMs: number): Promise<void>;
  clearPresent(slug: string, userId: string): Promise<void>;
  isPresent(slug: string, userId: string, nowMs: number): Promise<boolean>;
  isAgentPlacedIn(slug: string, agentKey: string): Promise<boolean>;
  /** 마을 삭제 시 AIN 쪽 키(소유자·멤버·자료·체류·자산 링크)를 지운다 — 같은 slug 로 다시 만든 마을이 옛 멤버를 물려받지 않게. */
  clearVillage(slug: string): Promise<void>;
}

/** 17.3: 소유자가 바뀌어 마을 소유자의 재확인을 기다리는 배치는 배치는 유지하되 마을 자료를 받지 못한다. */
export const isPlacedIn = (a: Pick<StoredAgent, 'commonAgentId' | 'isPlaced' | 'state' | 'backendStatus' | 'ainOwnerChange'>, slug: string, agentKey: string) =>
  a.commonAgentId === agentKey && a.isPlaced === true && a.state?.mapName === slug && a.backendStatus !== 'inactive' && !a.ainOwnerChange;

export const redisVillageDirectory: VillageDirectory = {
  async villageExists(slug) {
    const r = await getRedisClient();
    return Boolean(await r.sIsMember('villages:all', slug)) || (await r.exists(`village:${slug}`)) > 0;
  },
  async getOwner(slug) { return (await getRedisClient()).get(ownerKey(slug)); },
  async setOwner(slug, userId) {
    const r = await getRedisClient();
    await r.set(ownerKey(slug), userId);
    await r.sAdd(membersKey(slug), userId);
  },
  async isMember(slug, userId) {
    const r = await getRedisClient();
    if (await r.sIsMember(membersKey(slug), userId)) return true;
    return (await r.get(ownerKey(slug))) === userId;
  },
  async addMember(slug, userId) { await (await getRedisClient()).sAdd(membersKey(slug), userId); },
  async removeMember(slug, userId) { await (await getRedisClient()).sRem(membersKey(slug), userId); },
  async listMembers(slug) { return ((await (await getRedisClient()).sMembers(membersKey(slug))) as string[]).sort(); },
  async markPresent(slug, userId, nowMs) {
    const r = await getRedisClient();
    await r.hSet(presenceKey(slug), userId, String(nowMs));
    await r.expire(presenceKey(slug), 3600);
  },
  async clearPresent(slug, userId) { await (await getRedisClient()).hDel(presenceKey(slug), userId); },
  async isPresent(slug, userId, nowMs) {
    const at = Number((await (await getRedisClient()).hGet(presenceKey(slug), userId)) ?? 0);
    return at > 0 && nowMs - at <= PRESENCE_TTL_MS;
  },
  async isAgentPlacedIn(slug, agentKey) {
    return (await getAgents()).some((a) => isPlacedIn(a, slug, agentKey));
  },
  async clearVillage(slug) {
    await (await getRedisClient()).del([ownerKey(slug), membersKey(slug), materialsKey(slug), presenceKey(slug), assetLinksKey(slug)]);
  },
};

/** 테스트용 메모리 구현. */
export function memoryVillageDirectory(init: { villages?: string[]; agents?: Pick<StoredAgent, 'commonAgentId' | 'isPlaced' | 'state' | 'backendStatus' | 'ainOwnerChange'>[] } = {}) {
  const villages = new Set(init.villages ?? []);
  const owners = new Map<string, string>();
  const members = new Map<string, Set<string>>();
  const presence = new Map<string, Map<string, number>>();
  const agents = [...(init.agents ?? [])];
  const set = (slug: string) => { if (!members.has(slug)) members.set(slug, new Set()); return members.get(slug)!; };
  const dir: VillageDirectory & { villages: Set<string>; owners: Map<string, string>; members: Map<string, Set<string>>; agents: typeof agents; cleared: string[] } = {
    villages, owners, members, agents, cleared: [],
    async villageExists(slug) { return villages.has(slug); },
    async getOwner(slug) { return owners.get(slug) ?? null; },
    async setOwner(slug, userId) { owners.set(slug, userId); set(slug).add(userId); },
    async isMember(slug, userId) { return set(slug).has(userId) || owners.get(slug) === userId; },
    async addMember(slug, userId) { set(slug).add(userId); },
    async removeMember(slug, userId) { set(slug).delete(userId); },
    async listMembers(slug) { return [...set(slug)].sort(); },
    async markPresent(slug, userId, nowMs) { if (!presence.has(slug)) presence.set(slug, new Map()); presence.get(slug)!.set(userId, nowMs); },
    async clearPresent(slug, userId) { presence.get(slug)?.delete(userId); },
    async isPresent(slug, userId, nowMs) { const at = presence.get(slug)?.get(userId) ?? 0; return at > 0 && nowMs - at <= PRESENCE_TTL_MS; },
    async isAgentPlacedIn(slug, agentKey) { return agents.some((a) => isPlacedIn(a, slug, agentKey)); },
    async clearVillage(slug) { owners.delete(slug); members.delete(slug); presence.delete(slug); dir.cleared.push(slug); },
  };
  return dir;
}

/**
 * 마을을 만든 사람을 소유자로 기록한다(`POST /api/villages` 가 저장 뒤에 부른다). 플래그 off·bearer 없음·검증 실패면
 * 아무것도 하지 않고 null — 마을 생성 자체는 막지 않는다(기존 관리자 도구는 bearer 없이 만든다). 이미 소유자가 있으면
 * 바꾸지 않는다(같은 slug 재저장). 토큰은 로그에 싣지 않는다.
 */
export async function recordVillageCreator(request: Pick<Request, 'headers'>, slug: string, dir: VillageDirectory): Promise<string | null> {
  if (!isAinIntegrationEnabled()) return null;
  const bearer = readBearerHeader(request);
  if (!bearer) return null;
  try {
    const session = await verifyAppSession(bearer);
    if (!session) return null;
    const existing = await dir.getOwner(slug);
    if (existing) return existing;
    await dir.setOwner(slug, session.userId);
    return session.userId;
  } catch (e) {
    console.error('village owner record failed:', e instanceof Error ? e.message : 'unknown');
    return null;
  }
}
