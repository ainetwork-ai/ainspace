'use client';

import { useState, useEffect, useCallback } from 'react';
import { useMapData } from '@/providers/MapDataProvider';
import { useSession } from '@/hooks/useSession';
import { useAgents } from '@/hooks/useAgents';
import { useBuildStore } from '@/stores';
import {
    MAP_WIDTH,
    MAP_HEIGHT,
    VIEW_RADIUS,
    MIN_WORLD_X,
    MAX_WORLD_X,
    MIN_WORLD_Y,
    MAX_WORLD_Y
} from '@/constants/game';

interface Position {
    x: number;
    y: number;
}

export function useGameState() {
    const { getMapData, generateTileAt } = useMapData();
    const { userId } = useSession();
    const { isBlocked: isLayer1Blocked, collisionMap } = useBuildStore();

    // Character starts at the center of the map
    const initialPosition: Position = {
        x: Math.floor((MIN_WORLD_X + MAX_WORLD_X) / 2),
        y: Math.floor((MIN_WORLD_Y + MAX_WORLD_Y) / 2)
    };
    const [worldPosition, setWorldPosition] = useState<Position>(initialPosition);
    const [isLoading, setIsLoading] = useState(true);
    const [isAutonomous, setIsAutonomous] = useState(false);
    const [playerDirection, setPlayerDirection] = useState<'up' | 'down' | 'left' | 'right'>('right');
    const [recentMovements, setRecentMovements] = useState<string[]>([]);
    const [lastCommentary, setLastCommentary] = useState<string>('');
    const [lastMoveTime, setLastMoveTime] = useState<number>(0);
    const [isPlayerMoving, setIsPlayerMoving] = useState(false);

    // Get the current map data centered on the player's world position with full square view
    const mapData = getMapData(worldPosition.x, worldPosition.y, MAP_WIDTH, MAP_HEIGHT);

    // Player is always in the center of the visible map
    const playerPosition = {
        x: Math.floor(MAP_WIDTH / 2),
        y: Math.floor(MAP_HEIGHT / 2)
    };

    // Initialize agents system
    const { agents, worldAgents, visibleAgents } = useAgents({
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
        (direction: 'up' | 'down' | 'left' | 'right') => {
            // Update player direction immediately
            setPlayerDirection(direction);

            // Try to move and track if successful
            setWorldPosition((prevWorldPos) => {
                const newWorldPosition = { ...prevWorldPos };

                switch (direction) {
                    case 'up':
                        newWorldPosition.y -= 1;
                        break;
                    case 'down':
                        newWorldPosition.y += 1;
                        break;
                    case 'left':
                        newWorldPosition.x -= 1;
                        break;
                    case 'right':
                        newWorldPosition.x += 1;
                        break;
                }

                // Check map boundaries
                if (
                    newWorldPosition.x < MIN_WORLD_X ||
                    newWorldPosition.x > MAX_WORLD_X ||
                    newWorldPosition.y < MIN_WORLD_Y ||
                    newWorldPosition.y > MAX_WORLD_Y
                ) {
                    return prevWorldPos;
                }

                // Check if the new world position is walkable
                const tileType = generateTileAt(newWorldPosition.x, newWorldPosition.y);
                if (tileType === 3) {
                    // Stone/wall - can't move there
                    return prevWorldPos;
                }

                // Check layer1 collision
                if (isLayer1Blocked(newWorldPosition.x, newWorldPosition.y)) {
                    return prevWorldPos;
                }

                // Check if an agent is at this position
                const isOccupiedByAgent = worldAgents.some(
                    (agent) => agent.x === newWorldPosition.x && agent.y === newWorldPosition.y
                );
                if (isOccupiedByAgent) {
                    return prevWorldPos;
                }

                // Save new position to Redis
                savePositionToRedis(newWorldPosition);

                // Position changed - trigger animation
                setLastMoveTime(Date.now());
                setIsPlayerMoving(true);

                return newWorldPosition;
            });

            // Track recent movements
            setRecentMovements((prev) => {
                const newMovements = [...prev, direction];
                return newMovements.slice(-5); // Keep last 5 movements
            });
        },
        [generateTileAt, savePositionToRedis, isLayer1Blocked, worldAgents]
    );

    const toggleAutonomous = useCallback(() => {
        setIsAutonomous((prev) => !prev);
    }, []);

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
            case 'up':
                nextPosition.y -= 1;
                break;
            case 'down':
                nextPosition.y += 1;
                break;
            case 'left':
                nextPosition.x -= 1;
                break;
            case 'right':
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
        const isOccupiedByAgent = worldAgents.some((agent) => agent.x === nextPosition.x && agent.y === nextPosition.y);
        const isBlocked =
            isOutOfBounds || tileType === 3 || isLayer1Blocked(nextPosition.x, nextPosition.y) || isOccupiedByAgent;

        if (isBlocked) {
            // Try different directions
            const directions: ('up' | 'down' | 'left' | 'right')[] = ['up', 'down', 'left', 'right'];
            const availableDirections = directions.filter((dir) => {
                const testPosition = { ...worldPosition };
                switch (dir) {
                    case 'up':
                        testPosition.y -= 1;
                        break;
                    case 'down':
                        testPosition.y += 1;
                        break;
                    case 'left':
                        testPosition.x -= 1;
                        break;
                    case 'right':
                        testPosition.x += 1;
                        break;
                }
                const outOfBounds =
                    testPosition.x < MIN_WORLD_X ||
                    testPosition.x > MAX_WORLD_X ||
                    testPosition.y < MIN_WORLD_Y ||
                    testPosition.y > MAX_WORLD_Y;
                const occupiedByAgent = worldAgents.some(
                    (agent) => agent.x === testPosition.x && agent.y === testPosition.y
                );
                return (
                    !outOfBounds &&
                    generateTileAt(testPosition.x, testPosition.y) !== 3 &&
                    !isLayer1Blocked(testPosition.x, testPosition.y) &&
                    !occupiedByAgent
                );
            });

            if (availableDirections.length > 0) {
                const randomDirection = availableDirections[Math.floor(Math.random() * availableDirections.length)];
                movePlayer(randomDirection);
            }
        } else {
            // Move in current direction
            movePlayer(playerDirection);
        }
    }, [isAutonomous, worldPosition, playerDirection, generateTileAt, movePlayer, isLayer1Blocked, worldAgents]);

    // Load saved position from Redis when user session is available
    useEffect(() => {
        const loadSavedPosition = async () => {
            if (!userId) return;

            setIsLoading(true);
            try {
                const response = await fetch(`/api/position?userId=${userId}`);
                const data = await response.json();

                if (response.ok && !data.isDefault) {
                    const savedPosition = data.position;
                    // Clamp position to map boundaries
                    const clampedPosition = {
                        x: Math.max(MIN_WORLD_X, Math.min(MAX_WORLD_X, savedPosition.x)),
                        y: Math.max(MIN_WORLD_Y, Math.min(MAX_WORLD_Y, savedPosition.y))
                    };
                    setWorldPosition(clampedPosition);
                }
            } catch (error) {
                console.error('Failed to load saved position:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadSavedPosition();
    }, [userId]);

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
        lastCommentary,
        playerDirection,
        isPlayerMoving,
        collisionMap
    };
}
