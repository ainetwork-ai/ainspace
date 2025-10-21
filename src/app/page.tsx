'use client';

import { useGameState } from '@/hooks/useGameState';
import { useRef, useEffect, useCallback } from 'react';
import { ChatBoxRef } from '@/components/ChatBox';
import MapTab from '@/components/tabs/MapTab';
import ThreadTab from '@/components/tabs/ThreadTab';
import BuildTab from '@/components/tabs/BuildTab';
import AgentTab from '@/components/tabs/AgentTab';
import Footer from '@/components/Footer';
import BottomSheet from '@/components/BottomSheet';
import { useLayer1Collision } from '@/hooks/useLayer1Collision';
import { MAP_TILES } from '@/constants/game';
import { useUIStore, useThreadStore, useBuildStore, useAgentStore } from '@/stores';

export default function Home() {
    const {
        playerPosition,
        mapData,
        worldPosition,
        movePlayer,
        isLoading,
        userId,
        visibleAgents,
        worldAgents,
        isAutonomous,
        toggleAutonomous,
        lastCommentary,
        playerDirection,
        isPlayerMoving,
        collisionMap
    } = useGameState();
    const { isBlocked: isLayer1Blocked } = useLayer1Collision('/map/layer_1.png');

    // Global stores
    const { activeTab, isBottomSheetOpen, setActiveTab, openBottomSheet, closeBottomSheet } = useUIStore();
    const {
        threads,
        currentThreadId,
        broadcastMessage,
        broadcastStatus,
        addThread,
        setCurrentThreadId,
        setBroadcastMessage,
        setBroadcastStatus,
        clearBroadcastMessage,
        clearBroadcastStatusAfterDelay
    } = useThreadStore();
    const {
        customTiles,
        publishedTiles,
        selectedImage,
        buildMode,
        isPublishing,
        publishStatus,
        setCustomTiles,
        setPublishedTiles,
        setSelectedImage,
        setBuildMode,
        setIsPublishing,
        setPublishStatus,
        clearPublishStatusAfterDelay
    } = useBuildStore();
    const { spawnedA2AAgents, spawnAgent, removeAgent, updateAgent, setAgents } = useAgentStore();

    const chatBoxRef = useRef<ChatBoxRef>(null);

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
                    }
                }
            } catch (error) {
                console.error('Failed to load custom tiles:', error);
            }
        };

        loadCustomTiles();
    }, [userId]);

    const handleMobileMove = useCallback(
        (direction: 'up' | 'down' | 'left' | 'right') => {
            if (isAutonomous) return;

            // Calculate new position
            let newX = worldPosition.x;
            let newY = worldPosition.y;
            switch (direction) {
                case 'up':
                    newY -= 1;
                    break;
                case 'down':
                    newY += 1;
                    break;
                case 'left':
                    newX -= 1;
                    break;
                case 'right':
                    newX += 1;
                    break;
            }

            // Check if A2A agent is at this position
            const isOccupiedByA2A = Object.values(spawnedA2AAgents).some(
                (agent) => agent.x === newX && agent.y === newY
            );

            if (isOccupiedByA2A) {
                return;
            }

            // Move player (this will also check worldAgents in useGameState)
            movePlayer(direction);
        },
        [isAutonomous, worldPosition, spawnedA2AAgents, movePlayer]
    );

    // Keyboard handling for player movement (works alongside joystick)
    useEffect(() => {
        const handleKeyPress = (event: KeyboardEvent) => {
            if (isLoading || isAutonomous) return;

            switch (event.key) {
                case 'ArrowUp':
                    event.preventDefault();
                    handleMobileMove('up');
                    break;
                case 'ArrowDown':
                    event.preventDefault();
                    handleMobileMove('down');
                    break;
                case 'ArrowLeft':
                    event.preventDefault();
                    handleMobileMove('left');
                    break;
                case 'ArrowRight':
                    event.preventDefault();
                    handleMobileMove('right');
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [handleMobileMove, isLoading, isAutonomous]);

    const handleBroadcast = async () => {
        if (broadcastMessage.trim()) {
            const messageText = broadcastMessage.trim();

            // Calculate agents within range (default broadcast range: 10 units)
            const broadcastRange = 10;
            const agentsInRange = combinedWorldAgents.filter((agent) => {
                const distance = Math.sqrt(
                    Math.pow(agent.x - worldPosition.x, 2) + Math.pow(agent.y - worldPosition.y, 2)
                );
                return distance <= broadcastRange;
            });

            console.log('Broadcast setup:', {
                totalAgents: combinedWorldAgents.length,
                agentsInRange: agentsInRange.length,
                agentNames: agentsInRange.map((a) => a.name),
                agentIds: agentsInRange.map((a) => a.id)
            });

            // Set broadcast status
            setBroadcastStatus({
                range: broadcastRange,
                agentsReached: agentsInRange.length,
                agentNames: agentsInRange.map((agent) => agent.name)
            });

            clearBroadcastMessage();

            // Create thread and send message if there are agents in range
            if (agentsInRange.length > 0 && chatBoxRef.current) {
                // Create new thread with unique ID
                const threadId = `thread-${Date.now()}`;
                const newThread = {
                    id: threadId,
                    message: messageText,
                    timestamp: new Date(),
                    agentsReached: agentsInRange.length,
                    agentNames: agentsInRange.map((agent) => agent.name)
                };

                // Add to threads list and set as current thread
                addThread(newThread);
                setCurrentThreadId(threadId);

                try {
                    // Send the broadcast message through the ChatBox system with thread ID and radius
                    // This now handles both regular and A2A agents through the unified system
                    await chatBoxRef.current.sendMessage(messageText, threadId, broadcastRange);
                    console.log(
                        `Broadcasting "${messageText}" to ${agentsInRange.length} agents in thread ${threadId}:`,
                        agentsInRange.map((a) => a.name)
                    );
                } catch (error) {
                    console.error('Failed to broadcast message:', error);
                }
            } else {
                console.log(`No agents in range - broadcast message "${messageText}" not sent, no thread created`);
            }

            // Clear broadcast status after 5 seconds
            clearBroadcastStatusAfterDelay(5000);
        }
    };

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
            setPublishStatus({
                type: 'success',
                message: `Published ${data.tileCount} custom tiles successfully!`
            });

            // Move custom tiles to published tiles and reset build state
            setPublishedTiles((prev) => ({
                layer0: { ...(prev.layer0 || {}), ...(customTiles.layer0 || {}) },
                layer1: { ...(prev.layer1 || {}), ...(customTiles.layer1 || {}) },
                layer2: { ...(prev.layer2 || {}), ...(customTiles.layer2 || {}) }
            }));
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
    const handleSpawnAgent = (importedAgent: { url: string; card: { name?: string }; characterImage?: string }) => {
        const agentId = `a2a-${Date.now()}`;
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        // Spawn near player position
        const spawnX = worldPosition.x + Math.floor(Math.random() * 6) - 3;
        const spawnY = worldPosition.y + Math.floor(Math.random() * 6) - 3;

        // Add to spawned A2A agents for UI tracking
        spawnAgent(importedAgent.url, {
            id: agentId,
            name: importedAgent.card.name || 'A2A Agent',
            x: spawnX,
            y: spawnY,
            color: randomColor,
            agentUrl: importedAgent.url,
            lastMoved: Date.now(),
            characterImage: importedAgent.characterImage
        });

        // If there's a character image, place it on layer2
        if (importedAgent.characterImage) {
            const charImage = importedAgent.characterImage;
            setCustomTiles((prev) => ({
                ...prev,
                layer2: {
                    ...prev.layer2,
                    [`${spawnX},${spawnY}`]: charImage
                }
            }));
        }
    };

    const handleUploadCharacterImage = (agentUrl: string, imageUrl: string) => {
        // Update the spawned agent's character image
        const agent = spawnedA2AAgents[agentUrl];
        if (!agent) return;

        // Place character image on layer2 at agent's current position
        setCustomTiles((prevTiles) => ({
            ...prevTiles,
            layer2: {
                ...prevTiles.layer2,
                [`${agent.x},${agent.y}`]: imageUrl
            }
        }));

        // Update agent with character image
        updateAgent(agentUrl, { characterImage: imageUrl });
    };

    const handleRemoveAgentFromMap = (agentUrl: string) => {
        removeAgent(agentUrl);
    };

    // Combine existing world agents with spawned A2A agents
    const combinedWorldAgents = [
        ...worldAgents,
        ...Object.values(spawnedA2AAgents).map((agent) => ({
            id: agent.id,
            x: agent.x,
            y: agent.y,
            color: agent.color,
            name: agent.name,
            behavior: 'A2A Agent',
            agentUrl: agent.agentUrl // Include agentUrl for A2A agents
        }))
    ];

    // Convert A2A agents to visible agents format for the map
    const a2aVisibleAgents = Object.values(spawnedA2AAgents)
        .map((agent) => {
            return {
                id: agent.id,
                x: agent.x, // world position
                y: agent.y, // world position
                screenX: 0, // Will be calculated in TileMap based on camera position
                screenY: 0, // Will be calculated in TileMap based on camera position
                color: agent.color,
                name: agent.name,
                hasCharacterImage: !!agent.characterImage
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
        hasCharacterImage?: boolean;
    }>;

    const combinedVisibleAgents = [...visibleAgents, ...a2aVisibleAgents];

    // A2A Agent movement system
    useEffect(() => {
        const moveA2AAgents = () => {
            const now = Date.now();
            const updated = { ...spawnedA2AAgents };

                Object.values(updated).forEach((agent) => {
                    // Move agents every 5-10 seconds randomly
                    if (now - agent.lastMoved > 5000 + Math.random() * 5000) {
                        const directions = [
                            { dx: 0, dy: -1 }, // up
                            { dx: 0, dy: 1 }, // down
                            { dx: -1, dy: 0 }, // left
                            { dx: 1, dy: 0 } // right
                        ];

                        const direction = directions[Math.floor(Math.random() * directions.length)];
                        const oldX = agent.x;
                        const oldY = agent.y;
                        const newX = agent.x + direction.dx;
                        const newY = agent.y + direction.dy;

                        // Check map boundaries
                        if (newX < 0 || newX >= MAP_TILES || newY < 0 || newY >= MAP_TILES) {
                            return; // Skip this agent's movement
                        }

                        // Check if player is at this position
                        if (newX === worldPosition.x && newY === worldPosition.y) {
                            return; // Skip this agent's movement
                        }

                        // Check if another agent (A2A or world agent) is at this position
                        const isOccupiedByA2A = Object.values(updated).some(
                            (otherAgent) => otherAgent.id !== agent.id && otherAgent.x === newX && otherAgent.y === newY
                        );
                        const isOccupiedByWorldAgent = worldAgents.some(
                            (worldAgent) => worldAgent.x === newX && worldAgent.y === newY
                        );
                        if (isOccupiedByA2A || isOccupiedByWorldAgent) {
                            return; // Skip this agent's movement
                        }

                        // Check layer1 collision - don't move if blocked
                        if (isLayer1Blocked(newX, newY)) {
                            return; // Skip this agent's movement
                        }

                        // Update character image position on layer2 if it exists
                        if (agent.characterImage) {
                            setCustomTiles((prevTiles) => {
                                const newLayer2 = { ...prevTiles.layer2 };
                                // Remove from old position
                                delete newLayer2[`${oldX},${oldY}`];
                                // Add to new position
                                newLayer2[`${newX},${newY}`] = agent.characterImage!;

                                return {
                                    ...prevTiles,
                                    layer2: newLayer2
                                };
                            });
                        }

                        // Simple boundary check (agents can move anywhere not blocked by layer1)
                        agent.x = newX;
                        agent.y = newY;
                        agent.lastMoved = now;
                    }
            });

            setAgents(updated);
        };

        const interval = setInterval(moveA2AAgents, 2000); // Check every 2 seconds
        return () => clearInterval(interval);
    }, [isLayer1Blocked, spawnedA2AAgents, worldAgents, worldPosition, setAgents, setCustomTiles]);

    return (
        <div className="flex h-screen w-full flex-col bg-gray-100">
            <div className="flex-1 overflow-hidden">
                <MapTab
                    isActive={activeTab === 'map'}
                    playerPosition={playerPosition}
                    mapData={mapData}
                    worldPosition={worldPosition}
                    visibleAgents={combinedVisibleAgents}
                    publishedTiles={publishedTiles}
                    customTiles={customTiles}
                    isAutonomous={isAutonomous}
                    onMobileMove={handleMobileMove}
                    broadcastMessage={broadcastMessage}
                    setBroadcastMessage={setBroadcastMessage}
                    onBroadcast={handleBroadcast}
                    broadcastStatus={broadcastStatus}
                    threads={threads}
                    onViewThread={handleViewThread}
                    userId={userId}
                    isLoading={isLoading}
                    toggleAutonomous={toggleAutonomous}
                    playerDirection={playerDirection}
                    playerIsMoving={isPlayerMoving}
                    collisionMap={collisionMap}
                />
                <BuildTab
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
                />
                <AgentTab
                    isActive={activeTab === 'agent'}
                    onSpawnAgent={handleSpawnAgent}
                    onRemoveAgentFromMap={handleRemoveAgentFromMap}
                    spawnedAgents={Object.keys(spawnedA2AAgents)}
                    onUploadCharacterImage={handleUploadCharacterImage}
                />
            </div>
            <Footer activeTab={activeTab} onTabChange={setActiveTab} onClickDialogueBox={openBottomSheet} />

            <BottomSheet isOpen={isBottomSheetOpen} onClose={closeBottomSheet}>
                <ThreadTab
                    isActive={true}
                    chatBoxRef={chatBoxRef}
                    lastCommentary={lastCommentary}
                    worldAgents={combinedWorldAgents}
                    worldPosition={worldPosition}
                    currentThreadId={currentThreadId}
                    threads={threads}
                    onThreadSelect={setCurrentThreadId}
                />
            </BottomSheet>
        </div>
    );
}
