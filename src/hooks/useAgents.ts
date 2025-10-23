'use client';

import { useState, useEffect, useCallback } from 'react';
import { useMapData } from '@/providers/MapDataProvider';
import { Agent } from '@/lib/world';
import { useLayer1Collision } from '@/hooks/useLayer1Collision';
import { useBuildStore } from '@/stores';
import { DIRECTION, MAP_TILES, TILE_SIZE } from '@/constants/game';

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

export function useAgents({ playerWorldPosition }: UseAgentsProps) {
    const { generateTileAt } = useMapData();
    const { isBlocked: isLayer1Blocked } = useLayer1Collision('/map/land_layer_1.png');
    const { isBlocked: isBuildStoreBlocked } = useBuildStore();

    // Initial agent positions near player start location (63, 58)
    const initialAgents: AgentInternal[] = [
        {
            id: 'agent-1',
            x: 58,
            y: 67,
            color: '#00FF00',
            name: 'Explorer Bot',
            direction: DIRECTION.RIGHT,
            lastMoved: Date.now(),
            moveInterval: 800,
            behavior: 'random',
            spriteUrl: '/sprite/sprite_sungryong.png',
            spriteHeight: 86,
            spriteWidth: TILE_SIZE
        },
        {
            id: 'agent-2',
            x: 67,
            y: 49,
            color: '#FF6600',
            name: 'Patrol Bot',
            direction: DIRECTION.UP,
            lastMoved: Date.now(),
            moveInterval: 1000,
            behavior: 'patrol',
            spriteUrl: '/sprite/sprite_unryong.png',
            spriteHeight: 86,
            spriteWidth: TILE_SIZE
        },
        {
            id: 'agent-3',
            x: 82,
            y: 81,
            color: '#9933FF',
            name: 'Wanderer',
            direction: DIRECTION.LEFT,
            lastMoved: Date.now(),
            moveInterval: 600,
            behavior: 'explorer',
            spriteUrl: '/sprite/sprite_horaeng.png',
            spriteHeight: TILE_SIZE,
            spriteWidth: TILE_SIZE
        }
    ];

    const [agents, setAgents] = useState<AgentInternal[]>(initialAgents);

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

    const moveInDirection = (
        x: number,
        y: number,
        direction: DIRECTION
    ): { x: number; y: number } => {
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
    }, [getAgentBehavior]);

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
            behavior: agent.behavior
        }));
    }, [agents]);

    // Reset agents to initial positions
    const resetAgents = useCallback(() => {
        setAgents(initialAgents.map((agent) => ({ ...agent, lastMoved: Date.now() })));
    }, []);

    return {
        agents,
        worldAgents: getWorldAgents(),
        visibleAgents: getVisibleAgents(),
        updateAgents,
        resetAgents
    };
}
