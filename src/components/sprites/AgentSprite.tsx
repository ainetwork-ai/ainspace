'use client';

import { SpriteAnimator } from 'react-sprite-animator';
import { TILE_SIZE } from '@/constants/game';

interface AgentSpriteProps {
    id: string;
    screenX: number;
    screenY: number;
    tileSize: number;
    direction: 'up' | 'down' | 'left' | 'right';
    isMoving: boolean;
    spriteUrl?: string;
    spriteHeight?: number;
    spriteWidth?: number;
}

// Helper function to get startFrame based on direction
const getStartFrame = (direction: 'up' | 'down' | 'left' | 'right') => {
    const directionMap = {
        down: 0,
        left: 3,
        up: 6,
        right: 9
    };
    return directionMap[direction];
};

export default function AgentSprite({
    id,
    screenX,
    screenY,
    tileSize,
    direction,
    isMoving,
    spriteUrl = '/sprite/sprite_kkaebi.png',
    spriteHeight = TILE_SIZE,
    spriteWidth = TILE_SIZE
}: AgentSpriteProps) {
    const startFrame = getStartFrame(direction);

    // Calculate top offset based on sprite height
    const topOffset =
        spriteHeight === TILE_SIZE
            ? spriteHeight / 6 // For 40px height sprites (agent-3)
            : spriteHeight / 1.5; // For 86px height sprites (agent-1, agent-2)

    return (
        <div
            key={id}
            style={{
                position: 'absolute',
                left: `${screenX * tileSize - TILE_SIZE / 6}px`,
                top: `${screenY * tileSize - topOffset}px`,
                width: `${tileSize}px`,
                height: `${tileSize}px`,
                pointerEvents: 'none'
            }}
        >
            <SpriteAnimator
                key={`${id}-${direction}`}
                sprite={spriteUrl}
                width={40}
                height={spriteHeight}
                scale={spriteWidth / tileSize}
                fps={6}
                frameCount={startFrame + 3}
                direction={'horizontal'}
                shouldAnimate={isMoving}
                startFrame={startFrame}
            />
        </div>
    );
}
