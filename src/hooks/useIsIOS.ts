'use client';

import { useState, useEffect } from 'react';

/**
 * iOS(iPhone/iPad/iPod) 여부 감지 훅.
 * iPadOS 13+는 UA가 Mac처럼 나오므로 touch 지원 여부를 보조 기준으로 사용.
 * SSR 안전을 위해 초기값 false, 마운트 후 실제 값으로 업데이트.
 */
export function useIsIOS(): boolean {
    const [isIOS, setIsIOS] = useState(false);

    useEffect(() => {
        const ua = navigator.userAgent;
        const detected =
            /iPad|iPhone|iPod/.test(ua) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        setIsIOS(detected);
    }, []);

    return isIOS;
}
