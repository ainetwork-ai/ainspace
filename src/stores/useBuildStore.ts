import { create } from 'zustand';
import { TILE_SIZE } from '@/constants/game';

// Helper function to load an image
function loadImagePromise(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

// Data structure for multi-tile items
export interface ItemTileData {
    image: string;
    width: number;  // in tiles
    height: number; // in tiles
    topLeftX: number; // original placement X coordinate
    topLeftY: number; // original placement Y coordinate
    isSecondaryTile?: boolean; // true for tiles that are not the top-left anchor
}

export type TileLayers = {
    layer0: { [key: string]: string };
    layer1: { [key: string]: string | ItemTileData };
    layer2: { [key: string]: string };
};

interface PublishStatus {
    type: 'success' | 'error';
    message: string;
}

interface BuildState {
    customTiles: TileLayers;
    publishedTiles: TileLayers;
    selectedImage: string | null;
    buildMode: 'select' | 'paint';
    isPublishing: boolean;
    publishStatus: PublishStatus | null;
    showCollisionMap: boolean;
    collisionMap: { [key: string]: boolean };

    // Actions
    setCustomTiles: (tiles: TileLayers | ((prev: TileLayers) => TileLayers)) => void;
    setPublishedTiles: (tiles: TileLayers | ((prev: TileLayers) => TileLayers)) => void;
    setSelectedImage: (image: string | null) => void;
    setBuildMode: (mode: 'select' | 'paint') => void;
    setIsPublishing: (isPublishing: boolean) => void;
    setPublishStatus: (status: PublishStatus | null) => void;
    setShowCollisionMap: (show: boolean) => void;
    toggleCollisionMap: () => void;
    setCollisionMap: (map: { [key: string]: boolean }) => void;
    updateCollisionMapFromImage: (imageSrc: string) => Promise<void>;
    isBlocked: (worldX: number, worldY: number) => boolean;
    clearPublishStatusAfterDelay: (delay: number) => void;
    resetBuildState: () => void;
    updateTileOnLayer: (layer: 0 | 1 | 2, key: string, value: string) => void;
    removeTileFromLayer: (layer: 0 | 1 | 2, key: string) => void;
}

export const useBuildStore = create<BuildState>((set, get) => ({
    customTiles: {
        layer0: {},
        layer1: {},
        layer2: {}
    },
    publishedTiles: {
        layer0: {},
        layer1: {},
        layer2: {}
    },
    selectedImage: null,
    buildMode: 'select',
    isPublishing: false,
    publishStatus: null,
    showCollisionMap: false,
    collisionMap: {},

    setCustomTiles: (tiles) =>
        set((state) => ({
            customTiles: typeof tiles === 'function' ? tiles(state.customTiles) : tiles
        })),

    setPublishedTiles: (tiles) =>
        set((state) => ({
            publishedTiles: typeof tiles === 'function' ? tiles(state.publishedTiles) : tiles
        })),

    setSelectedImage: (image) => set({ selectedImage: image }),
    setBuildMode: (mode) => set({ buildMode: mode }),
    setIsPublishing: (isPublishing) => set({ isPublishing }),
    setPublishStatus: (status) => set({ publishStatus: status }),
    setShowCollisionMap: (show) => set({ showCollisionMap: show }),
    toggleCollisionMap: () => set((state) => ({ showCollisionMap: !state.showCollisionMap })),
    setCollisionMap: (map) => set({ collisionMap: map }),

    updateCollisionMapFromImage: async (imageSrc: string) => {
        // Extract layer name from imageSrc (e.g., '/map/land_layer_1.webp' -> 'land_layer_1')
        const layerName = imageSrc.includes('land_layer_1') ? 'land_layer_1' : 'land_layer_0';

        const TILE_CONFIG = {
            tileSize: 840,
            tilesPerSide: 5,
            gameTilesPerImageTile: 21
        };

        const newCollisionMap: { [key: string]: boolean } = {};

        // Load all tiles (5x5 grid)
        for (let row = 0; row < TILE_CONFIG.tilesPerSide; row++) {
            for (let col = 0; col < TILE_CONFIG.tilesPerSide; col++) {
                try {
                    const img = await loadImagePromise(`/map/tiles/${layerName}/tile_${row}_${col}.webp`);

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

                            // Block if 50% or more pixels are opaque
                            if (totalPixelCount > 0) {
                                const opaqueRatio = opaquePixelCount / totalPixelCount;
                                if (opaqueRatio >= 0.5) {
                                    const key = `${worldX},${worldY}`;
                                    newCollisionMap[key] = true;
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error(`Failed to load tile for collision: ${layerName}/tile_${row}_${col}.webp`, error);
                }
            }
        }

        set({ collisionMap: newCollisionMap });
        console.log(`Collision map updated: ${Object.keys(newCollisionMap).length} blocked tiles`);
    },

    isBlocked: (worldX: number, worldY: number) => {
        const state = get();
        // Infinite map - no boundary check
        const key = `${worldX},${worldY}`;
        return state.collisionMap[key] === true;
    },

    clearPublishStatusAfterDelay: (delay) => {
        setTimeout(() => {
            set({ publishStatus: null });
        }, delay);
    },

    resetBuildState: () =>
        set({
            customTiles: { layer0: {}, layer1: {}, layer2: {} },
            selectedImage: null,
            buildMode: 'select'
        }),

    updateTileOnLayer: (layer, key, value) =>
        set((state) => ({
            customTiles: {
                ...state.customTiles,
                [`layer${layer}`]: {
                    ...state.customTiles[`layer${layer}`],
                    [key]: value
                }
            }
        })),

    removeTileFromLayer: (layer, key) =>
        set((state) => {
            const layerKey = `layer${layer}` as keyof TileLayers;
            const newLayer = { ...state.customTiles[layerKey] };
            delete newLayer[key];
            return {
                customTiles: {
                    ...state.customTiles,
                    [layerKey]: newLayer
                }
            };
        })
}));
