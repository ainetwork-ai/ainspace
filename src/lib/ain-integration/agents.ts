/**
 * Ainize → "나에게 공유된 에이전트" 어댑터 (어댑터 사양 §원본 호출·에이전트).
 *
 * 우선: `GET {AINIZE_URL}/api/shared-agents?scope=` (선택적 Bearer 세션) — 계약 모양 그대로.
 * 404 이면 fallback: `GET /api/info` (`node.agents[]`) + `GET /api/hosted-agents` (`agents[]`) 를
 * AgentRef 로 변환한다. hosted 가 같은 id 의 info 항목보다 우선한다(더 풍부한 행).
 *
 * 순수 함수 + fetch 주입. 세션 토큰은 헤더로만 나간다.
 */
import { getJson, getNativeSupport, isNotFound, paginate, qs, setNativeSupport, type FetchLike } from './http';
import {
  AIN_CONTRACT_VERSION, isAgentListResponse,
  type AgentListRequest, type AgentListResponse, type AgentRef, type UiCapability,
} from './types';

export interface AinizeHostedAgentRow {
  id: string; name: string; description?: string; owner?: string; version?: number | string;
  status?: 'building' | 'ready' | 'failed' | string; a2a_url: string; card_url?: string; updated_at?: number | string;
  visibility?: 'public' | 'org' | 'private' | 'unlisted'; org_id?: string | null;
  skills?: { id: string; name: string; description?: string; examples?: string[] }[];
  a2ui?: boolean; media?: { transcription?: boolean; image?: boolean };
}
/** `/api/info.agents[]` 행: `url` 만 있고 card_url 은 없다. */
export interface AinizeInfoAgentRow {
  id: string; name: string; description?: string;
  url?: string; a2a_url?: string; card_url?: string; reachable?: boolean;
  skills?: string[]; protocols?: string[]; extensions?: string[];
}
export interface AinizeInfo { node?: { address?: string; endpoint?: string; agents?: AinizeInfoAgentRow[] } }

export interface AgentsSourceOptions {
  ainizeUrl: string;
  /** Ainize 세션(있을 때만). 없으면 public 범위만 의미 있다. */
  sessionToken?: string | null;
  fetch?: FetchLike;
  now?: () => Date;
}

const A2UI_EXT_PREFIX = 'https://a2ui.org/a2a-extension/a2ui/';
const cardUrlFor = (endpoint: string) => `${endpoint.replace(/\/$/, '')}/.well-known/agent-card.json`;
const toIso = (v: number | string | undefined, fallback: Date) => {
  if (v === undefined || v === null || v === '') return fallback.toISOString();
  const d = typeof v === 'number' ? new Date(v) : new Date(v);
  return Number.isNaN(d.getTime()) ? fallback.toISOString() : d.toISOString();
};

export function hostedAgentToRef(issuer: string, nodeAddress: string, row: AinizeHostedAgentRow, now = new Date()): AgentRef {
  const caps: UiCapability[] = ['streaming', 'cancel'];
  if (row.a2ui) caps.push('a2ui_basic');
  if (row.media?.transcription) caps.push('audio_in');
  if (row.media?.image) caps.push('image_out');
  const orgRef = row.visibility === 'org' && row.org_id ? { orgRef: { kind: 'org' as const, issuer, subject: row.org_id } } : {};
  const version = row.version === undefined || row.version === null || row.version === '' ? 'upstream' : `v${row.version}`;
  return {
    contract: AIN_CONTRACT_VERSION,
    registryIssuer: issuer,
    agentId: row.id,
    releaseId: version,
    ownerRef: { kind: 'wallet', issuer, subject: (row.owner ?? nodeAddress).toLowerCase() },
    visibility: row.visibility ?? 'public',
    ...orgRef,
    agentCardUrl: row.card_url ?? cardUrlFor(row.a2a_url),
    endpoint: row.a2a_url,
    supportedProtocolVersions: ['0.3.0'],
    skills: (row.skills ?? []).map((s) => ({ id: s.id, name: s.name, ...(s.description ? { description: s.description } : {}), ...(s.examples ? { examples: s.examples } : {}) })),
    inputModes: ['text/plain', ...(row.media?.transcription ? ['audio/*'] : [])],
    outputModes: ['text/plain', ...(row.a2ui ? ['application/a2ui+json'] : []), ...(row.media?.image ? ['image/*'] : [])],
    uiCapabilities: caps,
    status: row.status === 'ready' ? 'active' : row.status === 'failed' ? 'stopped' : 'disabled',
    displayName: row.name,
    ...(row.description ? { description: row.description } : {}),
    updatedAt: toIso(row.updated_at, now),
  };
}

