'use client';

import { useState, useEffect, useCallback } from 'react';
import { useMapData } from '@/providers/MapDataProvider';
import { Agent } from '@/lib/world';
import { useLayer1Collision } from '@/hooks/useLayer1Collision';
import { useBuildStore, useChatStore } from '@/stores';
import { DIRECTION, MAP_TILES, TILE_SIZE, ENABLE_AGENT_MOVEMENT } from '@/constants/game';
import { DEFAULT_AGENTS } from '@/lib/initializeAgents';

export interface AgentInternal extends Agent {
    direction: DIRECTION;
    lastMoved: number;
    moveInterval: number;
    isMoving?: boolean;
    spriteUrl?: string;
    spriteHeight?: number;
    spriteWidth?: number;
}

interface UseAgentsProps {
    playerWorldPosition: { x: number; y: number };
    viewRadius: number;
}

// Cache agent data at module level to prevent repeated API calls
let cachedAgentData: any = null;
let isFetchingAgents = false;
const agentDataCallbacks: ((data: any) => void)[] = [];

export function useAgents({ playerWorldPosition }: UseAgentsProps) {
    const { generateTileAt } = useMapData();
    const { isBlocked: isLayer1Blocked } = useLayer1Collision('/map/land_layer_1.webp');
    const { isBlocked: isBuildStoreBlocked } = useBuildStore();
    const { isAgentLoading } = useChatStore();

    // Create initial agents from DEFAULT_AGENTS configuration
    const createInitialAgents = (): AgentInternal[] => {
        return DEFAULT_AGENTS.map((agent, index) => ({
            id: `agent-${index + 1}`,
            x: agent.x,
            y: agent.y,
            color: agent.color,
            name: '', // Will be loaded from API
            agentUrl: agent.a2aUrl,
            direction: ENABLE_AGENT_MOVEMENT ?
                (agent.behavior === 'random' ? DIRECTION.RIGHT :
                 agent.behavior === 'patrol' ? DIRECTION.UP : DIRECTION.LEFT) :
                DIRECTION.DOWN,
            lastMoved: Date.now(),
            moveInterval: agent.moveInterval,
            behavior: agent.behavior,
            spriteUrl: agent.spriteUrl,
            spriteHeight: agent.spriteHeight,
            spriteWidth: agent.spriteWidth
        }));
    };

    const [agents, setAgents] = useState<AgentInternal[]>(createInitialAgents());

    // Load agent names from API - with caching to prevent repeated calls
    useEffect(() => {
        const loadAgentNames = async () => {
            // If data is already cached, use it immediately
            if (cachedAgentData) {
                setAgents((prevAgents) =>
                    prevAgents.map((agent) => {
                        const apiAgent = cachedAgentData.agents.find((a: { url: string }) => a.url === agent.agentUrl);
                        if (apiAgent && apiAgent.card) {
                            return {
                                ...agent,
                                name: apiAgent.card.name || agent.name
                            };
                        }
                        return agent;
                    })
                );
                return;
            }

            // If already fetching, wait for the result
            if (isFetchingAgents) {
                const callback = (data: any) => {
                    setAgents((prevAgents) =>
                        prevAgents.map((agent) => {
                            const apiAgent = data.agents.find((a: { url: string }) => a.url === agent.agentUrl);
                            if (apiAgent && apiAgent.card) {
                                return {
                                    ...agent,
                                    name: apiAgent.card.name || agent.name
                                };
                            }
                            return agent;
                        })
                    );
                };
                agentDataCallbacks.push(callback);
                return;
            }

            // Start fetching
            isFetchingAgents = true;

            try {
                const response = await fetch('/api/agents');
                if (!response.ok) {
                    console.error('Failed to load agents from API');
                    isFetchingAgents = false;
                    return;
                }

                const data = await response.json();
                if (!data.success || !data.agents) {
                    console.error('Invalid agents data from API');
                    isFetchingAgents = false;
                    return;
                }

                // Cache the data
                cachedAgentData = data;

                // Update agent names from API
                setAgents((prevAgents) =>
                    prevAgents.map((agent) => {
                        const apiAgent = data.agents.find((a: { url: string }) => a.url === agent.agentUrl);
                        if (apiAgent && apiAgent.card) {
                            return {
                                ...agent,
                                name: apiAgent.card.name || agent.name
                            };
                        }
                        return agent;
                    })
                );

                // Notify any waiting callbacks
                agentDataCallbacks.forEach(callback => callback(data));
                agentDataCallbacks.length = 0;

                console.log('✓ Agent names loaded from API');
            } catch (error) {
                console.error('Error loading agents from API:', error);
            } finally {
                isFetchingAgents = false;
            }
        };

        loadAgentNames();
    }, []);

    // Log initialization on mount only
    useEffect(() => {
        console.log('🔄 World agents initialized');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only run once on mount

    const isWalkable = useCallback(
        (x: number, y: number, currentAgents: AgentInternal[], checkingAgentId?: string): boolean => {
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
            if (isLayer1Blocked(x, y)) return false;
            if (isBuildStoreBlocked(x, y)) return false;
            return true;
        },
        [generateTileAt, isLayer1Blocked, isBuildStoreBlocked, playerWorldPosition]
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
            agent: AgentInternal,
            currentAgents: AgentInternal[]
        ): { newX: number; newY: number; newDirection: DIRECTION } => {
            const { x, y, direction, behavior, id } = agent;

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

        setAgents((prevAgents) =>
            prevAgents.map((agent) => {
                // Check if agent is loading (calling Gemini API)
                const isLoading = isAgentLoading(agent.id);

                // If agent is loading, stop movement and keep them in place
                if (isLoading) {
                    return {
                        ...agent,
                        isMoving: false // Stop animation during loading
                    };
                }

                // If agent movement is disabled, keep agents in place with down direction
                if (!ENABLE_AGENT_MOVEMENT) {
                    return {
                        ...agent,
                        direction: DIRECTION.DOWN,
                        isMoving: false
                    };
                }

                // Check if agent is currently in animation state (within 800ms of last move)
                const isCurrentlyAnimating = currentTime - agent.lastMoved < 800;

                if (currentTime - agent.lastMoved < agent.moveInterval) {
                    return {
                        ...agent,
                        isMoving: isCurrentlyAnimating
                    };
                }

                const { newX, newY, newDirection } = getAgentBehavior(agent, prevAgents);

                // Check if agent actually moved
                const didMove = newX !== agent.x || newY !== agent.y;

                return {
                    ...agent,
                    x: newX,
                    y: newY,
                    direction: newDirection,
                    lastMoved: currentTime,
                    isMoving: didMove
                };
            })
        );
    }, [getAgentBehavior, isAgentLoading]);

    const getVisibleAgents = useCallback(() => {
        return agents.map((agent) => ({
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

    const getWorldAgents = useCallback((): Agent[] => {
        return agents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            color: agent.color,
            x: agent.x,
            y: agent.y,
            behavior: agent.behavior,
            agentUrl: agent.agentUrl
        }));
    }, [agents]);

    // Reset agents to initial positions
    const resetAgents = useCallback(() => {
        setAgents(createInitialAgents());
    }, []);

    return {
        agents,
        worldAgents: getWorldAgents(),
        visibleAgents: getVisibleAgents(),
        updateAgents,
        resetAgents
    };
}
