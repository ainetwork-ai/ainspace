'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { SpriteAnimator } from 'react-sprite-animator';

const FRAMES_PER_DIRECTION = 3;

/**
 * Wrapper around SpriteAnimator that controls frames externally via `frame` prop.
 * This avoids remounting on direction change (no key needed), preventing
 * unnecessary image re-fetches while keeping animation within the correct
 * 3-frame range per direction.
 */
const SpriteAnimatorWrapper = memo(function SpriteAnimatorWrapper(props: {
    sprite: string;
    width: number;
    height: number;
    scale?: number;
    fps: number;
    direction: 'horizontal' | 'vertical';
    shouldAnimate: boolean;
    startFrame: number;
}) {
    const { startFrame, shouldAnimate, fps, ...rest } = props;
    const [currentFrame, setCurrentFrame] = useState(startFrame);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    return (
        <SpriteAnimator
            {...rest}
            sprite={props.sprite}
            fps={fps}
            direction={props.direction}
            shouldAnimate={false}
            startFrame={startFrame}
            frame={currentFrame}
        />
    );
});

export default SpriteAnimatorWrapper;
