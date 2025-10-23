'use client';

import { SpriteAnimator } from 'react-sprite-animator';
import { DIRECTION, TILE_SIZE } from '@/constants/game';

interface PlayerSpriteProps {
    screenX: number;
    screenY: number;
    tileSize: number;
    direction: DIRECTION;
    isMoving: boolean;
}

// Helper function to get startFrame based on direction
const getStartFrame = (direction: DIRECTION) => {
    const directionMap = {
        [DIRECTION.DOWN]: 0,
        [DIRECTION.LEFT]: 3,
        [DIRECTION.UP]: 6,
        [DIRECTION.RIGHT]: 9
    };
    return directionMap[direction as keyof typeof directionMap] || 0;
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
