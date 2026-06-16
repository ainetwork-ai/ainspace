import { NextRequest, NextResponse } from 'next/server';
import { getBearer, decodeUserId } from '@/lib/backend/server-client';
import { BACKEND_WORKSPACE_ID, isBackendWorkspaceConfigured } from '@/lib/backend/config';
import { fetchWorkspaceAgents } from '@/lib/backend/agent-mapping';
import { getAgents, getAgentsSyncedAt, setAgentsSyncedAt, syncAgentsFromRoster } from '@/lib/redis';

/**
 * GET /api/agents/sync?address=<wallet>&refresh=<0|1>
 * EPIC16: read-through sync of the backend workspace agent roster into Redis.
 *
 * When stale (>30min since last sync) or `refresh=1`, pulls the roster, keeps the
 * caller's owned agents (agentInvitedBy === token `sub`), materializes them as
 * StoredAgents (creating defaults for new ones, marking roster-absent ones
 * disabled), then always returns the caller's StoredAgents. Placement/coords/full
 * card stay in Redis (untouched). Mirrors the DM BFF merge pattern.
 *
 * Degrades gracefully: if the backend isn't configured or the pull fails, the
 * caller's existing Redis agents are still returned (AgentTab keeps working).
 */
export async function GET(request: NextRequest) {
    const token = getBearer(request);
    if (!token) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const wallet = request.nextUrl.searchParams.get('address');
    if (!wallet) {
        return NextResponse.json({ error: 'address is required' }, { status: 400 });
    }

    const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
    const myUserId = decodeUserId(token);
    // Freshness is driven by the marker's TTL: absent (0) => a pull is due.
    const stale = (await getAgentsSyncedAt(wallet)) === 0;

    // Pull + reconcile only when configured, identified, and due. On any failure
    // we fall through to serving the existing Redis agents (degrade) without
    // bumping the marker, so the next call retries.
    if (isBackendWorkspaceConfigured() && myUserId && (forceRefresh || stale)) {
        try {
            const roster = await fetchWorkspaceAgents(token, BACKEND_WORKSPACE_ID);
            // Scope to agents this user owns (canonical owner = agentInvitedBy).
            const mine = roster.filter((a) => a.agentInvitedBy === myUserId);
            const synced = await syncAgentsFromRoster(wallet, mine);
            await setAgentsSyncedAt(wallet, Date.now());
            return NextResponse.json({ success: true, agents: synced });
        } catch (error) {
            console.error('Agent roster sync failed:', error);
        }
    }

    const agents = (await getAgents()).filter((a) => a.creator === wallet);
    return NextResponse.json({ success: true, agents });
}
