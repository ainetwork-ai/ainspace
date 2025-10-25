'use client';

import { SpriteAnimator } from 'react-sprite-animator';
import { DIRECTION, TILE_SIZE } from '@/constants/game';
import { useSpritePreload } from '@/hooks/useSpritePreload';

interface AgentSpriteProps {
    id: string;
    screenX: number;
    screenY: number;
    tileSize: number;
    direction: DIRECTION;
    isMoving: boolean;
    spriteUrl?: string;
    spriteHeight?: number;
    spriteWidth?: number;
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

export default function AgentSprite({
    id,
    screenX,
    screenY,
    tileSize,
    direction,
    isMoving,
    spriteUrl = '/sprite/sprite_user.png',
    spriteHeight = TILE_SIZE,
    spriteWidth = TILE_SIZE
}: AgentSpriteProps) {
    // Preload sprite to prevent flickering
    const { loaded } = useSpritePreload([spriteUrl]);

    const startFrame = getStartFrame(direction);

    const topOffset = spriteHeight === TILE_SIZE ? spriteHeight / 6 : spriteHeight / 1.5;

    // Don't render until sprite is preloaded
    if (!loaded) {
        return null;
    }

    return (
        <div
            key={id}
            style={{
                position: 'absolute',
                left: `${screenX * tileSize - TILE_SIZE / 6}px`,
                top: `${screenY * tileSize - 60}px`,
                width: `${tileSize}px`,
                height: `${tileSize}px`,
                pointerEvents: 'none'
            }}
        >
            <SpriteAnimator
                key={id}
                sprite={spriteUrl}
                width={86}
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
