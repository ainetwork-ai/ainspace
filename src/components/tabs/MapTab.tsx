'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import Image from 'next/image';
import { disconnect } from '@wagmi/core';

import TileMap from '@/components/TileMap';
import BaseTabContent from './BaseTabContent';
import PlayerJoystick from '@/components/controls/PlayerJoystick';
import { DIRECTION, TILE_SIZE } from '@/constants/game';
import { AgentInformation, useAgentStore, useThreadStore } from '@/stores';
import { useGameState } from '@/hooks/useGameState';
import { TileLayers, useBuildStore } from '@/stores/useBuildStore';
import { shortAddress } from '@/lib/utils';
import { config } from '@/lib/wagmi-config';
import ChatBoxOverlay from '../ChatBoxOverlay';
import { ChatBoxRef } from '../ChatBox';

interface MapTabProps {
    isActive: boolean;
    visibleAgents: AgentInformation[];
    publishedTiles: TileLayers;
    customTiles: TileLayers;
    broadcastMessage: string;
    setBroadcastMessage: (message: string) => void;
    broadcastStatus: {
        range: number;
        agentsReached: number;
        agentNames: string[];
    } | null;
    threads: {
        id: string;
        message: string;
        timestamp: Date;
        agentsReached: number;
        agentNames: string[];
    }[];
    onViewThread: (threadId?: string) => void;
    collisionMap: { [key: string]: boolean };
    onAgentClick?: (agentId: string, agentName: string) => void;
}

