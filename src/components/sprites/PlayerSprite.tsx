'use client';

import { SpriteAnimator } from 'react-sprite-animator';
import { TILE_SIZE } from '@/constants/game';

interface PlayerSpriteProps {
    screenX: number;
    screenY: number;
    tileSize: number;
    direction: 'up' | 'down' | 'left' | 'right';
    isMoving: boolean;
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

export default function PlayerSprite({ screenX, screenY, tileSize, direction, isMoving }: PlayerSpriteProps) {
    const startFrame = getStartFrame(direction);

    return (
        <div
            style={{
                position: 'absolute',
                left: `${screenX * tileSize - TILE_SIZE / 6}px`,
                top: `${screenY * tileSize - TILE_SIZE / 4}px`,
                width: `${tileSize}px`,
                height: `${tileSize}px`,
                pointerEvents: 'none',
                zIndex: 10
            }}
        >
            <SpriteAnimator
                key={`player-${direction}`}
                sprite="/sprite/sprite_kkaebi.png"
                width={TILE_SIZE}
                height={TILE_SIZE}
                scale={1}
                fps={6}
                frameCount={startFrame + 3}
                direction={'horizontal'}
                shouldAnimate={isMoving}
                startFrame={startFrame}
            />
        </div>
    );
}
