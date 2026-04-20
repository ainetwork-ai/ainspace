'use client';

import { useState, useEffect } from 'react';

const KEYBOARD_MIN_DELTA_PX = 150;
const KEYBOARD_MIN_OFFSET_PX = 10;

export interface KeyboardState {
    isKeyboardOpen: boolean;
    offsetTop: number;
    visibleHeight: number;
    keyboardGap: number;
}

/**
 * visualViewport API로 키보드 상태와 viewport 지표를 추적한다.
 * iOS Safari가 visualViewport를 위로 pan하는 경우 offsetTop이 > 0이 되고,
 * position:fixed 요소가 시각적으로 밀려 보인다. keyboardGap / offsetTop 값으로
 * 역보정(translate)해 Android와 동일한 오버레이 동작을 만들 수 있다.
 * viewport 메타에 interactive-widget=resizes-visual 이 필요하다.
 */
export function useKeyboardOpen(): KeyboardState {
    const [state, setState] = useState<KeyboardState>({
        isKeyboardOpen: false,
        offsetTop: 0,
        visibleHeight: 0,
        keyboardGap: 0,
    });

    useEffect(() => {
        if (typeof window === 'undefined' || !window.visualViewport) return;

        const viewport = window.visualViewport;
        let rafId = 0;

        const update = () => {
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                rafId = 0;
                const diff = window.innerHeight - viewport.height;
                // iOS Safari는 pan만 하고 vv.height는 안 줄어드는 경우가 있어
                // offsetTop도 함께 검사한다
                const isKeyboardOpen =
                    diff > KEYBOARD_MIN_DELTA_PX ||
                    viewport.offsetTop > KEYBOARD_MIN_OFFSET_PX;
                setState({
                    isKeyboardOpen,
                    offsetTop: viewport.offsetTop,
                    visibleHeight: viewport.height,
                    keyboardGap: diff - viewport.offsetTop,
                });
            });
        };

        viewport.addEventListener('resize', update);
        viewport.addEventListener('scroll', update);
        update();

        return () => {
            viewport.removeEventListener('resize', update);
            viewport.removeEventListener('scroll', update);
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, []);

    return state;
}
