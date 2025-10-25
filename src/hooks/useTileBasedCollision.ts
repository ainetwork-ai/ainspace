'use client';

import { useState, useEffect } from 'react';
import { TILE_SIZE } from '@/constants/game';

interface CollisionMap {
    [key: string]: boolean; // "x,y" -> true if blocked
}

const TILE_CONFIG = {
  tileSize: 840, // Each tile is 840x840 pixels
  tilesPerSide: 5, // 5x5 grid of tiles
  gameTilesPerImageTile: 21 // Each tile contains 21x21 game tiles (40px each)
};

/**
 * Hook for tile-based collision detection
 * Loads tiles as needed and extracts collision information
 */
export function useTileBasedCollision(layerName: 'land_layer_0' | 'land_layer_1') {
    const [collisionMap, setCollisionMap] = useState<CollisionMap>({});
    const [isLoading, setIsLoading] = useState(true);
    const [loadedTileCollisions, setLoadedTileCollisions] = useState<Set<string>>(new Set());

    useEffect(() => {
        const loadAllTileCollisions = async () => {
            setIsLoading(true);
            const newCollisionMap: CollisionMap = {};

            // Load all tiles (5x5 grid)
            for (let row = 0; row < TILE_CONFIG.tilesPerSide; row++) {
                for (let col = 0; col < TILE_CONFIG.tilesPerSide; col++) {
                    const tileKey = `${row}_${col}`;

                    try {
                        const img = await loadImage(`/map/tiles/${layerName}/tile_${row}_${col}.webp`);

                        // Process this tile image for collisions
                        const canvas = document.createElement('canvas');
                        canvas.width = TILE_CONFIG.tileSize;
                        canvas.height = TILE_CONFIG.tileSize;

                        const ctx = canvas.getContext('2d');
                        if (!ctx) continue;

                        ctx.drawImage(img, 0, 0);
                        const imageData = ctx.getImageData(0, 0, TILE_CONFIG.tileSize, TILE_CONFIG.tileSize);
                        const data = imageData.data;

                        // Each image tile contains 21x21 game tiles
                        const gameTilePixelSize = TILE_CONFIG.tileSize / TILE_CONFIG.gameTilesPerImageTile;

                        for (let localY = 0; localY < TILE_CONFIG.gameTilesPerImageTile; localY++) {
                            for (let localX = 0; localX < TILE_CONFIG.gameTilesPerImageTile; localX++) {
                                // Calculate world coordinates
                                const worldX = col * TILE_CONFIG.gameTilesPerImageTile + localX;
                                const worldY = row * TILE_CONFIG.gameTilesPerImageTile + localY;

                                // Calculate pixel bounds
                                const startX = Math.floor(localX * gameTilePixelSize);
                                const startY = Math.floor(localY * gameTilePixelSize);
                                const endX = Math.floor((localX + 1) * gameTilePixelSize);
                                const endY = Math.floor((localY + 1) * gameTilePixelSize);

                                let opaquePixelCount = 0;
                                let totalPixelCount = 0;

                                // Count opaque pixels in this game tile
                                for (let py = startY; py < endY; py++) {
                                    for (let px = startX; px < endX; px++) {
                                        const index = (py * TILE_CONFIG.tileSize + px) * 4;
                                        const alpha = data[index + 3];

                                        totalPixelCount++;
                                        if (alpha > 50) {
                                            opaquePixelCount++;
                                        }
                                    }
                                }

                                // Block if 30% or more pixels are opaque
                                if (totalPixelCount > 0) {
                                    const opaqueRatio = opaquePixelCount / totalPixelCount;
                                    if (opaqueRatio >= 0.3) {
                                        const key = `${worldX},${worldY}`;
                                        newCollisionMap[key] = true;
                                    }
                                }
                            }
                        }

                        setLoadedTileCollisions(prev => new Set(prev).add(tileKey));
                    } catch (error) {
                        console.error(`Failed to load tile for collision: ${layerName}/tile_${row}_${col}.webp`, error);
                    }
                }
            }

            setCollisionMap(newCollisionMap);
            setIsLoading(false);
        };

        loadAllTileCollisions();
    }, [layerName]);

    const isBlocked = (worldX: number, worldY: number): boolean => {
        const key = `${worldX},${worldY}`;
        return collisionMap[key] === true;
    };

    return { isBlocked, isLoading, collisionMap };
}

// Helper function to load an image
function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}
