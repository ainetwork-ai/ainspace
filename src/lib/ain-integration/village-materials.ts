/**
 * 17.5 마을 자료 구분 — 서버 전용.
 *
 * 마을에 붙인 aindrive 파일 참조마다 **누구에게 보이는지(audience)** 를 Redis 필드 하나로 둔다.
 *   KV hash `village:<slug>:ain_materials` — field = fileKey(`issuer#driveId#fileId`),
 *   value = JSON `{ ref: FileRef, audience: 'public'|'members'|'agent', addedBy, addedAt }`.
 *
 *   - `public`  : 방문자·멤버 모두 본다. 마을 에이전트에게도 넘길 수 있다.
 *   - `members` : 멤버만 본다. **에이전트에게 넘기지 않는다**.
 *   - `agent`   : 사람 목록에는 나오지 않고(관리 보기 제외), 마을 에이전트 호출에만 file-refs 로 넘긴다.
 *
 * 멤버: 마을 소유자(만든 사람) + KV set `village:<slug>:members` 의 backend 사용자 id(검증된 세션의 sub) —
 * 누가 채우는지는 village-membership.ts. 자료를 붙이고 바꾸는 것도 멤버만.
 * 참조에는 토큰·서명 URL 이 없다(계약). 바이트는 aindrive 에 남고 여는 사람의 권한을 aindrive 가 다시 판단한다 —
 * 여기의 audience 는 **제품 안에서 누구에게 목록을 보여 주고 무엇을 에이전트에 넘길지**만 정한다.
 */
import { redisKv, type KvStore } from './kv';
import { materialsKey, membersKey, redisVillageDirectory } from './village-membership';
import { fileKey, isFileRef, type FileRef } from './types';

export const MATERIAL_AUDIENCES = ['public', 'members', 'agent'] as const;
export type MaterialAudience = (typeof MATERIAL_AUDIENCES)[number];
export type VillageViewer = 'visitor' | 'member';

export interface VillageMaterial {
  ref: FileRef;
  audience: MaterialAudience;
  addedBy: string;
  addedAt: string;
  /** 17.4: 마을 소유자가 붙인 전시 자료(작품). exhibition.ts. */
  exhibition?: boolean;
}

export { materialsKey, membersKey };

/** 마을 slug: 소문자·숫자·하이픈(마을 생성 라우트의 규칙과 같은 모양), 1..64. */
export const isVillageSlug = (s: string) => /^[a-z0-9-]{1,64}$/.test(s);
export const isMaterialAudience = (v: unknown): v is MaterialAudience => typeof v === 'string' && (MATERIAL_AUDIENCES as readonly string[]).includes(v);

/** 사람에게 보일 수 있는 audience. 방문자 = public, 멤버 = public+members. `agent` 는 사람 목록에 없다. */
export function audiencesFor(viewer: VillageViewer): readonly MaterialAudience[] {
  return viewer === 'member' ? ['public', 'members'] : ['public'];
}

/** 에이전트 호출에 file-refs 로 넘길 수 있는 audience — `members` 는 절대 넘기지 않는다. */
export const AGENT_AUDIENCES: readonly MaterialAudience[] = ['public', 'agent'];

export function visibleMaterials(all: VillageMaterial[], viewer: VillageViewer): VillageMaterial[] {
  const ok = audiencesFor(viewer);
  return all.filter((m) => ok.includes(m.audience));
}

export function agentMaterialKeys(all: VillageMaterial[]): string[] {
  return all.filter((m) => AGENT_AUDIENCES.includes(m.audience)).map((m) => fileKey(m.ref));
}

const parse = (raw: string): VillageMaterial | null => {
  try {
    const v = JSON.parse(raw) as VillageMaterial;
    return isFileRef(v?.ref) && isMaterialAudience(v.audience) ? v : null;
  } catch { return null; }
};

export interface VillageMaterialsStore {
  kv: KvStore;
  isMember: (slug: string, userId: string) => Promise<boolean>;
}

/** 멤버 판정은 village-membership.ts(소유자 + 멤버 set). */
export const defaultVillageStore: VillageMaterialsStore = { kv: redisKv, isMember: (slug, userId) => redisVillageDirectory.isMember(slug, userId) };

export async function listVillageMaterials(slug: string, s: VillageMaterialsStore = defaultVillageStore): Promise<VillageMaterial[]> {
  const h = await s.kv.hGetAll(materialsKey(slug));
  return Object.values(h).map(parse).filter((m): m is VillageMaterial => m !== null)
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt) || fileKey(a.ref).localeCompare(fileKey(b.ref)));
}

/** 같은 파일을 다시 붙이면 audience·ref 를 갱신한다(필드 하나 = 참조 하나). */
export async function putVillageMaterial(slug: string, m: VillageMaterial, s: VillageMaterialsStore = defaultVillageStore): Promise<void> {
  await s.kv.hSet(materialsKey(slug), fileKey(m.ref), JSON.stringify(m));
}

export async function removeVillageMaterial(slug: string, key: string, s: VillageMaterialsStore = defaultVillageStore): Promise<void> {
  await s.kv.hDel(materialsKey(slug), key);
}
