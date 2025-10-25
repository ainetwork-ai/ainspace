'use client';

import { SpriteAnimator } from 'react-sprite-animator';
import { DIRECTION, TILE_SIZE } from '@/constants/game';
import { useSpritePreload } from '@/hooks/useSpritePreload';

interface PlayerSpriteProps {
    screenX: number;
    screenY: number;
    tileSize: number;
    direction: DIRECTION;
    isMoving: boolean;
}

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
    // Preload sprite to prevent flickering
    const { loaded } = useSpritePreload(['/sprite/sprite_user.png']);

    const startFrame = getStartFrame(direction);

    // Don't render until sprite is preloaded
    if (!loaded) {
        return null;
    }

    return (
        <div
            style={{
                position: 'absolute',
                left: `${screenX * tileSize - TILE_SIZE / 6}px`,
                top: `${screenY * tileSize - 60}px`,
                width: `${tileSize}px`,
                height: `${tileSize}px`,
                pointerEvents: 'none',
                zIndex: 10
            }}
        >
            <SpriteAnimator
                key="player"
                sprite="/sprite/sprite_user.png"
                width={TILE_SIZE}
                height={86}
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
