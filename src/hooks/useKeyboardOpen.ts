'use client';

import { useState, useEffect } from 'react';

/**
 * 모바일에서 키보드가 열려있는지 감지하는 hook
 * visualViewport API를 사용하여 키보드 상태를 감지합니다.
 */
export function useKeyboardOpen(): { isKeyboardOpen: boolean; remountKey: number } {
    const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
    const [remountKey, setRemountKey] = useState(0);

    useEffect(() => {
        console.log('useKeyboardOpen', window, window?.visualViewport);
        // visualViewport API가 지원되는 경우
        if (typeof window !== 'undefined' && window.visualViewport) {
            console.log('visualViewport API is supported');
            const handleResize = () => {
                const viewport = window.visualViewport;
                if (!viewport) return;

                // visualViewport 높이가 window.innerHeight보다 작으면 키보드가 열린 것으로 간주
                // 임계값은 보통 150px 정도 (키보드가 최소한 이 정도는 화면을 가림)
                const threshold = 500;
                console.error(viewport.height, window.innerHeight - threshold);
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
            // visualViewport가 지원되지 않는 경우 fallback
            // window.innerHeight 변화로 감지 (덜 정확함)
            console.log('visualViewport API is not supported');
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

    // isKeyboardOpen이 변경될 때마다 감지
    useEffect(() => {
        if (!isKeyboardOpen) {
            // 키보드가 닫힐 때마다 remountKey 갱신 (drawer 재마운트)
            setRemountKey(Date.now());
        }
    }, [isKeyboardOpen]);

    return { isKeyboardOpen, remountKey };
}

