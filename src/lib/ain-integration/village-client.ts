/**
 * 브라우저 쪽 마을 AIN 클라이언트 — 멤버 관리(17.5), 검증된 체류(17.5), 전시 자료(17.4), 소유권 변경 재확인(17.3).
 *
 * 모든 호출은 주입한 fetcher(기본 `bffAuthFetch` — 세션 bearer 를 헤더로 싣는다)로 같은 오리진 라우트만 부른다.
 * 응답의 오류는 계약 바디(`error.message`, `error.actionUrl`)만 꺼내 쓴다. 토큰은 여기서 다루지 않는다.
 */
import type { FileRef } from './types';

export type VillageFetcher = (input: string, init?: RequestInit) => Promise<Response>;
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string; actionUrl?: string };

const enc = encodeURIComponent;

async function call<T>(fetcher: VillageFetcher, path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetcher(path, { ...init, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...(init?.headers ?? {}) } });
    const body = await res.json().catch(() => null) as { error?: { message?: string; actionUrl?: string } } | null;
    if (!res.ok) return { ok: false, status: res.status, message: body?.error?.message ?? `요청에 실패했습니다 (${res.status})`, ...(body?.error?.actionUrl ? { actionUrl: body.error.actionUrl } : {}) };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, message: '서버에 연결할 수 없습니다.' };
  }
}

// ------------------------------------------------------------------------------------------ members (17.5)

export interface MembersView { owner: string | null; members: string[] }

export const getMembers = (f: VillageFetcher, slug: string) => call<MembersView>(f, `/api/villages/${enc(slug)}/members`);
export const addMember = (f: VillageFetcher, slug: string, userId: string) =>
  call<MembersView>(f, `/api/villages/${enc(slug)}/members`, { method: 'POST', body: JSON.stringify({ userId }) });
export const removeMember = (f: VillageFetcher, slug: string, userId: string) =>
  call<MembersView>(f, `/api/villages/${enc(slug)}/members?userId=${enc(userId)}`, { method: 'DELETE' });

// ------------------------------------------------------------------------------------------ exhibition (17.4)

export type ExhibitAvailability = 'available' | 'offline' | 'deleted' | 'forbidden' | 'unknown';
export interface ExhibitItem { ref: FileRef; audience: 'public' | 'members'; addedAt: string; availability: ExhibitAvailability }
export interface ExhibitionView { viewer: 'visitor' | 'member'; isOwner: boolean; items: ExhibitItem[]; actionUrl?: string }

export const AVAILABILITY_LABEL: Record<ExhibitAvailability, string> = {
  available: '', offline: '오프라인', deleted: '삭제됨', forbidden: '볼 수 없음', unknown: '확인 불가',
};

export const getExhibition = (f: VillageFetcher, slug: string) => call<ExhibitionView>(f, `/api/ain/villages/${enc(slug)}/exhibition`);
export const addExhibit = (f: VillageFetcher, slug: string, fileKey: string, audience: 'public' | 'members' = 'public') =>
  call<{ ref: FileRef }>(f, `/api/ain/villages/${enc(slug)}/materials`, { method: 'PUT', body: JSON.stringify({ fileKey, audience, exhibition: true }) });
export const removeExhibit = (f: VillageFetcher, slug: string, fileKey: string) =>
  call<{ removed: boolean }>(f, `/api/ain/villages/${enc(slug)}/materials?fileKey=${enc(fileKey)}`, { method: 'DELETE' });

// ------------------------------------------------------------------------------------------ placed agents (17.3)

export interface VillageAgentItem {
  commonAgentId: string; url: string; name: string; backendStatus: 'active' | 'inactive';
  ownerChange: { from: string | null; to: string; detectedAt: string } | null;
}

export const getVillageAgents = (f: VillageFetcher, slug: string) => call<{ items: VillageAgentItem[] }>(f, `/api/ain/villages/${enc(slug)}/agents`);
export const confirmVillageAgent = (f: VillageFetcher, slug: string, agentKey: string) =>
  call<{ confirmed: number }>(f, `/api/ain/villages/${enc(slug)}/agents`, { method: 'POST', body: JSON.stringify({ agentKey, decision: 'confirm' }) });

// ------------------------------------------------------------------------------------------ presence (17.5)

/** 체류 갱신 주기 — 서버의 PRESENCE_TTL_MS(10분)보다 짧게. */
export const PRESENCE_REFRESH_MS = 5 * 60_000;

export interface PresenceSyncOptions {
  fetcher: VillageFetcher;
  intervalMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

/**
 * 마을에 들어가면 `PUT /api/ain/villages/:slug/presence` 를 부르고 5분마다 갱신, 떠나면(다른 마을·마을 밖·페이지 종료)
 * `DELETE`. 한 번에 한 마을만. 실패는 조용히 넘긴다(다음 갱신이 다시 시도한다) — 체류는 마을 자료 invoke 의 조건일 뿐이다.
 */
export class VillagePresenceSync {
  private current: string | null = null;
  private timer: unknown = null;
  private readonly o: Required<PresenceSyncOptions>;

  constructor(o: PresenceSyncOptions) {
    this.o = {
      intervalMs: PRESENCE_REFRESH_MS,
      setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
      clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof globalThis.setInterval>),
      ...o,
    };
  }

  get slug(): string | null { return this.current; }

  private put(slug: string) {
    void this.o.fetcher(`/api/ain/villages/${enc(slug)}/presence`, { method: 'PUT' }).catch(() => {});
  }

  enter(slug: string): void {
    if (this.current === slug) return;
    this.leave();
    this.current = slug;
    this.put(slug);
    this.timer = this.o.setInterval(() => { if (this.current) this.put(this.current); }, this.o.intervalMs);
  }

  /** `keepalive` — 페이지를 닫을 때(pagehide) 요청이 끊기지 않게. */
  leave(opts: { keepalive?: boolean } = {}): void {
    if (this.timer !== null) { this.o.clearInterval(this.timer); this.timer = null; }
    const slug = this.current;
    if (!slug) return;
    this.current = null;
    void this.o.fetcher(`/api/ain/villages/${enc(slug)}/presence`, { method: 'DELETE', ...(opts.keepalive ? { keepalive: true } : {}) }).catch(() => {});
  }
}
