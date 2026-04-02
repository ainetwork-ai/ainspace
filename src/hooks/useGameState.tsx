'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useMapData } from '@/providers/MapDataProvider';
import { useAgents } from '@/hooks/useAgents';
import { useBuildStore, useGameStateStore, useUserStore } from '@/stores';
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
        setIsPlayerMoving,
        applyMove
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

    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingPositionRef = useRef<Position | null>(null);

    const flushPositionSave = useCallback(() => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        const position = pendingPositionRef.current;
        if (position && userId) {
            pendingPositionRef.current = null;
            fetch('/api/position', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, position })
            }).catch((error) => {
                console.error('Failed to save position:', error);
            });
        }
    }, [userId]);

    const savePositionToRedis = useCallback(
        (position: Position) => {
            if (!userId) return;
            pendingPositionRef.current = position;
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
            debounceTimerRef.current = setTimeout(flushPositionSave, 300);
        },
        [userId, flushPositionSave]
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
            const occupiedByAgent = agents.some(
                (agent) => agent.x === x && agent.y === y
            );
            if (occupiedByAgent) return true;

            return false;
        },
        [isCollisionAt, isLayer1Blocked, agents]
    );

    const movePlayer = useCallback(
        (direction: DIRECTION) => {
            // getState로 최신값 읽기 (stale closure 방지)
            const { worldPosition: currentPos, lastMoveTime: currentLastMoveTime, recentMovements: currentMovements } = useGameStateStore.getState();

            // Check if enough time has passed since last move (prevent double movement)
            const now = Date.now();
            if (now - currentLastMoveTime < MIN_MOVE_INTERVAL) {
                return;
            }

            const newWorldPosition = { ...currentPos };
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
                // 충돌 시 방향만 전환
                setPlayerDirection(direction);
                return;
            }

            // Save new position to Redis
            savePositionToRedis(newWorldPosition);

            // Position changed - apply all move state in single set()
            applyMove({
                worldPosition: newWorldPosition,
                playerDirection: direction,
                lastMoveTime: Date.now(),
                recentMovements: [direction, ...currentMovements.slice(0, 4)],
            });
        },
        [isPositionBlocked, savePositionToRedis, setPlayerDirection, applyMove]
    );

    const toggleAutonomous = useCallback(() => {
        setIsAutonomous(!isAutonomous);
    }, []);

    // Reset player location to initial position
    const resetLocation = useCallback(() => {
        pendingPositionRef.current = INITIAL_PLAYER_POSITION;
        flushPositionSave();

        setWorldPosition(INITIAL_PLAYER_POSITION);
        setPlayerDirection(DIRECTION.RIGHT);
        setRecentMovements([]);
        setIsPlayerMoving(false);
        resetAgents();
    }, [flushPositionSave, resetAgents]);

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

    // Flush pending position save on unmount and beforeunload
    useEffect(() => {
        const handleBeforeUnload = () => {
            const position = pendingPositionRef.current;
            if (position && userId) {
                const blob = new Blob(
                    [JSON.stringify({ userId, position })],
                    { type: 'application/json' }
                );
                navigator.sendBeacon('/api/position', blob);
                pendingPositionRef.current = null;
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            flushPositionSave();
        };
    }, [userId, flushPositionSave]);

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
