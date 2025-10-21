declare module 'react-sprite-animator' {
  import { CSSProperties } from 'react';

  export interface SpriteAnimatorProps {
    className?: string;
    width: number;
    height: number;
    sprite: string;
    scale?: number;
    direction?: 'horizontal' | 'vertical';
    shouldAnimate?: boolean;
    loop?: boolean;
    startFrame?: number;
    fps?: number;
    stopLastFrame?: boolean;
    onError?: (error: Error) => void;
    onLoad?: () => void;
    onEnd?: () => void;
    frameCount?: number;
    wrapAfter?: number;
    frame?: number;
    reset?: boolean;
  }

  export const SpriteAnimator: React.FC<SpriteAnimatorProps>;

  export interface UseSpriteOptions {
    startFrame?: number;
    sprite: string;
    width: number;
    height: number;
    direction?: 'horizontal' | 'vertical';
    onError?: (error: Error) => void;
    onLoad?: () => void;
    onEnd?: () => void;
    frameCount?: number;
    fps?: number;
    shouldAnimate?: boolean;
    stopLastFrame?: boolean;
    reset?: boolean;
    scale?: number;
    wrapAfter?: number;
    frame?: number;
  }

  export function useSprite(options: UseSpriteOptions): CSSProperties;
  export function loadImage(url: string, callback?: (error: Error | null, image?: HTMLImageElement) => void): void;
}