export default function MapTab({
    isActive,
    visibleAgents,
    publishedTiles,
    customTiles,
    broadcastMessage,
    collisionMap,
    onAgentClick
}: MapTabProps) {
    const { address } = useAccount();
    const { agents } = useAgentStore();
    const { movePlayer } = useGameState();
    const chatBoxRef = useRef<ChatBoxRef>(null);

    const {
        playerPosition,
        mapData,
        worldPosition,
        isLoading,
        isAutonomous,
        resetLocation,
        playerDirection,
        isPlayerMoving
    } = useGameState();

    const {
        setThreads,
        addThread,
        setCurrentThreadId,
        setBroadcastStatus,
        clearBroadcastMessage,
        clearBroadcastStatusAfterDelay
    } = useThreadStore();

    const { isBlocked: globalIsBlocked } = useBuildStore();

    const [isJoystickVisible, setIsJoystickVisible] = useState(true);

    const handleBroadcast = async () => {
      if (broadcastMessage.trim()) {
          const messageText = broadcastMessage.trim();

          // Calculate agents within range (default broadcast range: 10 units)
          const broadcastRange = 10;
          const agentsInRange = visibleAgents.filter((agent) => {
              const distance = Math.sqrt(
                  Math.pow(agent.x - worldPosition.x, 2) + Math.pow(agent.y - worldPosition.y, 2)
              );
              return distance <= broadcastRange;
          });

          console.log('Broadcast setup:', {
              totalAgents: visibleAgents.length,
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

    const handleMobileMove = useCallback(
        (direction: DIRECTION) => {
            if (isAutonomous) return;

            // Calculate new position
            let newX = worldPosition.x;
            let newY = worldPosition.y;
            switch (direction) {
                case DIRECTION.UP:
                    newY -= 1;
                    break;
                case DIRECTION.DOWN:
                    newY += 1;
                    break;
                case DIRECTION.LEFT:
                    newX -= 1;
                    break;
                case DIRECTION.RIGHT:
                    newX += 1;
                    break;
                case DIRECTION.STOP:
                default:
                    break;
            }

            // Check if tile is blocked by collision map
            if (globalIsBlocked(newX, newY)) {
                return;
            }

            // Check if A2A agent is at this position
            const isOccupiedByA2A = Object.values(agents).some((agent) => agent.x === newX && agent.y === newY);

            if (isOccupiedByA2A) {
                const blockingAgent = Object.values(agents).find((agent) => agent.x === newX && agent.y === newY);
                return;
            }
            // Move player (this will also check worldAgents in useGameState)
            movePlayer(direction);
        },
        [isAutonomous, worldPosition, agents, movePlayer]
    );

    // Keyboard handling for player movement (works alongside joystick)
    useEffect(() => {
        const handleKeyPress = (event: KeyboardEvent) => {
            // Reset location with Ctrl+R
            if (event.ctrlKey && event.key.toLowerCase() === 'r') {
                event.preventDefault();
                resetLocation();
                console.log('Location reset to initial position (63, 58)');
                return;
            }

            if (isLoading || isAutonomous) return;

            switch (event.key) {
                case 'ArrowUp':
                    event.preventDefault();
                    handleMobileMove(DIRECTION.UP);
                    break;
                case 'ArrowDown':
                    event.preventDefault();
                    handleMobileMove(DIRECTION.DOWN);
                    break;
                case 'ArrowLeft':
                    event.preventDefault();
                    handleMobileMove(DIRECTION.LEFT);
                    break;
                case 'ArrowRight':
                    event.preventDefault();
                    handleMobileMove(DIRECTION.RIGHT);
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [handleMobileMove, isLoading, isAutonomous, resetLocation]);

    // FIXME(yoojin): get threads need to move here from ChatBoxOverlay
    // useEffect(() => {
    //   if (!isActive) {
    //     console.log('not active why?');
    //     return;
    //   }

    //   const fetchThreads = async () => {
    //     const response = await fetch(`/api/threads?userId=${address}`);
    //     const data = await response.json();
    //     if (data.success && data.threads) {
    //       setThreads(data.threads);
    //     }
    //   }
    //   fetchThreads();
    // }, [isActive, address, setThreads]);

    return (
        <BaseTabContent isActive={isActive} withPadding={false}>
            {/* Game Area */}
            <div className="relative flex h-full w-full flex-col" style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}>
                <div className="flex h-full w-full items-center justify-center select-none" style={{ WebkitUserSelect: 'none', userSelect: 'none' }}>
                    <TileMap
                        mapData={mapData}
                        tileSize={TILE_SIZE}
                        playerPosition={playerPosition}
                        worldPosition={worldPosition}
                        agents={visibleAgents.map((agent) => ({
                            ...agent,
                            screenX: 0,
                            screenY: 0,
                        }))} // FIXME(yoojin): agent type 정리해야함
                        customTiles={{
                            layer0: { ...(publishedTiles.layer0 || {}), ...(customTiles.layer0 || {}) },
                            layer1: { ...(publishedTiles.layer1 || {}), ...(customTiles.layer1 || {}) },
                            layer2: { ...(publishedTiles.layer2 || {}), ...(customTiles.layer2 || {}) }
                        }}
                        layerVisibility={{ 0: true, 1: true, 2: true }}
                        playerDirection={playerDirection}
                        playerIsMoving={isPlayerMoving}
                        collisionMap={collisionMap}
                        onAgentClick={onAgentClick}
                    />
                </div>

                {address && (
                    <button
                        onClick={() => disconnect(config)}
                        className="absolute top-4 right-4 inline-flex cursor-pointer flex-row items-center justify-center gap-2 rounded-lg bg-white p-2"
                    >
                        <Image src="/agent/defaultAvatar.svg" alt="agent" width={20} height={20} />
                        <p className="text-sm font-bold text-black">{shortAddress(address)}</p>
                    </button>
                )}
                {isJoystickVisible && (
                    <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 transform">
                        <PlayerJoystick
                            onMove={handleMobileMove}
                            disabled={isAutonomous}
                            baseColor="#00000050"
                            stickColor="#FFF"
                            size={160}
                        />
                    </div>
                )}
            </div>
            <ChatBoxOverlay
                chatBoxRef={chatBoxRef}
                className="fixed bottom-[73px] left-0"
                setJoystickVisible={setIsJoystickVisible}
            />
        </BaseTabContent>
    );
}
