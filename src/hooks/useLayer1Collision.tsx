'use client';

import { useState, useEffect } from 'react';
import { TILE_SIZE } from '@/constants/game';

interface CollisionMap {
    [key: string]: boolean; // "x,y" -> true if blocked
}

export function useLayer1Collision(layer1ImageSrc: string) {
    const [collisionMap, setCollisionMap] = useState<CollisionMap>({});
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadCollisionMap = async () => {
            setIsLoading(true);

            const img = new Image();
            img.crossOrigin = 'anonymous';

            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    setIsLoading(false);
                    return;
                }

                // Draw the image
                ctx.drawImage(img, 0, 0);

                // Get image data
                const imageData = ctx.getImageData(0, 0, img.width, img.height);
                const data = imageData.data;

                // Use game tile size for collision detection
                const tilesX = Math.floor(img.width / TILE_SIZE);
                const tilesY = Math.floor(img.height / TILE_SIZE);

                const newCollisionMap: CollisionMap = {};

                // Check each 40px tile
                for (let tileY = 0; tileY < tilesY; tileY++) {
                    for (let tileX = 0; tileX < tilesX; tileX++) {
                        // Calculate pixel bounds for this 40px tile
                        const startX = tileX * TILE_SIZE;
                        const startY = tileY * TILE_SIZE;
                        const endX = Math.min(startX + TILE_SIZE, img.width);
                        const endY = Math.min(startY + TILE_SIZE, img.height);

                        let opaquePixelCount = 0;
                        let totalPixelCount = 0;

                        // Count all pixels in this tile
                        for (let py = startY; py < endY; py++) {
                            for (let px = startX; px < endX; px++) {
                                const index = (py * img.width + px) * 4;
                                const alpha = data[index + 3];

                                totalPixelCount++;
                                // Consider pixel opaque if alpha > 50 (threshold)
                                if (alpha > 50) {
                                    opaquePixelCount++;
                                }
                            }
                        }

                        // Block if 30% or more pixels are opaque
                        if (totalPixelCount > 0) {
                            const opaqueRatio = opaquePixelCount / totalPixelCount;
                            if (opaqueRatio >= 0.3) {
                                const key = `${tileX},${tileY}`;
                                newCollisionMap[key] = true;
                            }
                        }
                    }
                }

                setCollisionMap(newCollisionMap);
                setIsLoading(false);
            };

            img.onerror = () => {
                console.error('Failed to load layer1 image for collision detection');
                setIsLoading(false);
            };

            img.src = layer1ImageSrc;
        };

        if (layer1ImageSrc) {
            loadCollisionMap();
        } else {
            setCollisionMap({});
            setIsLoading(false);
        }
    }, [layer1ImageSrc]);

    const isBlocked = (worldX: number, worldY: number): boolean => {
        // Direct lookup - both systems now use 40px tiles (0-104 grid)
        const key = `${worldX},${worldY}`;
        return collisionMap[key] === true;
    };

    return { isBlocked, isLoading, collisionMap };
}
