'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount, useConnect } from 'wagmi';
import Image from 'next/image';
import { disconnect } from '@wagmi/core';
import { MapPin } from 'lucide-react';

import BaseTabContent from './BaseTabContent';
import PlayerJoystick from '@/components/controls/PlayerJoystick';
import { BROADCAST_RADIUS, DIRECTION, TILE_SIZE, MAP_NAMES } from '@/constants/game';
import { useGameState } from '@/hooks/useGameState';
import { TileLayers } from '@/stores/useBuildStore';
import { shortAddress } from '@/lib/utils';
import { config } from '@/lib/wagmi-config';
import ChatBoxOverlay from '@/components/chat/ChatBoxOverlay';
import { ChatBoxRef } from '@/components/chat/ChatBox';
import { useAgentStore, useThreadStore, useUIStore } from '@/stores';
import { useMapStore } from '@/stores/useMapStore';
import TileMap from '@/components/TileMap';
import { Z_INDEX_OFFSETS } from '@/constants/common';
import { StoredAgent } from '@/lib/redis';
import { getMapNameFromCoordinates } from '@/lib/map-utils';
import LoadingModal from '@/components/LoadingModal';
import PlaceAgentModal from '@/components/PlaceAgentModal';

interface MapTabProps {
    isActive: boolean;
    publishedTiles: TileLayers;
    customTiles: TileLayers;
    collisionMap: { [key: string]: boolean };
    onAgentClick?: (agentId: string, agentName: string) => void;
    HUDOff: boolean;
    onHUDOffChange: (hudOff: boolean) => void;
    isPositionValid: (x: number, y: number) => boolean;
    onPlaceAgentAtPosition?: (agent: StoredAgent, x: number, y: number, mapName: MAP_NAMES) => Promise<void>;
}

