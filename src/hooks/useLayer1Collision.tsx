'use client';

import { useState, useEffect } from 'react';

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

        // Tile size in the background image (40px)
        const TILE_SIZE = 40;
        const tilesX = Math.floor(img.width / TILE_SIZE);
        const tilesY = Math.floor(img.height / TILE_SIZE);

        const newCollisionMap: CollisionMap = {};

        // Check each tile
        for (let tileY = 0; tileY < tilesY; tileY++) {
          for (let tileX = 0; tileX < tilesX; tileX++) {
            let hasOpaquePixel = false;

            // Sample multiple points in the tile to check for opacity
            const samplePoints = 5; // Sample 5x5 grid within each tile
            const sampleSize = Math.floor(TILE_SIZE / samplePoints);

            for (let sy = 0; sy < samplePoints && !hasOpaquePixel; sy++) {
              for (let sx = 0; sx < samplePoints && !hasOpaquePixel; sx++) {
                const pixelX = tileX * TILE_SIZE + sx * sampleSize + Math.floor(sampleSize / 2);
                const pixelY = tileY * TILE_SIZE + sy * sampleSize + Math.floor(sampleSize / 2);

                if (pixelX < img.width && pixelY < img.height) {
                  const index = (pixelY * img.width + pixelX) * 4;
                  const alpha = data[index + 3];

                  // If alpha is greater than a threshold, consider it opaque
                  if (alpha > 50) { // Threshold: 50/255
                    hasOpaquePixel = true;
                  }
                }
              }
            }

            // If tile has opaque pixels, mark as blocked
            if (hasOpaquePixel) {
              const key = `${tileX},${tileY}`;
              newCollisionMap[key] = true;
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
    const key = `${worldX},${worldY}`;
    return collisionMap[key] === true;
  };

  return { isBlocked, isLoading, collisionMap };
}
