import { NextRequest, NextResponse } from 'next/server';
import { getBearer } from '@/lib/backend/server-client';
import { resolveAgentUuids } from '@/lib/backend/agent-mapping';
import { BACKEND_WORKSPACE_ID, isBackendWorkspaceConfigured } from '@/lib/backend/config';

/**
 * POST /api/agents/resolve-uuids
 * Body: { agentUrls: string[] }
 * Response: { success: true, resolved: { [agentUrl]: backendUuid } }
 *
 * Resolves a2a agent URLs to their backend user UUIDs from the workspace roster
 * (`GET /agents?workspaceId=`, server-to-server). The chat matches a message
 * author (message.senderUserId — the backend UUID) to the local agent by
 * agent.backendUuid; the local store only knows agents by a2aUrl, so this lets
 * the client hydrate backendUuid for ANY workspace agent (not just owned ones,
 * which are the only ones the owner-scoped syncAgentsFromRoster ever populates).
 *
 * Response is bounded to the requested URLs (the backend roster fetch is a
 * single server-side call regardless), and the client only asks for agents that
 * still lack a backendUuid, so this stays cheap.
 */
export async function POST(request: NextRequest) {
    const token = getBearer(request);
    if (!token) {
        return NextResponse.json({ success: true, resolved: {} });
    }
    if (!isBackendWorkspaceConfigured()) {
        return NextResponse.json({ error: 'BACKEND_WORKSPACE_ID is not configured' }, { status: 500 });
    }

    try {
        const body = await request.json().catch(() => ({}));
        const agentUrls: unknown = body?.agentUrls;
        if (!Array.isArray(agentUrls) || agentUrls.length === 0) {
            return NextResponse.json({ success: true, resolved: {} });
        }

        const urls = agentUrls.filter((u): u is string => typeof u === 'string' && u.length > 0);
        const { resolved } = await resolveAgentUuids(token, BACKEND_WORKSPACE_ID, urls);

        const map: Record<string, string> = {};
        for (const { url, uuid } of resolved) map[url] = uuid;
        return NextResponse.json({ success: true, resolved: map });
    } catch (error) {
        console.error('Error resolving agent uuids:', error);
        // Degrade gracefully — chat falls back to name matching.
        return NextResponse.json({ success: true, resolved: {} });
    }
}
