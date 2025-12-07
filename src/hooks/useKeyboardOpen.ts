'use client';

import { useState, useEffect } from 'react';

/**
 * 모바일에서 키보드가 열려있는지 감지하는 hook
 * visualViewport API를 사용하여 키보드 상태를 감지합니다.
 */
export function useKeyboardOpen(): { isKeyboardOpen: boolean } {
    const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

    useEffect(() => {
        // visualViewport API가 지원되는 경우
        if (typeof window !== 'undefined' && window.visualViewport) {
            const handleResize = () => {
                const viewport = window.visualViewport;
                if (!viewport) return;

                const threshold = 500;
                const isOpen = viewport.height < threshold;
                setIsKeyboardOpen(isOpen);
            };

            window.visualViewport.addEventListener('resize', handleResize);
            window.visualViewport.addEventListener('scroll', handleResize);

            // 초기 상태 확인
            handleResize();

            return () => {
                window.visualViewport?.removeEventListener('resize', handleResize);
                window.visualViewport?.removeEventListener('scroll', handleResize);
            };
        } else {
            const initialHeight = window.innerHeight;

            const handleResize = () => {
                const currentHeight = window.innerHeight;
                const threshold = 150;
                const isOpen = currentHeight < initialHeight - threshold;
                setIsKeyboardOpen(isOpen);
            };

            window.addEventListener('resize', handleResize);
            handleResize();

            return () => {
                window.removeEventListener('resize', handleResize);
            };
        }
    }, []);

    return { isKeyboardOpen };
}

