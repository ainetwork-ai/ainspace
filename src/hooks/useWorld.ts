import { useCallback, useEffect, useMemo, useRef } from 'react';
import { World, calculateDistance } from '@/lib/world';
import { useAgentStore, useGameStateStore } from '@/stores';
import { BROADCAST_RADIUS } from '@/constants/game';

export function useWorld() {
    const agents = useAgentStore((s) => s.agents);
    const worldPosition = useGameStateStore((s) => s.worldPosition);
    const worldRef = useRef<World | null>(null);

    // Initialize or update world instance
    useEffect(() => {
        if (!worldRef.current) {
            worldRef.current = new World(agents, worldPosition);
        } else {
            worldRef.current.updateAgents(agents);
            worldRef.current.updatePlayer(worldPosition);
        }
    }, [agents, worldPosition]);

    // Agents within broadcast radius
    const nearbyAgents = useMemo(() => {
        if (!worldPosition) return [];
        return agents.filter((agent) => calculateDistance(agent, worldPosition) <= BROADCAST_RADIUS);
    }, [agents, worldPosition]);

    // Get agent suggestions for autocomplete
    const getAgentSuggestions = useCallback(
        (partialName: string) => {
            if (!worldRef.current) return [];
            return worldRef.current.getAgentSuggestions(partialName);
        },
        []
    );

    // Get all agents
    const getAllAgents = useCallback(() => {
        if (!worldRef.current) return [];
        return worldRef.current.getAllAgents();
    }, []);

    // Get agents within a certain range
    const getAgentsInRange = useCallback((radius?: number) => {
        if (!worldRef.current) return [];
        return worldRef.current.getAgentsInRange(radius);
    }, []);

    return {
        getAgentSuggestions,
        getAllAgents,
        getAgentsInRange,
        nearbyAgents,
        calculateDistance,
    };
}