export default function MapTab({
    isActive,
    publishedTiles,
    customTiles,
    collisionMap,
    onAgentClick,
    HUDOff,
    onHUDOffChange,
    isPositionValid,
    onPlaceAgentAtPosition,
}: MapTabProps) {
    const { address } = useAccount();
    const { connect, connectors } = useConnect();
    const { agents } = useAgentStore();
    const { clearThreads } = useThreadStore();
    const { selectedAgentForPlacement, setSelectedAgentForPlacement } = useUIStore();
    const [placementError, setPlacementError] = useState<string | null>(null);
    const [selectedPosition, setSelectedPosition] = useState<{ x: number; y: number } | null>(null);
    const [isPlacing, setIsPlacing] = useState(false);
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

        const broadcastRadius = BROADCAST_RADIUS;
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

    // Handle agent placement click (two-tap: first tap selects, second tap confirms)
    const handleAgentPlacementClick = useCallback(async (worldX: number, worldY: number) => {
        if (!selectedAgentForPlacement || !onPlaceAgentAtPosition) return;

        const { agent, allowedMaps } = selectedAgentForPlacement;

        // Clear previous error
        setPlacementError(null);

        console.log('Clicked coordinates:', worldX, worldY);

        // Check if clicked coordinates are within one of the allowed maps
        const clickedMap = getMapNameFromCoordinates(worldX, worldY);
        const isAllowedMap = allowedMaps.includes('*') || (clickedMap && allowedMaps.includes(clickedMap));

        if (!isAllowedMap) {
            setPlacementError(`Please place agent within allowed area.`);
            setSelectedPosition(null);
            return;
        }

        // Check if position is valid (not occupied or blocked)
        if (!isPositionValid(worldX, worldY)) {
            setPlacementError('This position is occupied or blocked');
            setSelectedPosition(null);
            return;
        }

        // Two-tap logic: first tap selects position, second tap confirms
        if (selectedPosition && selectedPosition.x === worldX && selectedPosition.y === worldY) {
            // Second tap on same position - confirm placement
            setIsPlacing(true);
            try {
                await onPlaceAgentAtPosition(agent, worldX, worldY, clickedMap as MAP_NAMES);
                // Success - exit placement mode
                setSelectedAgentForPlacement(null);
                setSelectedPosition(null);
                setPlacementError(null);
            } catch (error) {
                setPlacementError(`Failed to place agent: ${error instanceof Error ? error.message : 'Unknown error'}`);
            } finally {
                setIsPlacing(false);
            }
        } else {
            // First tap or different position - select this position
            setSelectedPosition({ x: worldX, y: worldY });
        }
    }, [selectedAgentForPlacement, onPlaceAgentAtPosition, isPositionValid, setSelectedAgentForPlacement, selectedPosition]);

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

    const handleWalletDisconnect = useCallback(() => {
        disconnect(config);
        clearThreads();
    }, [clearThreads]);

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
                {/* Agent Placement Mode UI */}
                {selectedAgentForPlacement && (
                    <div
                        className="absolute top-4 left-0 right-0 flex justify-center"
                        style={{ zIndex: Z_INDEX_OFFSETS.UI + 100 }}
                    >
                        <PlaceAgentModal
                            agentName={selectedAgentForPlacement.agent.card.name}
                            allowedMaps={selectedAgentForPlacement.allowedMaps}
                            errorMessage={placementError}
                            onCancel={() => {
                                setSelectedAgentForPlacement(null);
                                setSelectedPosition(null);
                                setPlacementError(null);
                            }}
                        />
                    </div>
                )}

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
                        buildMode={selectedAgentForPlacement ? 'paint' : 'view'}
                        onTileClick={selectedAgentForPlacement ? handleAgentPlacementClick : undefined}
                        selectedItemDimensions={selectedAgentForPlacement ? { width: 1, height: 1 } : null}
                        isPositionValid={selectedAgentForPlacement ? isPositionValid : undefined}
                        selectedPosition={selectedPosition}
                    />
                </div>

                {address ? (
                    <button
                        onClick={handleWalletDisconnect}
                        className="absolute top-4 right-4 inline-flex cursor-pointer flex-row items-center justify-center gap-2 rounded-lg bg-white p-2"
                        style={{ zIndex: Z_INDEX_OFFSETS.UI }}
                    >
                        <Image src="/agent/defaultAvatar.svg" alt="agent" width={20} height={20} />
                        <p className="text-sm font-bold text-black">{shortAddress(address)}</p>
                    </button>
                ) : (
                  <button
                    onClick={() => connect({ connector: connectors[0] })}
                    className="absolute top-4 right-4 inline-flex cursor-pointer flex-row items-center justify-center gap-2 rounded-lg bg-[#7F4FE8] p-2 px-4"
                    style={{ zIndex: Z_INDEX_OFFSETS.UI }}
                  >
                    <p className="text-sm font-bold text-white">Wallet Login</p>
                  </button>
                )}

                {/* Current Area Display */}
                <div
                    className="absolute top-16 right-4 inline-flex flex-row items-center justify-center gap-2 rounded-lg bg-black/50 backdrop-blur-[6px] px-3 py-1.5"
                    style={{ zIndex: Z_INDEX_OFFSETS.UI }}
                >
                    <MapPin size={16} className="text-[#C0A9F1]" />
                    <p className="text-sm font-bold">
                        <span className="text-[#C0A9F1]">Area: </span>
                        <span className="text-white">{worldPosition ? (getMapNameFromCoordinates(worldPosition.x, worldPosition.y) || 'Unknown') : 'Unknown'}</span>
                        {worldPosition && <span className="text-[#CAD0D7]"> [{worldPosition.x}, {worldPosition.y}]</span>}
                    </p>
                </div>
                {isJoystickVisible && (
                    <div 
                        className="absolute bottom-4 left-1/2 -translate-x-1/2 transform"
                        style={{ zIndex: Z_INDEX_OFFSETS.UI - 1 }}
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
            <LoadingModal open={isPlacing} />
        </BaseTabContent>
    );
}
