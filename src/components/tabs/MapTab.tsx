'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import Image from 'next/image';
import { disconnect } from '@wagmi/core';

import BaseTabContent from './BaseTabContent';
import PlayerJoystick from '@/components/controls/PlayerJoystick';
import { DIRECTION, TILE_SIZE } from '@/constants/game';
import { useGameState } from '@/hooks/useGameState';
import { TileLayers } from '@/stores/useBuildStore';
import { shortAddress } from '@/lib/utils';
import { config } from '@/lib/wagmi-config';
import ChatBoxOverlay from '../ChatBoxOverlay';
import { ChatBoxRef } from '../ChatBox';
import { useAgentStore } from '@/stores';
import { useMapStore } from '@/stores/useMapStore';
import TileMap from '../TileMap';
import { Z_INDEX_OFFSETS } from '@/constants/common';

interface MapTabProps {
    isActive: boolean;
    publishedTiles: TileLayers;
    customTiles: TileLayers;
    collisionMap: { [key: string]: boolean };
    onAgentClick?: (agentId: string, agentName: string) => void;
    HUDOff: boolean;
    onHUDOffChange: (hudOff: boolean) => void;
}

export default function MapTab({
    isActive,
    publishedTiles,
    customTiles,
    collisionMap,
    onAgentClick,
    HUDOff,
    onHUDOffChange,
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
        isPlayerMoving,
    } = useGameState();

    const { isCollisionTile, mapStartPosition, mapEndPosition } = useMapStore();

    const [isJoystickVisible, setIsJoystickVisible] = useState(true);

    // Get current agents in radius
    const getCurrentAgentsInRadius = useCallback(() => {
        if (!worldPosition) return [];

        const broadcastRadius = 10;
        return agents.filter((agent) => {
            const distance = Math.sqrt(
                Math.pow(agent.x - worldPosition.x, 2) + Math.pow(agent.y - worldPosition.y, 2)
            );
            return distance <= broadcastRadius;
        });
    }, [agents, worldPosition]);
    
    const isOutOfBounds = useCallback((x: number, y: number) => {
      return x < mapStartPosition.x || x > mapEndPosition.x || y < mapStartPosition.y || y > mapEndPosition.y;
    }, [mapStartPosition.x, mapStartPosition.y, mapEndPosition.x, mapEndPosition.y]);

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

            // FIXME(yoojin): temp comment out
            // // Check if tile is blocked by collision map
            // if (globalIsBlocked(newX, newY)) {
            //     return;
            // }

            if (isCollisionTile(newX, newY)) {
                return;
            }

            if (isOutOfBounds(newX, newY)) {
                return;
            }

            // Check if A2A agent is at this position
            const isOccupiedByA2A = Object.values(agents).some((agent) => agent.x === newX && agent.y === newY);

            if (isOccupiedByA2A) {
                return;
            }
            // Move player (this will also check worldAgents in useGameState)
            movePlayer(direction);
        },
        [isAutonomous, worldPosition, agents, movePlayer, isOutOfBounds, isCollisionTile]
    );

    // Keyboard handling for player movement (works alongside joystick)
    useEffect(() => {
        const handleKeyPress = (event: KeyboardEvent) => {
            // Reset location with Ctrl+R
            if (event.ctrlKey) {
                if (event.key.toLowerCase() === 'r') {
                    event.preventDefault();
                    resetLocation();
                    console.log('Location reset to initial position (63, 58)');
                    return;
                } else if (event.key.toLowerCase() === 'h') {
                    onHUDOffChange(!HUDOff);
                    return;
                }
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
    }, [handleMobileMove, isLoading, isAutonomous, resetLocation, onHUDOffChange, HUDOff]);

    return (
        <BaseTabContent isActive={isActive} withPadding={false}>
            {/* Game Area */}
            <div className="relative flex h-full w-full flex-col" style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}>
                <div className="flex h-full w-full items-center justify-center select-none" style={{ WebkitUserSelect: 'none', userSelect: 'none' }}>
                    <TileMap
                        mapData={mapData}
                        tileSize={TILE_SIZE}
                        playerPosition={playerPosition}
                        agents={agents}
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
                        style={{ zIndex: Z_INDEX_OFFSETS.UI }}
                    >
                        <Image src="/agent/defaultAvatar.svg" alt="agent" width={20} height={20} />
                        <p className="text-sm font-bold text-black">{shortAddress(address)}</p>
                    </button>
                )}
                {isJoystickVisible && (
                    <div 
                        className="absolute bottom-4 left-1/2 -translate-x-1/2 transform"
                        style={{ zIndex: Z_INDEX_OFFSETS.GAME + 1 }}
                        hidden={HUDOff}
                    >
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
                className="fixed bottom-[73px] left-0 z-1000"
                setJoystickVisible={setIsJoystickVisible}
                currentAgentsInRadius={getCurrentAgentsInRadius() || []}
                HUDOff={HUDOff}
            />
        </BaseTabContent>
    );
}
