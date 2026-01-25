import { create } from "zustand";

// DB 기반 타일 데이터 타입
export type MapTileData = {
  layer0: { [key: string]: number };  // "x,y": tileId
  layer1: { [key: string]: number };
  layer2: { [key: string]: number };
};

// 타일셋 정보 (렌더링용)
export type Tileset = {
  firstgid: number;
  image: HTMLImageElement;
  columns: number;
  tilecount: number;
  tilewidth: number;
  tileheight: number;
  imageScale?: number;
};

// API에서 받아오는 타일셋 정보
export type TilesetInfo = {
  firstgid: number;
  source?: string;
  image?: string;
  columns: number;
  tilecount: number;
  tilewidth: number;
  tileheight: number;
};

// 기존 호환성을 위한 타입 (점진적 제거 예정)
export type TiledLayer = {
  data: number[];
  name: string;
  type: string;
  visible: boolean;
  width: number;
  height: number;
};

export type TiledMap = {
  tilewidth: number;
  tileheight: number;
  width: number;
  height: number;
  layers: TiledLayer[];
  tilesets: Tileset[];
};

interface MapState {
  // DB 기반 타일 데이터
  tiles: MapTileData;
  tilesets: Tileset[];
  tilesetInfos: TilesetInfo[];
  customTileImages: { [tileId: number]: string };  // tileId -> base64 이미지

  // 충돌 타일 (layer1 기반)
  collisionTiles: Set<string>;

  // 로딩 상태
  isLoaded: boolean;
  isLoading: boolean;
  lastLoadedRange: { startX: number; startY: number; endX: number; endY: number } | null;

  // 기존 호환성 (점진적 제거 예정)
  mapData: TiledMap | null;
  mapStartPosition: { x: number; y: number };
  mapEndPosition: { x: number; y: number };

  // Actions
  setTiles: (tiles: MapTileData) => void;
  setTilesets: (tilesets: Tileset[]) => void;
  setTilesetInfos: (infos: TilesetInfo[]) => void;
  setCustomTileImages: (images: { [tileId: number]: string }) => void;
  addCustomTileImages: (images: { [tileId: number]: string }) => void;
  setCollisionTiles: (tiles: Array<{ x: number; y: number }>) => void;
  addCollisionTile: (x: number, y: number) => void;
  removeCollisionTile: (x: number, y: number) => void;
  isCollisionTile: (x: number, y: number) => boolean;

  setIsLoaded: (isLoaded: boolean) => void;
  setIsLoading: (isLoading: boolean) => void;
  setLastLoadedRange: (range: { startX: number; startY: number; endX: number; endY: number } | null) => void;

  // 타일 조회/설정
  getTile: (layer: 0 | 1 | 2, x: number, y: number) => number | undefined;
  setTile: (layer: 0 | 1 | 2, x: number, y: number, tileId: number) => void;

  // DB에서 타일 로드
  loadTilesFromDB: (startX: number, startY: number, endX: number, endY: number) => Promise<void>;

  // 기존 호환성 (점진적 제거 예정)
  setMapData: (mapData: TiledMap) => void;
  setMapStartPosition: (pos: { x: number; y: number }) => void;
  setMapEndPosition: (pos: { x: number; y: number }) => void;
}

