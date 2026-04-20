'use client';

import { useState, useEffect } from 'react';

const KEYBOARD_MIN_DELTA_PX = 150;

/**
 * visualViewport API로 키보드 상태를 감지한다.
 * viewport 메타에 interactive-widget=resizes-visual 이 필요하다 (iOS/Android 공통).
 */
export function useKeyboardOpen(): { isKeyboardOpen: boolean } {
    const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.visualViewport) return;

        const viewport = window.visualViewport;

        const handleResize = () => {
            const diff = window.innerHeight - viewport.height;
            setIsKeyboardOpen(diff > KEYBOARD_MIN_DELTA_PX);
        };

        viewport.addEventListener('resize', handleResize);
        handleResize();

        return () => {
            viewport.removeEventListener('resize', handleResize);
        };
    }, []);

    return { isKeyboardOpen };
}
