import { backendFetch } from './server-client';

// EPIC15: resolve ainspace agent a2aUrls to backend user UUIDs.
// `POST /dm` expects member UUIDs (backend `users.id`), but ainspace only knows
// agents by their a2aUrl. We look them up in `GET /agents?workspaceId=` and
// match by a2a url. Field name / URL normalization is defensive.
// EPIC16: the same roster fetch backs agent list sync (see fetchWorkspaceAgents).

export interface BackendAgentListItem {
  id: string;
  displayName?: string;
  isAgent?: boolean;
  a2aUrl?: string | null;
  a2aId?: string | null;
  agentCardJson?: { url?: string } | null;
  // EPIC16 (agent list sync): ownership / availability / avatar.
  agentInvitedBy?: string | null; // canonical owner (backend user id)
  status?: string; // availability; non-active => disabled in ainspace
  avatarUrl?: string | null;
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
export function itemA2aUrl(item: BackendAgentListItem): string | null {
  return item.a2aUrl ?? item.a2aId ?? item.agentCardJson?.url ?? null;
}

// EPIC16: fetch the workspace agent roster. Accepts either a bare array or a
// wrapped envelope ({agents|data|items: [...]}). Throws on non-2xx so callers
// can degrade (keep showing cached/local agents).
export async function fetchWorkspaceAgents(
  token: string,
  workspaceId: string,
): Promise<BackendAgentListItem[]> {
  const path = `/agents?workspaceId=${encodeURIComponent(workspaceId)}`;
  const res = await backendFetch(token, path);
  const raw = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`GET /agents failed: ${res.status} ${raw}`);
  }

  let parsed: unknown = [];
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    parsed = [];
  }
  return Array.isArray(parsed)
    ? (parsed as BackendAgentListItem[])
    : ((parsed as { agents?: BackendAgentListItem[] })?.agents
      ?? (parsed as { data?: BackendAgentListItem[] })?.data
      ?? (parsed as { items?: BackendAgentListItem[] })?.items
      ?? []);
}

export async function resolveAgentUuids(
  token: string,
  workspaceId: string,
  agentUrls: string[],
): Promise<ResolveAgentUuidsResult> {
  const list = await fetchWorkspaceAgents(token, workspaceId);

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

  return { resolved, unresolved };
}
