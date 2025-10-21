'use client';

import { useEffect, useRef } from 'react';
import { TILE_SIZE, MAP_TILES } from '@/constants/game';

type TileLayers = {
    layer0: { [key: string]: string };
    layer1: { [key: string]: string };
    layer2: { [key: string]: string };
};

interface MapCanvasProps {
    canvasRef: React.RefObject<HTMLCanvasElement>;
    canvasSize: { width: number; height: number };
    mapData: number[][];
    tileSize: number;
    worldPosition: { x: number; y: number };
    customTiles: TileLayers | { [key: string]: string };
    layerVisibility: { [key: number]: boolean };
    backgroundImage: HTMLImageElement | null;
    layer1Image: HTMLImageElement | null;
    loadedImages: { [key: string]: HTMLImageElement };
}

// Check if customTiles is using layer structure
const isLayeredTiles = (tiles: TileLayers | { [key: string]: string }): tiles is TileLayers => {
    return tiles && typeof tiles === 'object' && ('layer0' in tiles || 'layer1' in tiles || 'layer2' in tiles);
};

export default function MapCanvas({
    canvasRef,
    canvasSize,
    mapData,
    tileSize,
    worldPosition,
    customTiles,
    layerVisibility,
    backgroundImage,
    layer1Image,
    loadedImages
}: MapCanvasProps) {
    const animationFrameRef = useRef<number | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const render = () => {
            // Draw background color
            ctx.fillStyle = '#f0f8ff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Calculate visible tiles based on canvas size
            const tilesX = Math.ceil(canvasSize.width / tileSize);
            const tilesY = Math.ceil(canvasSize.height / tileSize);
            const halfTilesX = Math.floor(tilesX / 2);
            const halfTilesY = Math.floor(tilesY / 2);

            // Map boundaries (4200x4200 pixels at 40px per tile = 105 tiles)
            const ORIGINAL_TILE_SIZE = TILE_SIZE;

            // Calculate camera position in world coordinates (tiles)
            let cameraTileX = worldPosition.x - halfTilesX;
            let cameraTileY = worldPosition.y - halfTilesY;

            // Clamp camera to map boundaries
            cameraTileX = Math.max(0, Math.min(MAP_TILES - tilesX, cameraTileX));
            cameraTileY = Math.max(0, Math.min(MAP_TILES - tilesY, cameraTileY));

            // Convert camera tile position to pixel position in the original image
            const sourceX = cameraTileX * ORIGINAL_TILE_SIZE;
            const sourceY = cameraTileY * ORIGINAL_TILE_SIZE;

            // Draw layer 0 background image if available
            if (backgroundImage) {
                const sourceWidth = tilesX * ORIGINAL_TILE_SIZE;
                const sourceHeight = tilesY * ORIGINAL_TILE_SIZE;

                ctx.drawImage(
                    backgroundImage,
                    sourceX,
                    sourceY,
                    sourceWidth,
                    sourceHeight,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );
            }

            // Draw layer 1 image overlay if available and visible
            if (layer1Image && layerVisibility[1]) {
                const sourceWidth = tilesX * ORIGINAL_TILE_SIZE;
                const sourceHeight = tilesY * ORIGINAL_TILE_SIZE;

                ctx.drawImage(
                    layer1Image,
                    sourceX,
                    sourceY,
                    sourceWidth,
                    sourceHeight,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );
            }

            // Draw base tiles if no background image
            if (!backgroundImage) {
                for (let y = 0; y < tilesY; y++) {
                    for (let x = 0; x < tilesX; x++) {
                        const worldTileX = Math.floor(cameraTileX + x);
                        const worldTileY = Math.floor(cameraTileY + y);

                        // Get tile type from mapData if within bounds
                        let tileType = 0;
                        if (mapData[worldTileY] && mapData[worldTileY][worldTileX] !== undefined) {
                            tileType = mapData[worldTileY][worldTileX];
                        } else {
                            tileType = 0; // Default to grass
                        }

                        // Render void tiles as light background
                        if (tileType === -1) {
                            ctx.fillStyle = '#f0f8ff';
                            ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
                            continue;
                        }

                        // Set tile color based on type
                        switch (tileType) {
                            case 0:
                                ctx.fillStyle = '#90EE90'; // Light green for grass
                                break;
                            case 1:
                                ctx.fillStyle = '#8B4513'; // Brown for dirt
                                break;
                            case 2:
                                ctx.fillStyle = '#4169E1'; // Blue for water
                                break;
                            case 3:
                                ctx.fillStyle = '#696969'; // Gray for stone
                                break;
                            default:
                                ctx.fillStyle = '#FFFFFF'; // White for unknown
                        }

                        ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
                    }
                }
            }

            // Draw custom tile layers
            if (isLayeredTiles(customTiles)) {
                [0, 1, 2].forEach((layerIndex) => {
                    if (!layerVisibility[layerIndex]) return;

                    const layerKey = `layer${layerIndex}` as keyof TileLayers;
                    const layer = customTiles[layerKey];

                    if (layer) {
                        for (let y = 0; y < tilesY; y++) {
                            for (let x = 0; x < tilesX; x++) {
                                const worldTileX = Math.floor(cameraTileX + x);
                                const worldTileY = Math.floor(cameraTileY + y);
                                const tileKey = `${worldTileX},${worldTileY}`;
                                const customTileImage = layer[tileKey];

                                if (customTileImage && loadedImages[customTileImage]) {
                                    const img = loadedImages[customTileImage];
                                    ctx.drawImage(img, x * tileSize, y * tileSize, tileSize, tileSize);
                                }
                            }
                        }
                    }
                });
            } else {
                // Legacy single layer rendering
                for (let y = 0; y < tilesY; y++) {
                    for (let x = 0; x < tilesX; x++) {
                        const worldTileX = Math.floor(cameraTileX + x);
                        const worldTileY = Math.floor(cameraTileY + y);
                        const tileKey = `${worldTileX},${worldTileY}`;
                        const customTileImage = customTiles[tileKey];

                        if (customTileImage && loadedImages[customTileImage]) {
                            const img = loadedImages[customTileImage];
                            ctx.drawImage(img, x * tileSize, y * tileSize, tileSize, tileSize);
                        }
                    }
                }
            }
        };

        render();

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [
        canvasRef,
        canvasSize,
        mapData,
        tileSize,
        worldPosition,
        customTiles,
        layerVisibility,
        backgroundImage,
        layer1Image,
        loadedImages
    ]);

    return null;
}
