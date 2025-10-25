'use client';

import { useEffect, useCallback } from 'react';
import { useMapData } from '@/providers/MapDataProvider';
import { useSession } from '@/hooks/useSession';
import { useAgents } from '@/hooks/useAgents';
import { useBuildStore, useGameStateStore, useAgentStore } from '@/stores';
import {
    MAP_WIDTH,
    MAP_HEIGHT,
    VIEW_RADIUS,
    MIN_WORLD_X,
    MAX_WORLD_X,
    MIN_WORLD_Y,
    MAX_WORLD_Y,
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
    const { userId } = useSession();
    const { isBlocked: isLayer1Blocked, collisionMap } = useBuildStore();
    const { agents: a2aAgents } = useAgentStore();
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
    const { agents, worldAgents, visibleAgents, resetAgents } = useAgents({
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
                        position
                    })
                });
            } catch (error) {
                console.error('Failed to save position:', error);
            }
        },
        [userId]
    );

    const movePlayer = useCallback(
        (direction: DIRECTION) => {
            // Check if enough time has passed since last move (prevent double movement)
            const now = Date.now();
            const timeSinceLastMove = now - lastMoveTime;
            if (timeSinceLastMove < MIN_MOVE_INTERVAL) {
                console.log(`⏱️ Movement throttled: ${timeSinceLastMove}ms since last move (min: ${MIN_MOVE_INTERVAL}ms)`);
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

            if (
                newWorldPosition.x < MIN_WORLD_X ||
                newWorldPosition.x > MAX_WORLD_X ||
                newWorldPosition.y < MIN_WORLD_Y ||
                newWorldPosition.y > MAX_WORLD_Y
            ) {
                return;
            }

            // Check if the new world position is walkable
            const tileType = generateTileAt(newWorldPosition.x, newWorldPosition.y);
            if (tileType === 3) {
                // Stone/wall - can't move there
                return;
            }

            // Check layer1 collision
            if (isLayer1Blocked(newWorldPosition.x, newWorldPosition.y)) {
                return;
            }

            // Check if a world agent is at this position
            const isOccupiedByWorldAgent = worldAgents.some(
                (agent) => agent.x === newWorldPosition.x && agent.y === newWorldPosition.y
            );
            if (isOccupiedByWorldAgent) {
                const blockingAgent = worldAgents.find(
                    (agent) => agent.x === newWorldPosition.x && agent.y === newWorldPosition.y
                );
                console.log(
                    `🎮❌ Movement blocked: World agent "${blockingAgent?.name}" is at (${newWorldPosition.x}, ${newWorldPosition.y})`
                );
                return;
            }

            // Check if an A2A agent is at this position
            const isOccupiedByA2AAgent = Object.values(a2aAgents).some(
                (agent) => agent.x === newWorldPosition.x && agent.y === newWorldPosition.y
            );
            if (isOccupiedByA2AAgent) {
                const blockingAgent = Object.values(a2aAgents).find(
                    (agent) => agent.x === newWorldPosition.x && agent.y === newWorldPosition.y
                );
                console.log(
                    `🤖❌ Movement blocked: A2A agent "${blockingAgent?.name}" is at (${newWorldPosition.x}, ${newWorldPosition.y})`
                );
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
        [generateTileAt, savePositionToRedis, isLayer1Blocked, worldAgents, a2aAgents, lastMoveTime]
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

        // Check if blocked by boundary or obstacle
        const isOutOfBounds =
            nextPosition.x < MIN_WORLD_X ||
            nextPosition.x > MAX_WORLD_X ||
            nextPosition.y < MIN_WORLD_Y ||
            nextPosition.y > MAX_WORLD_Y;
        const tileType = generateTileAt(nextPosition.x, nextPosition.y);
        const isOccupiedByWorldAgent = worldAgents.some(
            (agent) => agent.x === nextPosition.x && agent.y === nextPosition.y
        );
        const isOccupiedByA2AAgent = Object.values(a2aAgents).some(
            (agent) => agent.x === nextPosition.x && agent.y === nextPosition.y
        );
        const isBlocked =
            isOutOfBounds ||
            tileType === 3 ||
            isLayer1Blocked(nextPosition.x, nextPosition.y) ||
            isOccupiedByWorldAgent ||
            isOccupiedByA2AAgent;

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
                const outOfBounds =
                    testPosition.x < MIN_WORLD_X ||
                    testPosition.x > MAX_WORLD_X ||
                    testPosition.y < MIN_WORLD_Y ||
                    testPosition.y > MAX_WORLD_Y;
                const occupiedByWorldAgent = worldAgents.some(
                    (agent) => agent.x === testPosition.x && agent.y === testPosition.y
                );
                const occupiedByA2AAgent = Object.values(a2aAgents).some(
                    (agent) => agent.x === testPosition.x && agent.y === testPosition.y
                );
                return (
                    !outOfBounds &&
                    generateTileAt(testPosition.x, testPosition.y) !== 3 &&
                    !isLayer1Blocked(testPosition.x, testPosition.y) &&
                    !occupiedByWorldAgent &&
                    !occupiedByA2AAgent
                );
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
        generateTileAt,
        movePlayer,
        isLayer1Blocked,
        worldAgents,
        a2aAgents
    ]);

    // Initialize to default position on mount/refresh
    useEffect(() => {
        // Always start at initial position on refresh
        setWorldPosition(INITIAL_PLAYER_POSITION);
        setIsLoading(false);

        console.log('🔄 Player position initialized to:', INITIAL_PLAYER_POSITION);
    }, []); // Empty dependency array - only run once on mount

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
        worldAgents,
        visibleAgents,
        isAutonomous,
        toggleAutonomous,
        resetLocation,
        lastCommentary,
        playerDirection,
        isPlayerMoving,
        collisionMap
    };
}
