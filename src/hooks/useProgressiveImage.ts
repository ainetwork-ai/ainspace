import { useState, useEffect } from 'react';

/**
 * Dynamically add a preload link to the document head
 * This tells the browser to fetch the image with high priority
 */
function preloadImage(src: string) {
    if (typeof window === 'undefined') return;

    // Check if preload link already exists
    const existingLink = document.querySelector(`link[rel="preload"][href="${src}"]`);
    if (existingLink) return;

    // Create and append preload link
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = src;
    document.head.appendChild(link);
}

/**
 * Progressive Image Loading Hook with Preload Optimization
 *
 * Implements a two-stage image loading strategy with preloading:
 * 1. Preloads preview image with high priority
 * 2. Loads low-quality preview image for instant display
 * 3. Preloads and loads high-quality version in background
 * 4. Seamlessly transitions from preview to high-quality when ready
 *
 * @param previewSrc - Low-quality preview image URL (loaded first with preload)
 * @param highQualitySrc - High-quality image URL (loaded in background with preload)
 * @returns Object containing the current image, loading state, and whether high-quality is loaded
 *
 * @example
 * const { image, isLoading, isHighQualityLoaded } = useProgressiveImage(
 *   '/map/land_layer_0_preview.jpg',
 *   '/map/land_layer_0.png'
 * );
 */
export function useProgressiveImage(previewSrc?: string, highQualitySrc?: string) {
    const [previewImage, setPreviewImage] = useState<HTMLImageElement | null>(null);
    const [highQualityImage, setHighQualityImage] = useState<HTMLImageElement | null>(null);
    const [isPreviewLoaded, setIsPreviewLoaded] = useState(false);
    const [isHighQualityLoaded, setIsHighQualityLoaded] = useState(false);

    // Preload both images immediately when component mounts
    useEffect(() => {
        if (previewSrc) {
            preloadImage(previewSrc);
        }
        if (highQualitySrc) {
            preloadImage(highQualitySrc);
        }
    }, [previewSrc, highQualitySrc]);

    // Load preview image first (fast)
    useEffect(() => {
        if (!previewSrc) {
            setPreviewImage(null);
            setIsPreviewLoaded(false);
            return;
        }

        const img = new Image();
        img.onload = () => {
            setPreviewImage(img);
            setIsPreviewLoaded(true);
        };
        img.onerror = () => {
            console.warn(`Failed to load preview image: ${previewSrc}`);
            setIsPreviewLoaded(false);
        };

        // Start loading immediately
        img.src = previewSrc;

        return () => {
            img.onload = null;
            img.onerror = null;
        };
    }, [previewSrc]);

    // Load high-quality image in background (slower, but starts immediately due to preload)
    useEffect(() => {
        if (!highQualitySrc) {
            setHighQualityImage(null);
            setIsHighQualityLoaded(false);
            return;
        }

        const img = new Image();
        img.onload = () => {
            setHighQualityImage(img);
            setIsHighQualityLoaded(true);
            console.log(`High-quality image loaded: ${highQualitySrc}`);
        };
        img.onerror = () => {
            console.warn(`Failed to load high-quality image: ${highQualitySrc}`);
            setIsHighQualityLoaded(false);
        };

        // Start loading immediately (browser already started fetching via preload)
        img.src = highQualitySrc;

        return () => {
            img.onload = null;
            img.onerror = null;
        };
    }, [highQualitySrc]);

    // Return high-quality image if loaded, otherwise return preview
    const currentImage = isHighQualityLoaded ? highQualityImage : previewImage;

    // Still loading if we don't have either image yet
    const isLoading = !isPreviewLoaded && !isHighQualityLoaded;

    return {
        image: currentImage,
        previewImage,
        highQualityImage,
        isLoading,
        isPreviewLoaded,
        isHighQualityLoaded
    };
}