export const useMapStore = create<MapState>((set, get) => ({
  // DB 기반 타일 데이터
  tiles: { layer0: {}, layer1: {}, layer2: {} },
  tilesets: [],
  tilesetInfos: [],
  customTileImages: {},
  collisionTiles: new Set<string>(),

  isLoaded: false,
  isLoading: false,
  lastLoadedRange: null,

  // 기존 호환성
  mapData: null,
  mapStartPosition: { x: -Infinity, y: -Infinity },
  mapEndPosition: { x: Infinity, y: Infinity },

  setTiles: (tiles) => set({ tiles }),

  setTilesets: (tilesets) => set({ tilesets }),

  setTilesetInfos: (infos) => set({ tilesetInfos: infos }),

  setCustomTileImages: (images) => set({ customTileImages: images }),

  addCustomTileImages: (images) => set((state) => ({
    customTileImages: { ...state.customTileImages, ...images }
  })),

  setCollisionTiles: (tilesArray) => {
    const tilesSet = new Set<string>();
    tilesArray.forEach(({ x, y }) => tilesSet.add(`${x},${y}`));
    set({ collisionTiles: tilesSet });
  },

  addCollisionTile: (x, y) => {
    const current = get().collisionTiles;
    const newSet = new Set(current);
    newSet.add(`${x},${y}`);
    set({ collisionTiles: newSet });
  },

  removeCollisionTile: (x, y) => {
    const current = get().collisionTiles;
    const newSet = new Set(current);
    newSet.delete(`${x},${y}`);
    set({ collisionTiles: newSet });
  },

  isCollisionTile: (x, y) => {
    return get().collisionTiles.has(`${x},${y}`);
  },

  setIsLoaded: (isLoaded) => set({ isLoaded }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setLastLoadedRange: (range) => set({ lastLoadedRange: range }),

  getTile: (layer, x, y) => {
    const key = `${x},${y}`;
    const layerKey = `layer${layer}` as keyof MapTileData;
    return get().tiles[layerKey][key];
  },

  setTile: (layer, x, y, tileId) => {
    const key = `${x},${y}`;
    const layerKey = `layer${layer}` as keyof MapTileData;
    set((state) => ({
      tiles: {
        ...state.tiles,
        [layerKey]: {
          ...state.tiles[layerKey],
          [key]: tileId
        }
      }
    }));

    // layer1은 충돌 타일로 추가
    if (layer === 1 && tileId !== 0) {
      get().addCollisionTile(x, y);
    } else if (layer === 1 && tileId === 0) {
      get().removeCollisionTile(x, y);
    }
  },

  loadTilesFromDB: async (startX, startY, endX, endY) => {
    const state = get();
    if (state.isLoading) return;

    set({ isLoading: true });

    try {
      const response = await fetch(
        `/api/map/tiles?startX=${startX}&startY=${startY}&endX=${endX}&endY=${endY}`
      );

      if (!response.ok) {
        throw new Error('Failed to load tiles');
      }

      const data = await response.json();

      if (data.success) {
        // 기존 타일과 병합
        const currentTiles = get().tiles;
        const newTiles: MapTileData = {
          layer0: { ...currentTiles.layer0, ...data.tiles.layer0 },
          layer1: { ...currentTiles.layer1, ...data.tiles.layer1 },
          layer2: { ...currentTiles.layer2, ...data.tiles.layer2 },
        };

        // 충돌 타일 업데이트 (layer1)
        const collisionSet = new Set(get().collisionTiles);
        Object.keys(data.tiles.layer1).forEach((key) => {
          if (data.tiles.layer1[key] !== 0) {
            collisionSet.add(key);
          }
        });

        // 커스텀 타일 이미지 병합
        const currentCustomImages = get().customTileImages;
        const newCustomImages = data.customTileImages || {};

        set({
          tiles: newTiles,
          collisionTiles: collisionSet,
          customTileImages: { ...currentCustomImages, ...newCustomImages },
          lastLoadedRange: { startX, startY, endX, endY },
          isLoaded: true
        });

        // 타일셋 정보가 있으면 저장
        if (data.tilesets && !get().tilesetInfos.length) {
          set({ tilesetInfos: data.tilesets });
        }
      }
    } catch (error) {
      console.error('Error loading tiles from DB:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  // 기존 호환성 (점진적 제거 예정)
  setMapData: (mapData) => set({ mapData }),
  setMapStartPosition: (pos) => set({ mapStartPosition: pos }),
  setMapEndPosition: (pos) => set({ mapEndPosition: pos }),
}));
