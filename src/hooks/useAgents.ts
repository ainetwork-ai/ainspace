'use client';

import { useEffect, useCallback } from 'react';
import { useMapData } from '@/providers/MapDataProvider';
import { useAgentStore, useBuildStore, useChatStore } from '@/stores';
import { useVillageStore } from '@/stores/useVillageStore';
import { AgentState } from '@/lib/agent';
import { DIRECTION, ENABLE_AGENT_MOVEMENT, MOVEMENT_MODE, SPAWN_RADIUS, DEFAULT_MOVEMENT_MODE } from '@/constants/game';
import { gridToWorldRange } from '@/lib/village-utils';

interface UseAgentsProps {
    playerWorldPosition: { x: number; y: number };
    viewRadius: number;
}

// Cache agent data at module level to prevent repeated API calls
interface CachedAgentData {
    success: boolean;
    agents: Array<{
        url: string;
        card: {
            name: string;
        };
    }>;
}

// let cachedAgentData: CachedAgentData | null = null;
// let isFetchingAgents = false;
// const agentDataCallbacks: ((data: CachedAgentData) => void)[] = [];

export function useAgents({ playerWorldPosition }: UseAgentsProps) {
    const { generateTileAt } = useMapData();
    const { isBlocked: isBuildStoreBlocked } = useBuildStore();
    const { isAgentLoading } = useChatStore();
    const villageIsCollisionAt = useVillageStore((s) => s.isCollisionAt);

    const { agents, setAgents, updateAgent: updateStoredAgent } = useAgentStore();

    // Log initialization on mount only
    useEffect(() => {
        console.log('🔄 World agents initialized');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only run once on mount

    const isWalkable = useCallback(
        (x: number, y: number, currentAgents: AgentState[], checkingAgentId?: string): boolean => {
            // Check player collision
            if (x === playerWorldPosition.x && y === playerWorldPosition.y) {
                return false;
            }

            // Check agent collision
            const isOccupiedByAgent = currentAgents.some(
                (agent) => agent.id !== checkingAgentId && agent.x === x && agent.y === y
            );
            if (isOccupiedByAgent) {
                return false;
            }

            // Check village TMJ collision (includes default map)
            if (villageIsCollisionAt(x, y)) {
                return false;
            }

            // Check build layer collision
            if (isBuildStoreBlocked(x, y)) {
                return false;
            }

            // Check legacy tile type (for backward compatibility)
            const tileType = generateTileAt(x, y);
            if (tileType === 3) return false;

            return true;
        },
        [generateTileAt, isBuildStoreBlocked, playerWorldPosition, villageIsCollisionAt]
    );

    const canAgentMoveTo = useCallback(
        (agent: AgentState, newX: number, newY: number): boolean => {
            const mode = agent.movementMode ?? DEFAULT_MOVEMENT_MODE;

            if (mode === MOVEMENT_MODE.STATIONARY) {
                return false;
            }

            if (mode === MOVEMENT_MODE.SPAWN_CENTERED) {
                const spawnX = agent.spawnX ?? agent.x;
                const spawnY = agent.spawnY ?? agent.y;
                const dx = Math.abs(newX - spawnX);
                const dy = Math.abs(newY - spawnY);
                const distance = Math.max(dx, dy);
                return distance <= SPAWN_RADIUS;
            }

            if (mode === MOVEMENT_MODE.VILLAGE_WIDE) {
                if (!agent.mapName) {
                    return false;
                }

                const vStore = useVillageStore.getState();
                const loaded = vStore.loadedVillages.get(agent.mapName);
                if (!loaded) {
                    return false;
                }

                const m = loaded.metadata;
                const range = gridToWorldRange(m.gridX, m.gridY, m.gridWidth || 1, m.gridHeight || 1);
                return newX >= range.startX && newX <= range.endX && newY >= range.startY && newY <= range.endY;
            }

            return true; // No restriction for other modes
        },
        []
    );

    const updateAgents = useCallback(() => {
        const currentTime = Date.now();

        agents.forEach((agent) => {
            const isLoading = isAgentLoading(agent.id);
            const lastMoved = agent.lastMoved || Date.now();
            const moveInterval = agent.moveInterval || 3000; // 3 seconds

            if (isLoading) {
                updateStoredAgent(agent.agentUrl, { isMoving: false });
                return;
            }

            // If agent movement is disabled, keep agents in place with down direction
            if (!ENABLE_AGENT_MOVEMENT) {
                updateStoredAgent(agent.agentUrl, {
                    direction: DIRECTION.DOWN,
                    isMoving: false
                });
                return;
            }

            // STATIONARY mode agents should not move or change direction
            if (agent.movementMode === MOVEMENT_MODE.STATIONARY) {
                updateStoredAgent(agent.agentUrl, { isMoving: false });
                return;
            }

            // Check if agent is currently in animation state (within 800ms of last move)
            const isCurrentlyAnimating = currentTime - lastMoved < 800;

            if (currentTime - lastMoved < moveInterval) {
                return {
                    ...agent,
                    isMoving: isCurrentlyAnimating
                };
            }

            // Try random direction movement
            const directions = [
                { dx: 0, dy: -1, dir: DIRECTION.UP },
                { dx: 0, dy: 1, dir: DIRECTION.DOWN },
                { dx: -1, dy: 0, dir: DIRECTION.LEFT },
                { dx: 1, dy: 0, dir: DIRECTION.RIGHT }
            ];

            // Shuffle directions for randomness
            const shuffledDirections = [...directions].sort(() => Math.random() - 0.5);

            let newX = agent.x;
            let newY = agent.y;
            let newDirection = agent.direction || DIRECTION.DOWN;

            // Try each direction until a valid move is found
            for (const dir of shuffledDirections) {
                const testX = agent.x + dir.dx;
                const testY = agent.y + dir.dy;

                if (isWalkable(testX, testY, agents, agent.id) &&
                    canAgentMoveTo(agent, testX, testY)) {
                    newX = testX;
                    newY = testY;
                    newDirection = dir.dir;
                    break;
                }
            }

            // Check if agent actually moved
            const didMove = newX !== agent.x || newY !== agent.y;

            updateStoredAgent(agent.agentUrl, {
                x: newX,
                y: newY,
                direction: newDirection,
                lastMoved: currentTime,
                isMoving: didMove
            });
        })

    }, [canAgentMoveTo, isWalkable, isAgentLoading, agents, updateStoredAgent]);

    const getVisibleAgents = useCallback(() => {
        return Object.values(agents).map((agent) => ({
            ...agent,
            x: agent.x,
            y: agent.y,
            screenX: 0,
            screenY: 0,
            direction: agent.direction,
            isMoving: agent.isMoving,
            spriteUrl: agent.spriteUrl,
            spriteHeight: agent.spriteHeight,
            spriteWidth: agent.spriteWidth
        }));
    }, [agents]);

    useEffect(() => {
        const interval = setInterval(updateAgents, 100);
        return () => clearInterval(interval);
    }, [updateAgents]);

    // Reset agents to initial positions
    const resetAgents = useCallback(() => {
        setAgents([]);
    }, []);

    return {
        agents,
        visibleAgents: getVisibleAgents(),
        updateAgents,
        resetAgents
    };
}
