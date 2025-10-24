'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import { DIRECTION } from '@/constants/game';

interface PlayerJoystickProps {
    onMove: (direction: DIRECTION) => void;
    disabled?: boolean;
    size?: number;
    baseColor?: string;
    stickColor?: string;
}

export default function PlayerJoystick({ onMove, disabled = false, size = 100 }: PlayerJoystickProps) {
    const lastDirectionRef = useRef<DIRECTION | null>(null);
    const moveIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const imageRef = useRef<HTMLDivElement>(null);
    const [activeDirection, setActiveDirection] = useState<DIRECTION | null>(null);

    const getDirectionFromClick = (event: React.MouseEvent | React.TouchEvent) => {
        if (!imageRef.current) return null;

        const rect = imageRef.current.getBoundingClientRect();
        let clientX: number, clientY: number;

        if ('touches' in event) {
            // Touch event
            if (event.touches.length === 0) return null;
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        } else {
            // Mouse event
            clientX = event.clientX;
            clientY = event.clientY;
        }

        // Calculate position relative to image center
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const offsetX = clientX - centerX;
        const offsetY = clientY - centerY;

        // Determine direction based on which quadrant was clicked
        // Use absolute values to determine if horizontal or vertical movement is stronger
        if (Math.abs(offsetX) > Math.abs(offsetY)) {
            // Horizontal movement is stronger
            return offsetX > 0 ? DIRECTION.RIGHT : DIRECTION.LEFT;
        } else {
            // Vertical movement is stronger
            return offsetY > 0 ? DIRECTION.DOWN : DIRECTION.UP;
        }
    };

    const startMoving = (direction: DIRECTION) => {
        if (disabled) return;

        setActiveDirection(direction);

        if (lastDirectionRef.current !== direction) {
            lastDirectionRef.current = direction;

            if (moveIntervalRef.current) {
                clearInterval(moveIntervalRef.current);
                moveIntervalRef.current = null;
            }

            onMove(direction);

            moveIntervalRef.current = setInterval(() => {
                if (lastDirectionRef.current) {
                    onMove(lastDirectionRef.current);
                }
            }, 200);
        }
    };

    const handleMouseDown = (event: React.MouseEvent) => {
        event.preventDefault();
        const direction = getDirectionFromClick(event);
        if (direction) {
            startMoving(direction);
        }
    };

    const handleTouchStart = (event: React.TouchEvent) => {
        event.preventDefault();
        const direction = getDirectionFromClick(event);
        if (direction) {
            startMoving(direction);
        }
    };

    const handleStop = () => {
        if (moveIntervalRef.current) {
            clearInterval(moveIntervalRef.current);
            moveIntervalRef.current = null;
        }
        lastDirectionRef.current = null;
        setActiveDirection(null);
    };

    const getGradientStyle = () => {
        if (!activeDirection) return {};

        const gradients = {
            [DIRECTION.UP]: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(255,255,255, 0.6) 0%, transparent 30%)',
            [DIRECTION.DOWN]:
                'radial-gradient(ellipse 80% 50% at 50% 100%, rgba(255,255,255, 0.6) 0%, transparent 30%)',
            [DIRECTION.LEFT]: 'radial-gradient(ellipse 50% 80% at 0% 50%, rgba(255,255,255, 0.6) 0%, transparent 30%)',
            [DIRECTION.RIGHT]:
                'radial-gradient(ellipse 50% 80% at 100% 50%, rgba(255,255,255, 0.6) 0%, transparent 30%)'
        };

        return {
            background: gradients[activeDirection as keyof typeof gradients]
        };
    };

    return (
        <div className="mb-20 flex items-center justify-center opacity-80">
            <div
                ref={imageRef}
                onMouseDown={handleMouseDown}
                onMouseUp={handleStop}
                onMouseLeave={handleStop}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleStop}
                className="relative cursor-pointer touch-none select-none"
                style={{ width: size, height: size }}
            >
                <Image src="/map/joystick.png" alt="joystick" width={size} height={size} draggable={false} />
                {activeDirection && (
                    <div
                        className="pointer-events-none absolute inset-0 rounded-full transition-opacity duration-150"
                        style={getGradientStyle()}
                    />
                )}
            </div>
        </div>
    );
}