/** `/api/info.agents[]` 행 → AgentRef. 엔드포인트가 없으면 null (목록에서 뺀다). */
export function infoAgentToRef(issuer: string, nodeAddress: string, row: AinizeInfoAgentRow, now = new Date()): AgentRef | null {
  const endpoint = row.a2a_url ?? row.url;
  if (!endpoint || !row.id || !row.name) return null;
  const a2ui = (row.extensions ?? []).some((e) => e.startsWith(A2UI_EXT_PREFIX));
  return {
    contract: AIN_CONTRACT_VERSION,
    registryIssuer: issuer,
    agentId: row.id,
    releaseId: 'upstream',
    ownerRef: { kind: 'wallet', issuer, subject: nodeAddress.toLowerCase() },
    visibility: 'public',
    agentCardUrl: row.card_url ?? cardUrlFor(endpoint),
    endpoint,
    supportedProtocolVersions: row.protocols?.length ? row.protocols : ['0.3.0'],
    skills: (row.skills ?? []).map((name, i) => ({ id: `skill-${i + 1}`, name })),
    inputModes: ['text/plain'],
    outputModes: ['text/plain', ...(a2ui ? ['application/a2ui+json'] : [])],
    uiCapabilities: ['streaming', ...(a2ui ? (['a2ui_basic'] as UiCapability[]) : [])],
    status: row.reachable ? 'active' : 'stopped',
    displayName: row.name,
    ...(row.description ? { description: row.description } : {}),
    updatedAt: now.toISOString(),
  };
}

export async function listSharedAgents(opts: AgentsSourceOptions, req: AgentListRequest): Promise<AgentListResponse> {
  const f = opts.fetch ?? fetch;
  const issuer = opts.ainizeUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = opts.sessionToken ? { authorization: `Bearer ${opts.sessionToken}` } : {};
  const nativeKey = `agents:${issuer}`;

  if (getNativeSupport(nativeKey) !== false) {
    try {
      const r = await getJson<unknown>(f, `${issuer}/api/shared-agents${qs({ scope: req.scope, q: req.q, cursor: req.cursor, limit: req.limit, org: req.org })}`, headers);
      if (isAgentListResponse(r)) { setNativeSupport(nativeKey, true); return r; }
      setNativeSupport(nativeKey, false);
    } catch (e) {
      if (isNotFound(e)) setNativeSupport(nativeKey, false); else throw e;
    }
  }
  return listFromNode(f, issuer, headers, req, opts);
}

async function listFromNode(f: FetchLike, issuer: string, headers: Record<string, string>, req: AgentListRequest, opts: AgentsSourceOptions): Promise<AgentListResponse> {
  const now = (opts.now ?? (() => new Date()))();
  const asOf = now.toISOString();
  if (req.scope === 'shared_with_org') return { contract: AIN_CONTRACT_VERSION, asOf, nextCursor: null, items: [] };

  const info = await getJson<AinizeInfo>(f, `${issuer}/api/info`);
  const nodeAddress = info.node?.address ?? 'unknown';
  const hosted = await getJson<{ agents?: AinizeHostedAgentRow[] }>(f, `${issuer}/api/hosted-agents${req.scope === 'mine' ? '?mine=1' : ''}`, headers);

  const hostedRefs = (hosted.agents ?? []).filter((a) => a.id && a.name && a.a2a_url).map((a) => hostedAgentToRef(issuer, nodeAddress, a, now));
  const hostedIds = new Set(hostedRefs.map((r) => r.agentId));
  // info.agents 에도 hosted 가 reachable upstream 으로 함께 실린다 — hosted 행이 더 풍부하니 그쪽이 이긴다.
  const proxied = req.scope === 'mine'
    ? []
    : (info.node?.agents ?? []).map((a) => infoAgentToRef(issuer, nodeAddress, a, now)).filter((r): r is AgentRef => !!r && !hostedIds.has(r.agentId));

  let refs = [...hostedRefs, ...proxied];
  if (req.q) { const q = req.q.toLowerCase(); refs = refs.filter((r) => r.displayName.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)); }
  refs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.agentId.localeCompare(b.agentId)));
  const { page, nextCursor } = paginate(refs, req.cursor, req.limit);
  return { contract: AIN_CONTRACT_VERSION, asOf, nextCursor, items: page.map((ref) => ({ ref, canInvoke: ref.status === 'active' })) };
}
