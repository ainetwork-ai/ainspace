'use client';

import { memo, useEffect, useRef, useState } from 'react';

const FRAMES_PER_DIRECTION = 3;
const DEFAULT_TOTAL_FRAMES = 12;

/** Global image cache — each sprite URL is loaded only once. */
const imageCache = new Map<string, HTMLImageElement>();

function preloadImage(src: string): void {
    if (imageCache.has(src)) return;
    const img = new Image();
    img.src = src;
    imageCache.set(src, img);
}

function getTotalFrames(src: string, frameWidth: number): number {
    const img = imageCache.get(src);
    if (img && img.naturalWidth > 0) {
        return Math.floor(img.naturalWidth / frameWidth);
    }
    return DEFAULT_TOTAL_FRAMES;
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
    const totalFrames = getTotalFrames(sprite, width);
    const clampedStart = Math.min(startFrame, Math.max(totalFrames - 1, 0));
    const maxFrame = Math.min(clampedStart + FRAMES_PER_DIRECTION, totalFrames);

    const [currentFrame, setCurrentFrame] = useState(clampedStart);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        preloadImage(sprite);
    }, [sprite]);

    useEffect(() => {
        setCurrentFrame(clampedStart);
    }, [clampedStart]);

    useEffect(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        if (shouldAnimate) {
            intervalRef.current = setInterval(() => {
                setCurrentFrame((prev) => {
                    const next = prev + 1;
                    return next >= maxFrame ? clampedStart : next;
                });
            }, 1000 / fps);
        }

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [shouldAnimate, fps, clampedStart, maxFrame]);

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
                backgroundSize: `${getTotalFrames(sprite, width) * displayWidth}px ${displayHeight}px`,
                backgroundRepeat: 'no-repeat',
            }}
        />
    );
});

export default CSSSprite;
