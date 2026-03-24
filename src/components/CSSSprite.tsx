'use client';

import { memo, useEffect, useRef, useState } from 'react';

const FRAMES_PER_DIRECTION = 3;
const DEFAULT_TOTAL_FRAMES = 12;

/** Global image cache — each sprite URL is loaded only once. */
const imageCache = new Map<string, HTMLImageElement>();
const loadListeners = new Map<string, Set<() => void>>();

function preloadImage(src: string, onLoad?: () => void): () => void {
    if (!imageCache.has(src)) {
        const img = new Image();
        loadListeners.set(src, new Set());
        img.onload = () => {
            loadListeners.get(src)?.forEach((cb) => cb());
            loadListeners.delete(src);
        };
        img.src = src;
        imageCache.set(src, img);
    }

    // Already loaded (naturalWidth > 0) — call immediately
    const img = imageCache.get(src)!;
    if (img.naturalWidth > 0) {
        onLoad?.();
        return () => {};
    }

    // Still loading — register listener
    if (onLoad) {
        loadListeners.get(src)?.add(onLoad);
        return () => { loadListeners.get(src)?.delete(onLoad); };
    }
    return () => {};
}

function getTotalFrames(src: string, frameWidth: number): number {
    const img = imageCache.get(src);
    if (img && img.naturalWidth > 0) {
        return Math.max(1, Math.round(img.naturalWidth / frameWidth));
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
    const [imageLoaded, setImageLoaded] = useState(() => {
        const img = imageCache.get(sprite);
        return !!(img && img.naturalWidth > 0);
    });

    const totalFrames = getTotalFrames(sprite, width);
    const clampedStart = Math.min(startFrame, Math.max(totalFrames - 1, 0));
    const maxFrame = Math.min(clampedStart + FRAMES_PER_DIRECTION, totalFrames);

    const [currentFrame, setCurrentFrame] = useState(clampedStart);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        const cleanup = preloadImage(sprite, () => setImageLoaded(true));
        return cleanup;
    }, [sprite]);

    useEffect(() => {
        setCurrentFrame(clampedStart);
    }, [clampedStart]);

    useEffect(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        if (shouldAnimate && maxFrame > clampedStart + 1) {
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
                backgroundSize: `${totalFrames * displayWidth}px ${displayHeight}px`,
                backgroundRepeat: 'no-repeat',
            }}
        />
    );
});

export default CSSSprite;
