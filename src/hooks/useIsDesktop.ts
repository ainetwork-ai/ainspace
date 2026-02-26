'use client';

import { useState, useEffect } from 'react';

const DESKTOP_BREAKPOINT = '(min-width: 1024px)';

/**
 * 데스크탑 뷰포트 감지 훅
 * 1024px 이상이면 isDesktop = true
 */
export function useIsDesktop(): { isDesktop: boolean } {
    const [isDesktop, setIsDesktop] = useState(false);

    useEffect(() => {
        const mediaQuery = window.matchMedia(DESKTOP_BREAKPOINT);

        setIsDesktop(mediaQuery.matches);

        const handleChange = (e: MediaQueryListEvent) => {
            setIsDesktop(e.matches);
        };

        mediaQuery.addEventListener('change', handleChange);

        return () => {
            mediaQuery.removeEventListener('change', handleChange);
        };
    }, []);

    return { isDesktop };
}
