'use client';

import { useState, useEffect } from 'react';

const KEYBOARD_MIN_DELTA_PX = 150;
const KEYBOARD_MIN_OFFSET_PX = 50;

export interface KeyboardState {
    isKeyboardOpen: boolean;
    keyboardHeight: number;
    offsetTop: number;
    visibleHeight: number;
    keyboardGap: number;
}

/**
 * visualViewport API로 키보드 상태, 높이, pan offset을 추적한다.
 * viewport 메타에 interactive-widget=overlays-content 설정 시 layout viewport는
 * 리사이즈되지 않지만, iOS Safari는 input focus 시 visualViewport를 pan하고
 * position:fixed 요소를 visualViewport 기준으로 재배치한다. fixed 요소에
 * translateY(offsetTop)로 역보정하면 원위치(layout viewport 기준)로 돌려놓을 수 있다.
 * Android는 offsetTop이 항상 0에 가까워 영향 없다.
 */
export function useKeyboardOpen(): KeyboardState {
    const [state, setState] = useState<KeyboardState>({
        isKeyboardOpen: false,
        keyboardHeight: 0,
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
                const keyboardHeight = Math.max(0, window.innerHeight - viewport.height);
                const offsetTop = viewport.offsetTop;
                const visibleHeight = viewport.height;
                // iOS Safari(overlays-content)는 vv.height가 줄지 않고 offsetTop만 증가.
                // Android는 vv.height가 줄고 offsetTop은 0. 두 시그널 모두로 판정.
                const isKeyboardOpen =
                    keyboardHeight > KEYBOARD_MIN_DELTA_PX ||
                    offsetTop > KEYBOARD_MIN_OFFSET_PX;
                const keyboardGap = Math.max(0, keyboardHeight - offsetTop);
                setState((prev) => {
                    if (
                        prev.isKeyboardOpen === isKeyboardOpen &&
                        prev.keyboardHeight === keyboardHeight &&
                        prev.offsetTop === offsetTop &&
                        prev.visibleHeight === visibleHeight &&
                        prev.keyboardGap === keyboardGap
                    ) {
                        return prev;
                    }
                    return { isKeyboardOpen, keyboardHeight, offsetTop, visibleHeight, keyboardGap };
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
