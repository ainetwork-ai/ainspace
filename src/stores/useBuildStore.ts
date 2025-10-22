import { create } from 'zustand';
import { TILE_SIZE } from '@/constants/game';

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
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';

            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Failed to get canvas context'));
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

                const newCollisionMap: { [key: string]: boolean } = {};

                // Check each tile
                for (let tileY = 0; tileY < tilesY; tileY++) {
                    for (let tileX = 0; tileX < tilesX; tileX++) {
                        // Calculate pixel bounds for this tile
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

                        // Block if 50% or more pixels are opaque
                        if (totalPixelCount > 0) {
                            const opaqueRatio = opaquePixelCount / totalPixelCount;
                            if (opaqueRatio >= 0.5) {
                                const key = `${tileX},${tileY}`;
                                newCollisionMap[key] = true;
                            }
                        }
                    }
                }

                set({ collisionMap: newCollisionMap });
                console.log(`Collision map updated: ${Object.keys(newCollisionMap).length} blocked tiles`);
                resolve();
            };

            img.onerror = () => {
                reject(new Error('Failed to load image for collision detection'));
            };

            img.src = imageSrc;
        });
    },

    isBlocked: (worldX: number, worldY: number) => {
        const state = get();

        // Check map boundaries first (MAP_TILES = 105)
        // Valid coordinates are 0 to 104 inclusive
        const MAP_TILES = 105;
        if (worldX < 0 || worldX >= MAP_TILES || worldY < 0 || worldY >= MAP_TILES) {
            return true; // Out of bounds tiles are blocked
        }

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
