'use client';

import { useGameState } from '@/hooks/useGameState';
import { useMiniKit } from '@coinbase/onchainkit/minikit';
import { useRef, useEffect, useState } from 'react';
import { ChatBoxRef } from '@/components/ChatBox';
import MapTab from '@/components/tabs/MapTab';
import AgentTab from '@/components/tabs/AgentTab';
import Footer from '@/components/Footer';
import { DIRECTION, MAP_TILES, ENABLE_AGENT_MOVEMENT } from '@/constants/game';
import { AgentCard } from '@a2a-js/sdk';
import { useUIStore, useThreadStore, useBuildStore, useAgentStore } from '@/stores';
import TempBuildTab from '@/components/tabs/TempBuildTab';
import { useSwitchChain, useWriteContract } from 'wagmi';
import { ADD_AGENT_ABI, AGENT_CONTRACT_ADDRESS } from '@/constants/agentContract';
import { baseSepolia } from 'viem/chains';
import sdk from '@farcaster/miniapp-sdk';

// Spawn zones for deployed agents
// Default agents center: (59, 70) with radius ~2-3 tiles
// Broadcast range: 10 tiles, so deploy zones must be 25+ tiles away to prevent thread overlap
// Each zone can hold ~15-20 agents comfortably within radius 10
const DEPLOY_ZONE_CENTERS = [
    { x: 34, y: 70 },   // West zone (25 tiles left)
    { x: 84, y: 70 },   // East zone (25 tiles right)
    { x: 59, y: 45 },   // North zone (25 tiles up)
    { x: 59, y: 95 },   // South zone (25 tiles down)
    { x: 81, y: 48 },   // Northeast zone (diagonal, ~31 tiles away)
];
const MAX_SEARCH_RADIUS = 10;  // Tight clustering within each zone

