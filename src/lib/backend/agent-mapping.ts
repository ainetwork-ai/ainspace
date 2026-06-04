import { backendFetch } from './server-client';

// EPIC15: resolve ainspace agent a2aUrls to backend user UUIDs.
// `POST /dm` expects member UUIDs (backend `users.id`), but ainspace only knows
// agents by their a2aUrl. We look them up in `GET /agents?workspaceId=` and
// match by a2a url. Field name / URL normalization is unverified against a live
// backend yet (see EPIC15 background) so matching is defensive.

export interface BackendAgentListItem {
  id: string;
  displayName?: string;
  isAgent?: boolean;
  a2aUrl?: string | null;
  a2aId?: string | null;
  agentCardJson?: { url?: string } | null;
}

export interface ResolveAgentUuidsResult {
  resolved: { url: string; uuid: string }[];
  unresolved: string[];
}

// Normalize an a2a URL for comparison: lowercase, strip trailing slash, and
// drop a trailing `/.well-known/agent.json` (cards may be advertised either way).
export function normalizeA2aUrl(url: string): string {
  let u = (url ?? '').trim().toLowerCase();
  u = u.replace(/\/\.well-known\/agent\.json$/, '');
  u = u.replace(/\/+$/, '');
  return u;
}

// Pick whichever field carries the agent's a2a url (field name unverified).
function itemA2aUrl(item: BackendAgentListItem): string | null {
  return item.a2aUrl ?? item.a2aId ?? item.agentCardJson?.url ?? null;
}

export async function resolveAgentUuids(
  token: string,
  workspaceId: string,
  agentUrls: string[],
): Promise<ResolveAgentUuidsResult> {
  const path = `/agents?workspaceId=${encodeURIComponent(workspaceId)}`;
  const res = await backendFetch(token, path);
  const raw = await res.text().catch(() => '');

  // TEMP diagnostic (EPIC15 ①): full backend response (status + raw body).
  console.log(`[resolveAgentUuids] GET ${path} -> ${res.status}`);
  console.log('[resolveAgentUuids] raw response body:', raw);

  if (!res.ok) {
    throw new Error(`GET /agents failed: ${res.status} ${raw}`);
  }

  // Accept either a bare array or a wrapped envelope ({agents|data|items: [...]}).
  let parsed: unknown = [];
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    parsed = [];
  }
  const list: BackendAgentListItem[] = Array.isArray(parsed)
    ? (parsed as BackendAgentListItem[])
    : ((parsed as { agents?: BackendAgentListItem[]; data?: BackendAgentListItem[]; items?: BackendAgentListItem[] })?.agents
      ?? (parsed as { data?: BackendAgentListItem[] })?.data
      ?? (parsed as { items?: BackendAgentListItem[] })?.items
      ?? []);

  console.log('[resolveAgentUuids] parsed item count:', list.length);
  console.log('[resolveAgentUuids] requested (normalized):',
    agentUrls.map((u) => normalizeA2aUrl(u)));

  // Map normalized backend a2a url -> uuid for O(1) lookup.
  const byNormUrl = new Map<string, string>();
  for (const item of list) {
    const a2a = itemA2aUrl(item);
    if (a2a && item.id) byNormUrl.set(normalizeA2aUrl(a2a), item.id);
  }

  const resolved: { url: string; uuid: string }[] = [];
  const unresolved: string[] = [];
  for (const url of agentUrls) {
    const uuid = byNormUrl.get(normalizeA2aUrl(url));
    if (uuid) resolved.push({ url, uuid });
    else unresolved.push(url);
  }

  if (unresolved.length > 0) {
    console.warn('[resolveAgentUuids] unresolved agent urls:', unresolved);
  }

  return { resolved, unresolved };
}
