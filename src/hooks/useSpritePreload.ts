import { useEffect, useState } from 'react';

/**
 * Preload sprite images to prevent flickering when direction changes
 */
export function useSpritePreload(spriteUrls: string[]) {
    const [loaded, setLoaded] = useState(false);
    const [loadedCount, setLoadedCount] = useState(0);

    useEffect(() => {
        let isMounted = true;
        const images: HTMLImageElement[] = [];
        let count = 0;

        spriteUrls.forEach((url) => {
            const img = new Image();
            img.src = url;

            img.onload = () => {
                if (isMounted) {
                    count++;
                    setLoadedCount(count);
                    if (count === spriteUrls.length) {
                        setLoaded(true);
                    }
                }
            };

            img.onerror = () => {
                console.error(`Failed to preload sprite: ${url}`);
                if (isMounted) {
                    count++;
                    setLoadedCount(count);
                    if (count === spriteUrls.length) {
                        setLoaded(true);
                    }
                }
            };

            images.push(img);
        });

        return () => {
            isMounted = false;
            images.forEach((img) => {
                img.onload = null;
                img.onerror = null;
            });
        };
    }, [spriteUrls]);

    return { loaded, loadedCount, total: spriteUrls.length };
}
