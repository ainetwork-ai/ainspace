'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTiledMap } from '@/hooks/useTiledMap';
import { DIRECTION, MAP_TILES, TILE_SIZE } from '@/constants/game';
import { SpriteAnimator } from 'react-sprite-animator';
import { useGameStateStore } from '@/stores';
import { AgentState } from '@/lib/agent';

export default function TiledMapCanvas({ 
  worldPosition,
  agents,
}: { 
  worldPosition: { x: number; y: number };
  agents: AgentState[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { playerDirection } = useGameStateStore();
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const updateCanvasSize = () => {
        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();

            if (rect.width > 0 && rect.height > 0) {
                setCanvasSize({
                    width: rect.width,
                    height: rect.height
                });
            }
        }
    };

    const timeoutId = setTimeout(updateCanvasSize, 100);
    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => {
        clearTimeout(timeoutId);
        window.removeEventListener('resize', updateCanvasSize);
    };
}, []);

const getStartFrame = (direction: DIRECTION) => {
  const directionMap = {
      [DIRECTION.DOWN]: 0,
      [DIRECTION.LEFT]: 3,
      [DIRECTION.UP]: 6,
      [DIRECTION.RIGHT]: 9
  };
  return directionMap[direction as keyof typeof directionMap] || 0;
};


  const { canvasRef, isLoaded, cameraTilePosition } = useTiledMap(
    '/map/design map_640x640_gallery test(11.11).tmj',
    canvasSize
  );

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas ref={canvasRef} width={canvasSize.width} height={canvasSize.height} />


            {/* Render Agents using SpriteAnimator */}
            {agents.map((agent) => {

                const agentScreenX = agent.x - cameraTilePosition.x;
                const agentScreenY = agent.y - cameraTilePosition.y;

                if (agentScreenX < -1 || agentScreenX > MAP_TILES || agentScreenY < -1 || agentScreenY > MAP_TILES) {
                    return null;
                }

                const agentIsMoving = agent.isMoving || false;
                const agentDirection = agent.direction || DIRECTION.DOWN;
                const agentStartFrame = getStartFrame(agentDirection);
                const agentSpriteUrl = agent.spriteUrl || '/sprite/sprite_user.png';
                const agentSpriteHeight = agent.spriteHeight || TILE_SIZE;

                const topOffset = agentSpriteHeight === TILE_SIZE ? agentSpriteHeight / 4 : agentSpriteHeight / 1.5;

                return (
                    <div
                        key={agent.id}
                        style={{
                            position: 'absolute',
                            left: `${agentScreenX * TILE_SIZE - TILE_SIZE / 4}px`,
                            top: `${agentScreenY * TILE_SIZE - topOffset}px`,
                            width: `${TILE_SIZE}px`,
                            height: `${TILE_SIZE}px`,
                            pointerEvents: 'auto',
                            cursor: 'default'
                        }}
                    >
                        <SpriteAnimator
                            key={agent.id}
                            sprite={agentSpriteUrl}
                            width={TILE_SIZE}
                            height={agentSpriteHeight}
                            scale={1}
                            fps={6}
                            frameCount={agentStartFrame + 3}
                            direction={'horizontal'}
                            shouldAnimate={agentIsMoving}
                            startFrame={agentStartFrame}
                        />
                        {/* Show agent name and coordinates */}
                        <div
                            style={{
                                position: 'absolute',
                                top: '-20px',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                color: '#fff',
                                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                whiteSpace: 'nowrap',
                                zIndex: 20,
                                pointerEvents: 'none'
                            }}
                        >
                            {/* showCollisionMap && !hideCoordinates && */ agent.x !== undefined && agent.y !== undefined
                                ? `${agent.name} (${agent.x}, ${agent.y})`
                                : `${agent.name}`}
                        </div>
                    </div>
                );
            })}
            {/* Render Player using SpriteAnimator */}
            {(() => {
                // worldPosition과 cameraTilePosition 모두 맵 중앙 기준 좌표계 (맵 중앙 = 0,0)
                // 따라서 변환 없이 직접 계산 가능
                const playerScreenTileX = worldPosition.x - cameraTilePosition.x;
                const playerScreenTileY = worldPosition.y - cameraTilePosition.y;
                const playerStartFrame = getStartFrame(playerDirection);

                return (
                    <div
                        style={{
                            position: 'absolute',
                            left: `${playerScreenTileX * TILE_SIZE - TILE_SIZE / 4}px`,
                            top: `${playerScreenTileY * TILE_SIZE - 60}px`,
                            width: `${TILE_SIZE}px`,
                            height: `${TILE_SIZE}px`,
                            pointerEvents: 'none',
                            zIndex: 10
                        }}
                    >
                        <SpriteAnimator
                            key={`player-${playerDirection}`}
                            sprite="/sprite/sprite_user.png"
                            width={TILE_SIZE}
                            height={86}
                            scale={1}
                            fps={6}
                            frameCount={playerStartFrame + 3}
                            direction={'horizontal'}
                            shouldAnimate={true}
                            startFrame={playerStartFrame}
                        />
                        {/* Show player coordinates when grid is visible */}
                        {/* {showCollisionMap && !hideCoordinates && (
                            <div
                                style={{
                                    position: 'absolute',
                                    bottom: '-18px',
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    fontSize: '11px',
                                    fontWeight: 'bold',
                                    color: '#fff',
                                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    whiteSpace: 'nowrap',
                                    zIndex: 20,
                                    pointerEvents: 'none'
                                }}
                            >
                                ({worldPosition.x}, {worldPosition.y})
                            </div>
                        )} */}
                    </div>
                );
            })()}
    </div>
  );
}
