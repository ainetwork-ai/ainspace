import { useMemo } from 'react';
import { useAgentStore, useGameStateStore } from '@/stores';
import { calculateDistance } from '@/lib/utils';
import { BROADCAST_RADIUS } from '@/constants/game';

export function useNearbyAgents() {
    const agents = useAgentStore((s) => s.agents);
    const worldPosition = useGameStateStore((s) => s.worldPosition);

    return useMemo(() => {
        if (!worldPosition) return [];
        return agents.filter((a) => calculateDistance(a, worldPosition) <= BROADCAST_RADIUS);
    }, [agents, worldPosition]);
}
