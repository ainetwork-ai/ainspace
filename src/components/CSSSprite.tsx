'use client';

import { memo, useEffect, useRef, useState } from 'react';

const FRAMES_PER_DIRECTION = 3;
const TOTAL_FRAMES = 12;

/** Global image cache — each sprite URL is loaded only once. */
const imageCache = new Map<string, HTMLImageElement>();

function preloadImage(src: string): void {
    if (imageCache.has(src)) return;
    const img = new Image();
    img.src = src;
    imageCache.set(src, img);
}

/**
 * Pure CSS background-position based sprite component.
 * Replaces react-sprite-animator to avoid per-instance Image() loads
 * and excessive setState calls on mount.
 */
const CSSSprite = memo(function CSSSprite(props: {
    sprite: string;
    width: number;
    height: number;
    scale?: number;
    fps: number;
    direction: 'horizontal' | 'vertical';
    shouldAnimate: boolean;
    startFrame: number;
}) {
    const { sprite, width, height, scale = 1, fps, shouldAnimate, startFrame } = props;
    const [currentFrame, setCurrentFrame] = useState(startFrame);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        preloadImage(sprite);
    }, [sprite]);

    useEffect(() => {
        setCurrentFrame(startFrame);
    }, [startFrame]);

    useEffect(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        if (shouldAnimate) {
            intervalRef.current = setInterval(() => {
                setCurrentFrame((prev) => {
                    const next = prev + 1;
                    return next >= startFrame + FRAMES_PER_DIRECTION ? startFrame : next;
                });
            }, 1000 / fps);
        }

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [shouldAnimate, fps, startFrame]);

    const displayWidth = width * scale;
    const displayHeight = height * scale;

    return (
        <div
            style={{
                width: displayWidth,
                height: displayHeight,
                overflow: 'hidden',
                backgroundImage: `url(${sprite})`,
                backgroundPosition: `-${currentFrame * displayWidth}px 0px`,
                backgroundSize: `${TOTAL_FRAMES * displayWidth}px ${displayHeight}px`,
                backgroundRepeat: 'no-repeat',
            }}
        />
    );
});

export default CSSSprite;
