import { NextRequest, NextResponse } from 'next/server';
import { getAgents, setAgentBackendUuid } from '@/lib/redis';
import { generateAgentComboId } from '@/lib/hash';
import { Thread } from '@/stores';
import { backendFetch, decodeWorkspaceId, getBearer } from '@/lib/backend/server-client';
import { BackendDmListItem, mapDmToThread } from '@/lib/backend/dm-mapping';
import { resolveAgentUuids } from '@/lib/backend/agent-mapping';

/**
 * GET /api/threads
 * EPIC14: list the user's backend DMs (architecture C — BFF forwards the
 * browser-held Bearer to the new backend server-to-server). Response shape
 * matches the legacy orchestration response so chat UI is unchanged:
 *   { success: true, threads: { [id]: Thread } }
 * Guests (no Bearer) get an empty list — chat now requires wallet login since
 * the orchestration server is being decommissioned.
 */
export async function GET(request: NextRequest) {
    const token = getBearer(request);
    if (!token) {
        return NextResponse.json({ success: true, threads: {} });
    }

    const workspaceId = decodeWorkspaceId(token);
    if (!workspaceId) {
        return NextResponse.json({ error: 'workspaceId missing in token' }, { status: 400 });
    }

    try {
        const res = await backendFetch(
            token,
            `/dm?workspaceId=${encodeURIComponent(workspaceId)}`,
        );
        if (!res.ok) {
            const body = await res.text();
            return new NextResponse(body, {
                status: res.status,
                headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
            });
        }
        const list = (await res.json()) as BackendDmListItem[];
        const entries = await Promise.all(
            list.map(async (dm) => [dm.id, await mapDmToThread(dm)] as const),
        );
        return NextResponse.json({
            success: true,
            threads: Object.fromEntries(entries),
        });
    } catch (error) {
        console.error('Error listing backend DMs:', error);
        return NextResponse.json({ error: 'Failed to get threads' }, { status: 500 });
    }
}

/**
 * POST /api/threads
 * EPIC15: create (or reuse) a backend DM for the given agents and return the
 * server-owned Thread. Body: { agentUrls: string[] }.
 *
 * Flow: resolve each a2aUrl → backend user UUID (cached on StoredAgent, else
 * looked up via GET /agents and backfilled), then POST /dm { workspaceId,
 * userIds }. Backend keeps a single DM per identical member set (idempotent),
 * so the returned id is reused for the same agent combination.
 */
export async function POST(request: NextRequest) {
    const token = getBearer(request);
    if (!token) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const workspaceId = decodeWorkspaceId(token);
    if (!workspaceId) {
        return NextResponse.json({ error: 'workspaceId missing in token' }, { status: 400 });
    }

    try {
        const body = await request.json();
        const agentUrls: string[] = Array.isArray(body?.agentUrls) ? body.agentUrls : [];
        if (agentUrls.length === 0) {
            return NextResponse.json({ error: 'agentUrls is required' }, { status: 400 });
        }

        // Load the stored agents for these urls (source for names + cached uuids).
        const allAgents = await getAgents();
        const agents = allAgents.filter((a) => agentUrls.includes(a.url));
        // TEMP diagnostic (EPIC15): why does the internal url filter match 0?
        console.log('[POST /api/threads] agentUrls (from browser):', agentUrls);
        console.log('[POST /api/threads] redis StoredAgent urls:', allAgents.map((a) => a.url));
        console.log('[POST /api/threads] matched StoredAgents:', agents.length);
        const nameByUrl = new Map<string, string>();
        for (const a of agents) nameByUrl.set(a.url, a.card?.name ?? '');

        // Cached (backendUuid present) vs needing resolution.
        const cached = agents.filter((a) => a.backendUuid);
        const uncached = agents.filter((a) => !a.backendUuid);

        const uuids: string[] = cached.map((a) => a.backendUuid as string);
        const resolvedUrls: string[] = cached.map((a) => a.url);

        if (uncached.length > 0) {
            const { resolved } = await resolveAgentUuids(
                token,
                workspaceId,
                uncached.map((a) => a.url),
            );
            for (const { url, uuid } of resolved) {
                uuids.push(uuid);
                resolvedUrls.push(url);
                // Best-effort backfill (progressive migration) — never blocks creation.
                await setAgentBackendUuid(url, uuid);
            }
        }

        if (uuids.length === 0) {
            return NextResponse.json({ error: 'no_resolvable_agents' }, { status: 422 });
        }

        // Create (or reuse — backend idempotent on member set) the DM.
        const dmRes = await backendFetch(token, '/dm', {
            method: 'POST',
            body: JSON.stringify({ workspaceId, userIds: uuids }),
        });
        if (!dmRes.ok) {
            const errBody = await dmRes.text();
            return new NextResponse(errBody, {
                status: dmRes.status,
                headers: { 'Content-Type': dmRes.headers.get('content-type') ?? 'application/json' },
            });
        }
        const dm = (await dmRes.json()) as { id: string };

        // Assemble the Thread from resolved agent names; the DM id is the source of truth.
        const agentNames = resolvedUrls.map((u) => nameByUrl.get(u) ?? '').filter(Boolean);
        const sortedNames = [...agentNames].sort();
        const threadName = sortedNames.join(', ').replace(/[^a-z0-9가-힣\s,]/gi, '');
        const agentComboId = sortedNames.length > 0 ? await generateAgentComboId(sortedNames) : '';
        const now = new Date().toISOString();
        const thread: Thread = {
            id: dm.id,
            threadName,
            agentNames,
            agentComboId,
            createdAt: now,
            lastMessageAt: now,
            hasUnplacedAgents: false,
        };

        return NextResponse.json({ success: true, thread });
    } catch (error) {
        console.error('Error creating backend DM:', error);
        return NextResponse.json({ error: 'Failed to create thread' }, { status: 500 });
    }
}