export default function Home() {
    // Global stores
    const { activeTab, setActiveTab, openBottomSheet } = useUIStore();
    const {
        threads,
        broadcastMessage,
        broadcastStatus,
        setCurrentThreadId,
        setBroadcastMessage,
    } = useThreadStore();
    const {
        customTiles,
        publishedTiles,
        isPublishing,
        publishStatus,
        collisionMap: globalCollisionMap,
        isBlocked: globalIsBlocked,
        setCustomTiles,
        setPublishedTiles,
        setSelectedImage,
        setBuildMode,
        setIsPublishing,
        setPublishStatus,
        setCollisionMap,
        clearPublishStatusAfterDelay
    } = useBuildStore();
    const { worldPosition, userId, worldAgents, resetLocation, lastCommentary, visibleAgents } = useGameState();
    const { agents, spawnAgent, removeAgent, setAgents } = useAgentStore();
    const { setFrameReady, isFrameReady } = useMiniKit();
    const [isSDKLoaded, setIsSDKLoaded] = useState(false);

    const { writeContractAsync } = useWriteContract();
    const { switchChainAsync } = useSwitchChain();

    // Initialize collision map on first load
    useEffect(() => {
        if (!isFrameReady) {
            setFrameReady();
        }

        const initCollisionMap = async () => {
            if (Object.keys(globalCollisionMap).length === 0) {
                try {
                    const { updateCollisionMapFromImage } = useBuildStore.getState();
                    await updateCollisionMapFromImage('/map/land_layer_1.webp');
                } catch (error) {
                    console.error('Failed to initialize collision map:', error);
                }
            }
        };
        initCollisionMap();
    }, []); // Run only once on mount

    // Load custom tiles when userId is available
    useEffect(() => {
        const loadCustomTiles = async () => {
            if (!userId) return;

            try {
                const response = await fetch(`/api/custom-tiles?userId=${userId}`);
                if (response.ok) {
                    const data = await response.json();
                    if (!data.isDefault && data.tiles) {
                        setPublishedTiles(data.tiles);
                        const totalTiles =
                            Object.keys(data.tiles.layer0 || {}).length +
                            Object.keys(data.tiles.layer1 || {}).length +
                            Object.keys(data.tiles.layer2 || {}).length;
                        console.log(`Loaded ${totalTiles} published tiles from server`);

                        // Also update collision map with existing layer1 items
                        const layer1Items = data.tiles.layer1 || {};

                        // Get current collision map from store to avoid dependency
                        const currentCollisionMap = useBuildStore.getState().collisionMap;
                        const existingCollisionTiles: { [key: string]: boolean } = { ...currentCollisionMap };

                        Object.keys(layer1Items).forEach((key) => {
                            existingCollisionTiles[key] = true;
                        });

                        setCollisionMap(existingCollisionTiles);
                        console.log(
                            `Updated collision map with ${Object.keys(layer1Items).length} existing blocked tiles`
                        );
                    }
                }
            } catch (error) {
                console.error('Failed to load custom tiles:', error);
            }
        };

        loadCustomTiles();
    }, [userId, setPublishedTiles, setCollisionMap]);

    // Load deployed agents from Redis on mount
    useEffect(() => {
        const loadDeployedAgents = async () => {
            try {
                const response = await fetch('/api/agents');
                if (!response.ok) {
                    console.error('Failed to load deployed agents from Redis');
                    return;
                }

                const data = await response.json();
                if (!data.success || !data.agents) {
                    console.error('Invalid agents data from API');
                    return;
                }

                // Get default agent URLs to exclude them from restoration
                const { DEFAULT_AGENTS } = await import('@/lib/initializeAgents');
                const defaultAgentUrls = new Set(DEFAULT_AGENTS.map(agent => agent.a2aUrl));

                // Filter out default agents (they're already in worldAgents)
                // Only load user-deployed agents that have position/sprite data
                type DeployedAgentData = {
                    card: AgentCard & { x?: number; y?: number; spriteUrl?: string; color?: string; spriteHeight?: number; moveInterval?: number };
                    url: string
                };
                const deployedAgents = data.agents.filter((agentData: DeployedAgentData) => {
                    const card = agentData.card;
                    const url = agentData.url;
                    // Exclude default agents and only include agents with deployment data
                    return !defaultAgentUrls.has(url) &&
                           card &&
                           typeof card.x === 'number' &&
                           typeof card.y === 'number' &&
                           card.spriteUrl;
                });

                console.log(`Found ${deployedAgents.length} user-deployed agents in Redis (excluding ${defaultAgentUrls.size} default agents)`);

                // Restore agents to useAgentStore
                deployedAgents.forEach((agentData: DeployedAgentData) => {
                    const card = agentData.card;
                    const agentUrl = agentData.url;

                    // Check if agent is already in store (avoid duplicates)
                    const existingAgents = useAgentStore.getState().agents;
                    if (existingAgents[agentUrl]) {
                        console.log(`Agent already in store: ${card.name}`);
                        return;
                    }

                    const agentId = `a2a-deployed-${Date.now()}-${Math.random()}`;

                    // Restore agent to store with saved position and sprite
                    // We know x and y are numbers because they were filtered above
                    spawnAgent(agentUrl, {
                        id: agentId,
                        name: card.name || 'Deployed Agent',
                        x: card.x!,
                        y: card.y!,
                        color: card.color || '#FF6B6B',
                        agentUrl: agentUrl,
                        lastMoved: Date.now(),
                        moveInterval: card.moveInterval || 800,
                        skills: card.skills || [],
                        spriteUrl: card.spriteUrl || '/sprite/sprite_cat.png',
                        spriteHeight: card.spriteHeight || 40
                    });

                    console.log(`✓ Restored deployed agent: ${card.name} at (${card.x}, ${card.y})`);
                });

            } catch (error) {
                console.error('Error loading deployed agents:', error);
            }
        };

        loadDeployedAgents();
    }, [spawnAgent]);

    const handleViewThread = (threadId?: string) => {
        // Set current thread if specified, otherwise use most recent
        if (threadId) {
            setCurrentThreadId(threadId);
        } else if (threads.length > 0) {
            setCurrentThreadId(threads[0].id);
        }
        // Switch to thread tab to view the conversation
        setActiveTab('thread');
    };

    const handleAgentClick = (agentId: string, agentName: string) => {
        console.log(`Agent clicked: ${agentName} (${agentId})`);

        // Find the most recent thread that includes this agent
        const agentThread = threads.find((thread) => thread.agentNames.includes(agentName));

        if (agentThread) {
            // If there's a thread with this agent, open it
            setCurrentThreadId(agentThread.id);
        }

        // Open the BottomSheet to show the ThreadTab
        openBottomSheet();
    };

    const handlePublishTiles = async () => {
        const totalCustomTiles =
            Object.keys(customTiles.layer0 || {}).length +
            Object.keys(customTiles.layer1 || {}).length +
            Object.keys(customTiles.layer2 || {}).length;

        if (!userId || totalCustomTiles === 0) {
            setPublishStatus({
                type: 'error',
                message: 'No custom tiles to publish'
            });
            return;
        }

        setIsPublishing(true);
        setPublishStatus(null);

        try {
            const response = await fetch('/api/custom-tiles', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: userId,
                    customTiles: customTiles
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            // Move custom tiles to published tiles and reset build state
            setPublishedTiles((prev) => ({
                layer0: { ...(prev.layer0 || {}), ...(customTiles.layer0 || {}) },
                layer1: { ...(prev.layer1 || {}), ...(customTiles.layer1 || {}) },
                layer2: { ...(prev.layer2 || {}), ...(customTiles.layer2 || {}) }
            }));

            // Update collision map based on newly placed layer1 items
            // For each placed item in layer1, we need to analyze its pixels to determine blocked tiles
            const layer1Items = customTiles.layer1 || {};

            // Get current collision map from store
            const currentCollisionMap = useBuildStore.getState().collisionMap;
            const newCollisionTiles: { [key: string]: boolean } = { ...currentCollisionMap };

            // Mark all placed item positions as blocked
            Object.keys(layer1Items).forEach((key) => {
                newCollisionTiles[key] = true;
            });

            setCollisionMap(newCollisionTiles);
            console.log(
                `Updated collision map with ${Object.keys(layer1Items).length} new blocked tiles from published items`
            );

            setPublishStatus({
                type: 'success',
                message: `Published ${data.tileCount} custom tiles successfully!`
            });

            setCustomTiles({ layer0: {}, layer1: {}, layer2: {} }); // Clear draft tiles since they're now published
            setSelectedImage(null);
            setBuildMode('select');

            // Clear status after 5 seconds
            clearPublishStatusAfterDelay(5000);
        } catch (error) {
            console.error('Failed to publish custom tiles:', error);
            setPublishStatus({
                type: 'error',
                message: 'Failed to publish tiles. Please try again.'
            });

            // Clear status after 5 seconds
            clearPublishStatusAfterDelay(5000);
        } finally {
            setIsPublishing(false);
        }
    };

    // A2A Agent handlers - now integrated into worldAgents
    const handleSpawnAgent = async (importedAgent: {
        url: string;
        card: AgentCard;
        spriteUrl?: string;
        spriteHeight?: number;
    }) => {
        const agentId = `a2a-${Date.now()}`;
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        // Find a non-blocked spawn position in one of the deployment zones
        const findAvailableSpawnPosition = (): { x: number; y: number } | null => {
            // Helper function to check if a position is valid
            const isPositionValid = (x: number, y: number): boolean => {
                // Check boundaries
                if (x < 0 || x >= MAP_TILES || y < 0 || y >= MAP_TILES) {
                    return false;
                }

                // Check if position is blocked by collision map
                if (globalIsBlocked(x, y)) {
                    return false;
                }

                // Check if position is occupied by player
                if (x === worldPosition.x && y === worldPosition.y) {
                    return false;
                }

                // Check if position is occupied by another agent
                const isOccupied = combinedVisibleAgents.some((agent) => agent.x === x && agent.y === y);
                return !isOccupied;
            };

            // Randomly select one of the 5 deployment zones
            const selectedCenter = DEPLOY_ZONE_CENTERS[
                Math.floor(Math.random() * DEPLOY_ZONE_CENTERS.length)
            ];

            console.log(`Selected deployment zone: (${selectedCenter.x}, ${selectedCenter.y})`);

            // Search in expanding radius from selected zone center
            for (let radius = 1; radius <= MAX_SEARCH_RADIUS; radius++) {
                // Collect all positions at current radius
                const positionsAtRadius: { x: number; y: number }[] = [];

                for (let dx = -radius; dx <= radius; dx++) {
                    for (let dy = -radius; dy <= radius; dy++) {
                        // Only check positions on the perimeter (not interior)
                        if (Math.abs(dx) === radius || Math.abs(dy) === radius) {
                            positionsAtRadius.push({
                                x: selectedCenter.x + dx,
                                y: selectedCenter.y + dy
                            });
                        }
                    }
                }

                // Shuffle to add randomness and avoid clustering
                positionsAtRadius.sort(() => Math.random() - 0.5);

                // Check each position at this radius
                for (const pos of positionsAtRadius) {
                    if (isPositionValid(pos.x, pos.y)) {
                        console.log(`Found spawn position at (${pos.x}, ${pos.y}) - radius ${radius} from zone center`);
                        return pos;
                    }
                }
            }

            return null; // No valid position found in this zone
        };

        // Try to find spawn position
        const spawnPosition = findAvailableSpawnPosition();

        if (!spawnPosition) {
            // Show error if no valid spawn position found
            console.error('Cannot spawn agent: no available positions found in deployment zones');
            alert(
                'Cannot spawn agent: no available space found in deployment zones. Please remove some agents or clear space on the map.'
            );
            return;
        }

        const { x: spawnX, y: spawnY } = spawnPosition;
        console.log(`✓ Spawning agent at (${spawnX}, ${spawnY}) - separated from default agents`);

        await switchChainAsync({
            chainId: baseSepolia.id
        });

        try {
            await writeContractAsync({
                address: AGENT_CONTRACT_ADDRESS,
                abi: ADD_AGENT_ABI,
                functionName: 'addAgent',
                args: [importedAgent.url, spawnX, spawnY],
                chain: baseSepolia
            }).catch((error) => {
                console.error('User denied transaction:', error);
            });
        } catch (error) {
            console.error('User denied transaction:', error);
        }

        // Register agent with backend Redis
        try {
            const registerResponse = await fetch('/api/agents', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    agentUrl: importedAgent.url,
                    agentCard: {
                        ...importedAgent.card,
                        x: spawnX,
                        y: spawnY,
                        color: randomColor,
                        spriteUrl: importedAgent.spriteUrl || '/sprite/sprite_cat.png',
                        spriteHeight: importedAgent.spriteHeight || 40,
                        behavior: 'random',
                        moveInterval: 600 + Math.random() * 400
                    }
                })
            });

            if (!registerResponse.ok && registerResponse.status !== 409) {
                console.error('Failed to register agent with backend:', await registerResponse.text());
            } else {
                console.log('✓ Agent registered with backend Redis');
            }
        } catch (error) {
            console.error('Error registering agent with backend:', error);
        }

        // Add to spawned A2A agents for UI tracking
        spawnAgent(importedAgent.url, {
            id: agentId,
            name: importedAgent.card.name || 'A2A Agent',
            x: spawnX,
            y: spawnY,
            color: randomColor,
            agentUrl: importedAgent.url,
            lastMoved: Date.now(),
            moveInterval: 600 + Math.random() * 400, // Random 600-1000ms interval, matching original agents
            skills: importedAgent.card.skills || [],
            spriteUrl: importedAgent.spriteUrl || '/sprite/sprite_cat.png', // Use selected sprite or default
            spriteHeight: importedAgent.spriteHeight || 40 // Use selected sprite height or default
        });

        // Switch to map tab
        setActiveTab('map');
    };

    const handleRemoveAgentFromMap = (agentUrl: string) => {
        removeAgent(agentUrl);
    };

    // // Combine existing world agents with spawned A2A agents
    // const combinedWorldAgents = [
    //     ...worldAgents,
    //     ...Object.values(agents).map((agent) => ({
    //         id: agent.id,
    //         x: agent.x,
    //         y: agent.y,
    //         color: agent.color,
    //         name: agent.name,
    //         behavior: 'A2A Agent',
    //         agentUrl: agent.agentUrl, // Include agentUrl for A2A agents
    //         skills: agent.skills
    //     }))
    // ];

    // Convert A2A agents to visible agents format for the map
    const a2aVisibleAgents = Object.values(agents)
        .map((agent) => {
            return {
                id: agent.id,
                x: agent.x, // world position
                y: agent.y, // world position
                screenX: 0, // Will be calculated in TileMap based on camera position
                screenY: 0, // Will be calculated in TileMap based on camera position
                color: agent.color,
                name: agent.name,
                spriteUrl: agent.spriteUrl, // Pass sprite URL for animation
                spriteHeight: agent.spriteHeight, // Pass sprite height for rendering
                direction: agent.direction, // Pass direction for animation
                isMoving: agent.isMoving // Pass movement state for animation
            };
        })
        .filter(Boolean) as Array<{
        id: string;
        x: number;
        y: number;
        screenX: number;
        screenY: number;
        color: string;
        name: string;
        spriteUrl?: string;
        spriteHeight?: number;
        direction?: DIRECTION;
        isMoving?: boolean;
    }>;

    const combinedVisibleAgents = [...visibleAgents, ...a2aVisibleAgents];

    // A2A Agent movement system
    useEffect(() => {
        // Skip movement if disabled
        if (!ENABLE_AGENT_MOVEMENT) {
            return;
        }

        const moveA2AAgents = () => {
            const now = Date.now();
            const updated = { ...agents };
            let hasUpdates = false;

            Object.values(updated).forEach((agent) => {
                // Use the stored moveInterval (or default if not set)
                const moveInterval = agent.moveInterval || 5000;
                const timeSinceLastMove = now - (agent.lastMoved || 0);

                // Only try to move if enough time has passed
                if (timeSinceLastMove < moveInterval) {
                    return;
                }

                const directions = [
                    { dx: 0, dy: -1 }, // up
                    { dx: 0, dy: 1 }, // down
                    { dx: -1, dy: 0 }, // left
                    { dx: 1, dy: 0 } // right
                ];

                // Try random directions until we find a valid move or exhaust all options
                const shuffledDirections = [...directions].sort(() => Math.random() - 0.5);
                let moved = false;

                for (const direction of shuffledDirections) {
                    const newX = agent.x + direction.dx;
                    const newY = agent.y + direction.dy;

                    // Check map boundaries
                    if (newX < 0 || newX >= MAP_TILES || newY < 0 || newY >= MAP_TILES) {
                        continue; // Try next direction
                    }

                    // Check if player is at this position
                    if (newX === worldPosition.x && newY === worldPosition.y) {
                        continue; // Try next direction
                    }

                    // Check if another agent (A2A or world agent) is at this position
                    const isOccupiedByA2A = Object.values(updated).some(
                        (otherAgent) => otherAgent.id !== agent.id && otherAgent.x === newX && otherAgent.y === newY
                    );
                    const isOccupiedByWorldAgent = worldAgents.some(
                        (worldAgent) => worldAgent.x === newX && worldAgent.y === newY
                    );
                    if (isOccupiedByA2A || isOccupiedByWorldAgent) {
                        continue; // Try next direction
                    }

                    // Check layer1 collision - don't move if blocked
                    if (globalIsBlocked(newX, newY)) {
                        continue; // Try next direction
                    }

                    // Determine direction based on movement
                    let agentDirection = DIRECTION.DOWN;
                    if (direction.dy === -1) agentDirection = DIRECTION.UP;
                    else if (direction.dy === 1) agentDirection = DIRECTION.DOWN;
                    else if (direction.dx === -1) agentDirection = DIRECTION.LEFT;
                    else if (direction.dx === 1) agentDirection = DIRECTION.RIGHT;

                    // Valid move found! Update position, direction and set moving flag
                    agent.x = newX;
                    agent.y = newY;
                    agent.lastMoved = now;
                    agent.direction = agentDirection;
                    agent.isMoving = true;
                    moved = true;
                    hasUpdates = true;

                    // Clear isMoving flag after a short delay (animation duration)
                    const agentUrl = agent.agentUrl;
                    if (agentUrl) {
                        setTimeout(() => {
                            const currentAgents = useAgentStore.getState().agents;
                            const currentAgent = currentAgents[agentUrl];
                            if (currentAgent) {
                                useAgentStore.getState().updateAgent(agentUrl, { isMoving: false });
                            }
                        }, 500); // Match animation duration
                    }

                    break; // Successfully moved, exit the direction loop
                }

                // If we couldn't move in any direction, still update lastMoved to prevent getting stuck
                if (!moved) {
                    agent.lastMoved = now;
                    agent.isMoving = false;
                    hasUpdates = true;
                }
            });

            // Only update state if there were actual changes
            if (hasUpdates) {
                setAgents(updated);
            }
        };

        const interval = setInterval(moveA2AAgents, 100); // Check every 100ms, matching original agents
        return () => clearInterval(interval);
    }, [globalIsBlocked, agents, worldAgents, worldPosition, setAgents, ENABLE_AGENT_MOVEMENT]);

    useEffect(() => {
        const load = async () => {
            sdk.actions.ready({ disableNativeGestures: true });
        };
        if (sdk && !isSDKLoaded) {
            setIsSDKLoaded(true);
            load();
        }
    }, [isSDKLoaded]);

    return (
        <div className="flex h-screen w-full flex-col bg-gray-100">
            <div className="flex-1 overflow-hidden">
                <MapTab
                    isActive={activeTab === 'map'}
                    visibleAgents={combinedVisibleAgents}
                    publishedTiles={publishedTiles}
                    customTiles={customTiles}
                    broadcastMessage={broadcastMessage}
                    setBroadcastMessage={setBroadcastMessage}
                    broadcastStatus={broadcastStatus}
                    threads={threads}
                    onViewThread={handleViewThread}
                    collisionMap={globalCollisionMap}
                    onAgentClick={handleAgentClick}
                />
                <TempBuildTab
                    isActive={activeTab === 'build'}
                    worldPosition={worldPosition}
                    visibleAgents={combinedVisibleAgents}
                    publishedTiles={publishedTiles}
                    customTiles={customTiles}
                    setCustomTiles={setCustomTiles}
                    setPublishedTiles={setPublishedTiles}
                    isPublishing={isPublishing}
                    publishStatus={publishStatus}
                    userId={userId}
                    onPublishTiles={handlePublishTiles}
                />
                {/* <BuildTab
                    isActive={activeTab === 'build'}
                    mapData={mapData}
                    playerPosition={playerPosition}
                    worldPosition={worldPosition}
                    visibleAgents={combinedVisibleAgents}
                    publishedTiles={publishedTiles}
                    customTiles={customTiles}
                    selectedImage={selectedImage}
                    setSelectedImage={setSelectedImage}
                    buildMode={buildMode}
                    setBuildMode={setBuildMode}
                    setCustomTiles={setCustomTiles}
                    isPublishing={isPublishing}
                    publishStatus={publishStatus}
                    userId={userId}
                    onPublishTiles={handlePublishTiles}
                    onMobileMove={handleMobileMove}
                /> */}
                <AgentTab
                    isActive={activeTab === 'agent'}
                    onSpawnAgent={handleSpawnAgent}
                    onRemoveAgentFromMap={handleRemoveAgentFromMap}
                    spawnedAgents={Object.keys(agents)}
                />
            </div>
            <Footer
                activeTab={activeTab}
                onTabChange={setActiveTab}
            />
        </div>
    );
}
