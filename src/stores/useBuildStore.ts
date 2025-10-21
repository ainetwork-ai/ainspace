import { create } from 'zustand';

export type TileLayers = {
    layer0: { [key: string]: string };
    layer1: { [key: string]: string };
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

    // Actions
    setCustomTiles: (tiles: TileLayers | ((prev: TileLayers) => TileLayers)) => void;
    setPublishedTiles: (tiles: TileLayers | ((prev: TileLayers) => TileLayers)) => void;
    setSelectedImage: (image: string | null) => void;
    setBuildMode: (mode: 'select' | 'paint') => void;
    setIsPublishing: (isPublishing: boolean) => void;
    setPublishStatus: (status: PublishStatus | null) => void;
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
