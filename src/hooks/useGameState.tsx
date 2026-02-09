'use client';

import { useEffect, useCallback } from 'react';
import { useMapData } from '@/providers/MapDataProvider';
import { useAgents } from '@/hooks/useAgents';
import { useBuildStore, useGameStateStore, useAgentStore, useUserStore } from '@/stores';
import { useVillageStore } from '@/stores/useVillageStore';
import {
    MAP_WIDTH,
    MAP_HEIGHT,
    VIEW_RADIUS,
    DIRECTION,
    INITIAL_PLAYER_POSITION,
    MIN_MOVE_INTERVAL
} from '@/constants/game';

interface Position {
    x: number;
    y: number;
}

export function useGameState() {
    const { getMapData, generateTileAt } = useMapData();
    const userId = useUserStore((state) => state.getUserId());
    const { isBlocked: isLayer1Blocked, collisionMap } = useBuildStore();
    const { agents: a2aAgents } = useAgentStore();
    const isCollisionAt = useVillageStore((s) => s.isCollisionAt);
    const {
        worldPosition,
        setWorldPosition,
        isLoading,
        setIsLoading,
        isAutonomous,
        setIsAutonomous,
        playerDirection,
        setPlayerDirection,
        recentMovements,
        setRecentMovements,
        lastCommentary,
        setLastCommentary,
        lastMoveTime,
        setLastMoveTime,
        isPlayerMoving,
        setIsPlayerMoving
    } = useGameStateStore();

    // Get the current map data centered on the player's world position with full square view
    const mapData = getMapData(worldPosition.x, worldPosition.y, MAP_WIDTH, MAP_HEIGHT);

    // Player is always in the center of the visible map
    const playerPosition = {
        x: Math.floor(MAP_WIDTH / 2),
        y: Math.floor(MAP_HEIGHT / 2)
    };

    // Initialize agents system
    const { agents, visibleAgents, resetAgents } = useAgents({
        playerWorldPosition: worldPosition,
        viewRadius: VIEW_RADIUS
    });

    const savePositionToRedis = useCallback(
        async (position: Position) => {
            if (!userId) return;
            try {
                await fetch('/api/position', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        userId,
                        position: position
                    })
                });
            } catch (error) {
                console.error('Failed to save position:', error);
            }
        },
        [userId]
    );

    /**
     * 주어진 좌표로 이동 가능한지 검사한다.
     * - 마을 TMJ Layer1 충돌 (isCollisionAt) - 마을이 없으면 default map 사용
     * - 빌드 layer1 충돌 (isLayer1Blocked)
     * - 에이전트 충돌
     */
    const isPositionBlocked = useCallback(
        (x: number, y: number): boolean => {
            // 마을 TMJ 또는 default map 충돌 체크
            // (마을이 없으면 isCollisionAt이 default map 기준으로 체크 = 충돌 없음)
            if (isCollisionAt(x, y)) return true;

            // 빌드 layer1 충돌
            if (isLayer1Blocked(x, y)) return true;

            // 에이전트 충돌
            const occupiedByWorldAgent = agents.some(
                (agent) => agent.x === x && agent.y === y
            );
            if (occupiedByWorldAgent) return true;

            const occupiedByA2AAgent = Object.values(a2aAgents).some(
                (agent) => agent.x === x && agent.y === y
            );
            if (occupiedByA2AAgent) return true;

            return false;
        },
        [isCollisionAt, isLayer1Blocked, agents, a2aAgents]
    );

    const movePlayer = useCallback(
        (direction: DIRECTION) => {
            // Check if enough time has passed since last move (prevent double movement)
            const now = Date.now();
            const timeSinceLastMove = now - lastMoveTime;
            if (timeSinceLastMove < MIN_MOVE_INTERVAL) {
                return;
            }

            // Update player direction immediately
            setPlayerDirection(direction);

            const newWorldPosition = { ...worldPosition };
            switch (direction) {
                case DIRECTION.UP:
                    newWorldPosition.y -= 1;
                    break;
                case DIRECTION.DOWN:
                    newWorldPosition.y += 1;
                    break;
                case DIRECTION.LEFT:
                    newWorldPosition.x -= 1;
                    break;
                case DIRECTION.RIGHT:
                    newWorldPosition.x += 1;
                    break;
                default:
                    break;
            }

            // Village-based collision check
            if (isPositionBlocked(newWorldPosition.x, newWorldPosition.y)) {
                return;
            }

            // Save new position to Redis
            savePositionToRedis(newWorldPosition);

            // Position changed - trigger animation
            setLastMoveTime(Date.now());
            setIsPlayerMoving(true);

            setWorldPosition(newWorldPosition);

            // Track recent movements
            setRecentMovements([direction, ...recentMovements.slice(0, 4)]);
        },
        [worldPosition, recentMovements, isPositionBlocked, savePositionToRedis, lastMoveTime, setPlayerDirection, setIsPlayerMoving, setLastMoveTime, setRecentMovements, setWorldPosition]
    );

    const toggleAutonomous = useCallback(() => {
        setIsAutonomous(!isAutonomous);
    }, []);

    // Reset player location to initial position
    const resetLocation = useCallback(() => {
        setWorldPosition(INITIAL_PLAYER_POSITION);
        savePositionToRedis(INITIAL_PLAYER_POSITION);
        setPlayerDirection(DIRECTION.RIGHT);
        setRecentMovements([]);
        setIsPlayerMoving(false);
        resetAgents(); // Reset agents to their initial positions
    }, [savePositionToRedis, resetAgents]);

    // Helper function to determine terrain type
    const getCurrentTerrain = useCallback(() => {
        const tileType = generateTileAt(worldPosition.x, worldPosition.y);
        switch (tileType) {
            case 0:
                return 'grass';
            case 1:
                return 'dirt';
            case 2:
                return 'water';
            case 3:
                return 'stone';
            default:
                return 'unknown';
        }
    }, [worldPosition, generateTileAt]);

    // Helper function to determine biome
    const getCurrentBiome = useCallback(() => {
        const biomeX = Math.floor(worldPosition.x / 20);
        const biomeY = Math.floor(worldPosition.y / 20);
        const biomeSeed = biomeX * 100 + biomeY;
        const biomeRandom = Math.abs(Math.sin(biomeSeed * 7.1234) * 23456.7891) % 1;

        if (biomeRandom < 0.3) return 'desert';
        else if (biomeRandom < 0.5) return 'water';
        else if (biomeRandom < 0.7) return 'mountain';
        return 'plains';
    }, [worldPosition]);

    // Generate AI commentary
    const generateAICommentary = useCallback(async () => {
        if (!isAutonomous) return;

        try {
            const gameState = {
                worldPosition,
                currentTerrain: getCurrentTerrain(),
                visibleAgents: visibleAgents.map((agent) => ({ name: agent.name, color: agent.color })),
                recentMovements,
                biome: getCurrentBiome()
            };

            const response = await fetch('/api/commentary', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ gameState })
            });

            if (response.ok) {
                const data = await response.json();
                setLastCommentary(data.commentary);
            }
        } catch (error) {
            console.error('Failed to generate commentary:', error);
        }
    }, [isAutonomous, worldPosition, getCurrentTerrain, visibleAgents, recentMovements, getCurrentBiome]);

    // Autonomous movement logic
    const movePlayerAutonomously = useCallback(() => {
        if (!isAutonomous) return;

        // Try to move in current direction
        const nextPosition = { ...worldPosition };
        switch (playerDirection) {
            case DIRECTION.UP:
                nextPosition.y -= 1;
                break;
            case DIRECTION.DOWN:
                nextPosition.y += 1;
                break;
            case DIRECTION.LEFT:
                nextPosition.x -= 1;
                break;
            case DIRECTION.RIGHT:
                nextPosition.x += 1;
                break;
        }

        // Village-based blocking check
        const isBlocked = isPositionBlocked(nextPosition.x, nextPosition.y);

        if (isBlocked) {
            // Try different directions
            const directions: DIRECTION[] = [DIRECTION.UP, DIRECTION.DOWN, DIRECTION.LEFT, DIRECTION.RIGHT];
            const availableDirections = directions.filter((dir) => {
                const testPosition = { ...worldPosition };
                switch (dir) {
                    case DIRECTION.UP:
                        testPosition.y -= 1;
                        break;
                    case DIRECTION.DOWN:
                        testPosition.y += 1;
                        break;
                    case DIRECTION.LEFT:
                        testPosition.x -= 1;
                        break;
                    case DIRECTION.RIGHT:
                        testPosition.x += 1;
                        break;
                    default:
                        break;
                }
                return !isPositionBlocked(testPosition.x, testPosition.y);
            });

            if (availableDirections.length > 0) {
                const randomDirection = availableDirections[Math.floor(Math.random() * availableDirections.length)];
                movePlayer(randomDirection as DIRECTION);
            }
        } else {
            // Move in current direction
            movePlayer(playerDirection as DIRECTION);
        }
    }, [
        isAutonomous,
        worldPosition,
        playerDirection,
        isPositionBlocked,
        movePlayer,
    ]);

    // Initialize to default position on mount/refresh
    // NOTE: Initial position is now set by useVillageLoader based on the village slug
    // This useEffect is commented out to allow village-based starting position
    // useEffect(() => {
    //     // Always start at initial position on refresh
    //     setWorldPosition(INITIAL_PLAYER_POSITION);
    //     setIsLoading(false);
    //
    //     console.log('Player position initialized to:', INITIAL_PLAYER_POSITION);
    // }, []); // Empty dependency array - only run once on mount

    useEffect(() => {
        setIsLoading(false);
    }, [setIsLoading]);

    // Autonomous movement interval
    useEffect(() => {
        if (!isAutonomous) return;

        const interval = setInterval(movePlayerAutonomously, 1500); // Move every 1.5 seconds
        return () => clearInterval(interval);
    }, [isAutonomous, movePlayerAutonomously]);

    // Generate commentary periodically during autonomous mode
    useEffect(() => {
        if (!isAutonomous) return;

        // Generate initial commentary when autonomous mode starts
        generateAICommentary();

        // Generate commentary every 10 seconds during autonomous mode
        const commentaryInterval = setInterval(generateAICommentary, 10000);
        return () => clearInterval(commentaryInterval);
    }, [isAutonomous, generateAICommentary]);

    // Reset player moving state after animation duration
    useEffect(() => {
        if (!isPlayerMoving) return;

        const timer = setTimeout(() => {
            setIsPlayerMoving(false);
        }, 800); // Reset after 800ms (matching agent animation duration)

        return () => clearTimeout(timer);
    }, [lastMoveTime]);

    // Keyboard handling moved to page.tsx to allow A2A agent collision checking

    return {
        playerPosition,
        mapData,
        worldPosition,
        movePlayer,
        isLoading,
        userId,
        agents,
        visibleAgents,
        isAutonomous,
        toggleAutonomous,
        resetLocation,
        lastCommentary,
        playerDirection,
        isPlayerMoving,
        collisionMap,
        isPositionBlocked,
    };
}
