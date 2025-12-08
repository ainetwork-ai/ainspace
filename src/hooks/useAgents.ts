'use client';

import { useEffect, useCallback } from 'react';
import { useMapData } from '@/providers/MapDataProvider';
import { useAgentStore, useBuildStore, useChatStore } from '@/stores';
import { AgentState } from '@/lib/agent';
import { DIRECTION, MAP_TILES, ENABLE_AGENT_MOVEMENT } from '@/constants/game';

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
    // FIXME(yoojin): check collision for agent movement
    const { isBlocked: isBuildStoreBlocked } = useBuildStore();
    const { isAgentLoading } = useChatStore();

    const { agents, setAgents, updateAgent: updateStoredAgent } = useAgentStore();

    // Log initialization on mount only
    useEffect(() => {
        console.log('🔄 World agents initialized');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only run once on mount

    const isWalkable = useCallback(
        (x: number, y: number, currentAgents: AgentState[], checkingAgentId?: string): boolean => {
            if (x < 0 || x >= MAP_TILES || y < 0 || y >= MAP_TILES) {
                return false;
            }

            if (x === playerWorldPosition.x && y === playerWorldPosition.y) {
                return false;
            }

            const isOccupiedByAgent = currentAgents.some(
                (agent) => agent.id !== checkingAgentId && agent.x === x && agent.y === y
            );
            if (isOccupiedByAgent) {
                return false;
            }

            const tileType = generateTileAt(x, y);
            if (tileType === 3) return false;
            if (isBuildStoreBlocked(x, y)) return false;
            return true;
        },
        [generateTileAt, isBuildStoreBlocked, playerWorldPosition]
    );

    const getRandomDirection = (): DIRECTION => {
        const directions = [DIRECTION.UP, DIRECTION.DOWN, DIRECTION.LEFT, DIRECTION.RIGHT] as const;
        return directions[Math.floor(Math.random() * directions.length)];
    };

    const moveInDirection = (x: number, y: number, direction: DIRECTION): { x: number; y: number } => {
        switch (direction) {
            case DIRECTION.UP:
                return { x, y: y - 1 };
            case DIRECTION.DOWN:
                return { x, y: y + 1 };
            case DIRECTION.LEFT:
                return { x: x - 1, y };
            case DIRECTION.RIGHT:
                return { x: x + 1, y };
            default:
                return { x, y };
        }
    };

    const getAgentBehavior = useCallback(
        (
            agent: AgentState,
            currentAgents: AgentState[]
        ): { newX: number; newY: number; newDirection: DIRECTION } => {
            const { x, y, direction = DIRECTION.DOWN, behavior, id } = agent;

            switch (behavior) {
                case 'random': {
                    const shouldChangeDirection = Math.random() < 0.3;
                    const newDirection = shouldChangeDirection ? getRandomDirection() : direction;
                    const newPos = moveInDirection(x, y, newDirection);

                    if (isWalkable(newPos.x, newPos.y, currentAgents, id)) {
                        return { newX: newPos.x, newY: newPos.y, newDirection };
                    }

                    const altDirection = getRandomDirection();
                    const altPos = moveInDirection(x, y, altDirection);
                    if (isWalkable(altPos.x, altPos.y, currentAgents, id)) {
                        return { newX: altPos.x, newY: altPos.y, newDirection: altDirection };
                    }

                    return { newX: x, newY: y, newDirection: getRandomDirection() };
                }

                case 'patrol': {
                    const newPos = moveInDirection(x, y, direction);

                    if (isWalkable(newPos.x, newPos.y, currentAgents, id)) {
                        return { newX: newPos.x, newY: newPos.y, newDirection: direction };
                    }

                    const clockwiseDirections = {
                        [DIRECTION.UP]: DIRECTION.RIGHT,
                        [DIRECTION.RIGHT]: DIRECTION.DOWN,
                        [DIRECTION.DOWN]: DIRECTION.LEFT,
                        [DIRECTION.LEFT]: DIRECTION.UP
                    };
                    const newDirection = clockwiseDirections[direction as keyof typeof clockwiseDirections];
                    const turnPos = moveInDirection(x, y, newDirection);

                    if (isWalkable(turnPos.x, turnPos.y, currentAgents, id)) {
                        return { newX: turnPos.x, newY: turnPos.y, newDirection };
                    }

                    return { newX: x, newY: y, newDirection };
                }

                case 'explorer': {
                    const playerDistance = Math.abs(x - playerWorldPosition.x) + Math.abs(y - playerWorldPosition.y);

                    if (playerDistance < 3) {
                        const awayFromPlayerDirections: DIRECTION[] = [];
                        if (x < playerWorldPosition.x) awayFromPlayerDirections.push(DIRECTION.LEFT);
                        if (x > playerWorldPosition.x) awayFromPlayerDirections.push(DIRECTION.RIGHT);
                        if (y < playerWorldPosition.y) awayFromPlayerDirections.push(DIRECTION.UP);
                        if (y > playerWorldPosition.y) awayFromPlayerDirections.push(DIRECTION.DOWN);

                        for (const dir of awayFromPlayerDirections) {
                            const pos = moveInDirection(x, y, dir);
                            if (isWalkable(pos.x, pos.y, currentAgents, id)) {
                                return { newX: pos.x, newY: pos.y, newDirection: dir };
                            }
                        }
                    }

                    const newDirection = Math.random() < 0.7 ? direction : getRandomDirection();
                    const newPos = moveInDirection(x, y, newDirection);

                    if (isWalkable(newPos.x, newPos.y, currentAgents, id)) {
                        return { newX: newPos.x, newY: newPos.y, newDirection };
                    }

                    return { newX: x, newY: y, newDirection: getRandomDirection() };
                }

                default:
                    return { newX: x, newY: y, newDirection: direction };
            }
        },
        [isWalkable, playerWorldPosition]
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

            // Check if agent is currently in animation state (within 800ms of last move)
            const isCurrentlyAnimating = currentTime - lastMoved < 800;

            if (currentTime - lastMoved < moveInterval) {
                return {
                    ...agent,
                    isMoving: isCurrentlyAnimating
                };
            }

            const { newX, newY, newDirection } = getAgentBehavior(agent, agents);

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

    }, [getAgentBehavior, isAgentLoading, agents, updateStoredAgent]);

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
