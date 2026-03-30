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
    const imageRef = useRef<HTMLDivElement>(null);
    const [activeDirection, setActiveDirection] = useState<DIRECTION | null>(null);

    const getDirection = (clientX: number, clientY: number): DIRECTION | null => {
        if (!imageRef.current) return null;

        const rect = imageRef.current.getBoundingClientRect();
        const offsetX = clientX - (rect.left + rect.width / 2);
        const offsetY = clientY - (rect.top + rect.height / 2);

        if (Math.abs(offsetX) > Math.abs(offsetY)) {
            return offsetX > 0 ? DIRECTION.RIGHT : DIRECTION.LEFT;
        } else {
            return offsetY > 0 ? DIRECTION.DOWN : DIRECTION.UP;
        }
    };

    const tapCountRef = useRef(0);

    const handleTap = (clientX: number, clientY: number) => {
        if (disabled) return;
        const direction = getDirection(clientX, clientY);
        if (!direction) return;

        tapCountRef.current++;
        if (process.env.NEXT_PUBLIC_ENABLE_PERF_MARKS === 'true') {
            console.log(`🕹 joystick tap #${tapCountRef.current}: ${direction}`);
        }

        setActiveDirection(direction);
        onMove(direction);
        setTimeout(() => setActiveDirection(null), 150);
    };

    const handleMouseDown = (event: React.MouseEvent) => {
        event.preventDefault();
        handleTap(event.clientX, event.clientY);
    };

    const handleTouchStart = (event: React.TouchEvent) => {
        event.preventDefault();
        if (event.touches.length === 0) return;
        handleTap(event.touches[0].clientX, event.touches[0].clientY);
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
                onTouchStart={handleTouchStart}
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
