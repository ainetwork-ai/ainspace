'use client';

import { useEffect, useRef } from 'react';
import { useAgentStore } from '@/stores';
import { useUserStore } from '@/stores/useUserStore';
import { bffAuthFetch } from '@/lib/backend/bff-fetch';

/**
 * Hydrates each local agent's `backendUuid` from the backend workspace roster.
 *
 * Chat matches a message author (message.senderUserId — the backend user UUID)
 * to the local agent via agent.backendUuid. That field is otherwise only
 * populated for the current user's OWN agents (owner-scoped syncAgentsFromRoster)
 * or agents they created a DM with, so messages from other-owner agents fell
 * back to the unreliable displayName match and showed the default profile.
 *
 * We resolve backendUuid for any agent in the store regardless of owner. Only
 * agents that still lack a backendUuid are requested, and each URL is requested
 * at most once per session, so this stays cheap as villages stream in agents.
 */
export function useAgentBackendUuids(): void {
    const agents = useAgentStore((s) => s.agents);
    const updateAgent = useAgentStore((s) => s.updateAgent);
    const isBackendAuthed = useUserStore((s) => s.isBackendAuthed);

    // URLs already requested (resolved or in-flight) — avoids duplicate fetches.
    const requestedRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        // [UUID-HYDRATE-DEBUG] TEMPORARY (dev experiment)
        console.log('[UUID-HYDRATE] effect run', {
            isBackendAuthed,
            agentCount: agents.length,
            missingBackendUuid: agents.filter((a) => !a.backendUuid).map((a) => a.agentUrl),
        });
        if (!isBackendAuthed) return;

        const pending = agents
            .filter((a) => !a.backendUuid && a.agentUrl && !requestedRef.current.has(a.agentUrl))
            .map((a) => a.agentUrl);
        if (pending.length === 0) return;

        pending.forEach((u) => requestedRef.current.add(u));

        console.log('[UUID-HYDRATE] requesting resolve', pending);
        bffAuthFetch('/api/agents/resolve-uuids', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentUrls: pending }),
        })
            .then((res) => res.json())
            .then((data) => {
                console.log('[UUID-HYDRATE] resolve response', data);
                const resolved: Record<string, string> = data?.resolved ?? {};
                for (const [url, uuid] of Object.entries(resolved)) {
                    if (uuid) updateAgent(url, { backendUuid: uuid });
                }
            })
            .catch((err) => {
                console.log('[UUID-HYDRATE] resolve error', err);
                // Allow a retry on the next agents/auth change.
                pending.forEach((u) => requestedRef.current.delete(u));
            });
    }, [agents, isBackendAuthed, updateAgent]);
}
