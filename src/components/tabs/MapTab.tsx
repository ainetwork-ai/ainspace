'use client';

import React, { useCallback, useEffect } from 'react';
import TileMap from '@/components/TileMap';
import BaseTabContent from './BaseTabContent';
import PlayerJoystick from '@/components/controls/PlayerJoystick';
import { DIRECTION, TILE_SIZE } from '@/constants/game';
import { useAgentStore, useUIStore } from '@/stores';
import { useGameState } from '@/hooks/useGameState';
import { TileLayers, useBuildStore } from '@/stores/useBuildStore';

interface MapTabProps {
    isActive: boolean;
    visibleAgents: Array<{
        id: string;
        screenX: number;
        screenY: number;
        color: string;
        name: string;
    }>;
    publishedTiles: TileLayers;
    customTiles: TileLayers;
    broadcastMessage: string;
    setBroadcastMessage: (message: string) => void;
    onBroadcast: () => void;
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
}

export default function MapTab({
    isActive,
    visibleAgents,
    publishedTiles,
    customTiles,
    broadcastMessage,
    setBroadcastMessage,
    onBroadcast,
    broadcastStatus,
    threads,
    onViewThread,
    collisionMap
}: MapTabProps) {
    const { isBottomSheetOpen } = useUIStore();
    const { agents } = useAgentStore();
    const { movePlayer } = useGameState();

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

    const { isBlocked: globalIsBlocked } = useBuildStore();

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
              console.log(`Movement blocked: tile (${newX}, ${newY}) is blocked by collision`);
              return;
          }

          // Check if A2A agent is at this position
          const isOccupiedByA2A = Object.values(agents).some(
              (agent) => agent.x === newX && agent.y === newY
          );

          if (isOccupiedByA2A) {
              return;
          }
          console.log(direction);
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

    return (
        <BaseTabContent isActive={isActive} withPadding={false}>
            {/* Game Area */}
            <div className="relative flex h-full w-full flex-col">
                <div className="flex h-full w-full items-center justify-center">
                    <TileMap
                        mapData={mapData}
                        tileSize={TILE_SIZE}
                        playerPosition={playerPosition}
                        worldPosition={worldPosition}
                        agents={visibleAgents}
                        customTiles={{
                            layer0: { ...(publishedTiles.layer0 || {}), ...(customTiles.layer0 || {}) },
                            layer1: { ...(publishedTiles.layer1 || {}), ...(customTiles.layer1 || {}) },
                            layer2: { ...(publishedTiles.layer2 || {}), ...(customTiles.layer2 || {}) }
                        }}
                        layerVisibility={{ 0: true, 1: true, 2: true }}
                        backgroundImageSrc="/map/land_layer_0.png"
                        layer1ImageSrc="/map/land_layer_1.png"
                        playerDirection={playerDirection}
                        playerIsMoving={isPlayerMoving}
                        collisionMap={collisionMap}
                    />
                </div>

                {!isBottomSheetOpen && (
                    <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 transform">
                        <PlayerJoystick
                            onMove={handleMobileMove}
                            disabled={isAutonomous}
                            baseColor="#00000050"
                            stickColor="#FFF"
                        />
                    </div>
                )}

                {/* <div className="flex flex-col items-center mb-4">
          <div className="flex justify-center mb-2">
            <button
              onClick={() => handleMobileMove('up')}
              disabled={isAutonomous}
              className={`w-12 h-12 rounded text-xl font-bold transition-colors ${
                isAutonomous 
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white shadow-md'
              }`}
            >
              ↑
            </button>
          </div>
          
          <div className="flex space-x-2">
            <button
              onClick={() => handleMobileMove('left')}
              disabled={isAutonomous}
              className={`w-12 h-12 rounded text-xl font-bold transition-colors ${
                isAutonomous 
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white shadow-md'
              }`}
            >
              ←
            </button>
            <button
              onClick={() => handleMobileMove('down')}
              disabled={isAutonomous}
              className={`w-12 h-12 rounded text-xl font-bold transition-colors ${
                isAutonomous 
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white shadow-md'
              }`}
            >
              ↓
            </button>
            <button
              onClick={() => handleMobileMove('right')}
              disabled={isAutonomous}
              className={`w-12 h-12 rounded text-xl font-bold transition-colors ${
                isAutonomous 
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white shadow-md'
              }`}
            >
              →
            </button>
          </div>
        </div>
        
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
          <div className="flex items-center mb-2">
            <span className="text-sm font-medium text-gray-700 mr-2">📢 Broadcast:</span>
            {broadcastStatus && (
              <span className="text-xs bg-orange-100 text-orange-600 px-2 py-1 rounded-full animate-pulse">
                Sent {broadcastStatus.range}u range
              </span>
            )}
            {threads.length > 0 && !broadcastStatus && (
              <span className="text-xs bg-green-100 text-green-600 px-2 py-1 rounded-full">
                Thread created
              </span>
            )}
          </div>
          
          {broadcastStatus && (
            <div className="bg-orange-50 border border-orange-200 rounded p-2 mb-2">
              <div className="text-xs text-orange-800 mb-1">
                📶 Message broadcast {broadcastStatus.range} units from ({worldPosition.x}, {worldPosition.y})
              </div>
              <div className="text-xs text-orange-700">
                🤖 Reached {broadcastStatus.agentsReached} agent{broadcastStatus.agentsReached !== 1 ? 's' : ''}:
                {broadcastStatus.agentNames.length > 0 ? (
                  <span className="ml-1 font-medium">
                    {broadcastStatus.agentNames.join(', ')}
                  </span>
                ) : (
                  <span className="ml-1 text-gray-500">No agents in range</span>
                )}
              </div>
            </div>
          )}
          
          {threads.length > 0 && !broadcastStatus ? (
            <div className="bg-white border border-gray-200 rounded p-2 mb-2">
              <p className="text-sm text-gray-800">{threads[0].message}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-500">
                  Recent thread • {threads[0].agentsReached} agent{threads[0].agentsReached !== 1 ? 's' : ''}
                </span>
                <button
                  onClick={() => onViewThread(threads[0].id)}
                  className="text-xs bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600 transition-colors"
                >
                  View Thread
                </button>
              </div>
            </div>
          ) : !broadcastStatus && (
            <div className="text-xs text-gray-500 mb-2">
              Start a conversation with agents nearby (10u range)
            </div>
          )}
          
          <div className="flex space-x-2">
            <input
              type="text"
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onBroadcast()}
              placeholder="Type broadcast message..."
              className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              onClick={onBroadcast}
              disabled={!broadcastMessage.trim()}
              className="px-3 py-1 text-sm bg-orange-500 text-white rounded hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </div>
        </div>
        
        <div className="space-y-2">
          <div className="text-center">
            <p className="text-gray-600 text-sm">
              World: ({worldPosition.x}, {worldPosition.y})
            </p>
            {userId && (
              <p className="text-gray-400 text-xs">
                {userId.slice(0, 8)}... {isLoading ? '(Loading...)' : '(Saved)'}
              </p>
            )}
          </div>
          
          <div className="flex justify-center">
            <button
              onClick={toggleAutonomous}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isAutonomous
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {isAutonomous ? '🔴 Stop' : '▶️ Auto'}
            </button>
          </div>
          
          <div className="text-center text-xs text-gray-500">
            {isAutonomous ? 'Moving autonomously...' : 'Use arrow keys to move'}
          </div>
        </div> */}
            </div>
        </BaseTabContent>
    );
}
