import { create } from 'zustand';
import { TiledMap, Tileset } from './useMapStore';
import { VillageMetadata } from '@/lib/village-redis';
import { worldToGrid, worldToLocalInVillage, gridKey } from '@/lib/village-utils';

export interface LoadedVillage {
  metadata: VillageMetadata;
  mapData: TiledMap;
  tilesets: Tileset[];
  collisionTiles: Set<string>; // "localX,localY" 형태
}

interface VillageState {
  // 현재 마을
  currentVillageSlug: string | null;
  currentVillage: VillageMetadata | null;

  // 로드된 마을 캐시 (slug → LoadedVillage)
  loadedVillages: Map<string, LoadedVillage>;

  // 인접 마을 메타데이터 (slug → metadata)
  nearbyVillages: Map<string, VillageMetadata>;

  // 격자 위치 → slug 매핑 캐시
  gridIndex: Map<string, string>;

  // 기본 맵 (마을이 없는 grid 위치에 렌더링됨)
  defaultVillage: LoadedVillage | null;

  // 로딩 상태
  isLoading: boolean;
  isCurrentVillageLoaded: boolean;

  // Actions
  setCurrentVillage: (slug: string, metadata: VillageMetadata) => void;
  setLoading: (loading: boolean) => void;
  setCurrentVillageLoaded: (loaded: boolean) => void;

  addLoadedVillage: (slug: string, village: LoadedVillage) => void;
  removeLoadedVillage: (slug: string) => void;

  setNearbyVillages: (villages: VillageMetadata[]) => void;
  updateGridIndex: (villages: VillageMetadata[]) => void;

  // Default village
  setDefaultVillage: (village: LoadedVillage) => void;

  // 조회
  getLoadedVillageAtGrid: (gridX: number, gridY: number) => LoadedVillage | null;
  getVillageSlugAtGrid: (gridX: number, gridY: number) => string | null;
  isCollisionAt: (worldX: number, worldY: number) => boolean;
  hasVillageAt: (worldX: number, worldY: number) => boolean;
}

export const useVillageStore = create<VillageState>((set, get) => ({
  currentVillageSlug: null,
  currentVillage: null,
  loadedVillages: new Map(),
  nearbyVillages: new Map(),
  gridIndex: new Map(),
  defaultVillage: null,
  isLoading: false,
  isCurrentVillageLoaded: false,

  setCurrentVillage: (slug, metadata) =>
    set({ currentVillageSlug: slug, currentVillage: metadata }),

  setLoading: (loading) => set({ isLoading: loading }),
  setCurrentVillageLoaded: (loaded) => set({ isCurrentVillageLoaded: loaded }),

  setDefaultVillage: (village) => set({ defaultVillage: village }),

  addLoadedVillage: (slug, village) =>
    set((state) => {
      const newMap = new Map(state.loadedVillages);
      newMap.set(slug, village);
      return { loadedVillages: newMap };
    }),

  removeLoadedVillage: (slug) =>
    set((state) => {
      const newMap = new Map(state.loadedVillages);
      newMap.delete(slug);
      return { loadedVillages: newMap };
    }),

  setNearbyVillages: (villages) =>
    set(() => {
      const newMap = new Map<string, VillageMetadata>();
      for (const v of villages) {
        newMap.set(v.slug, v);
      }
      return { nearbyVillages: newMap };
    }),

  updateGridIndex: (villages) =>
    set((state) => {
      const newIndex = new Map(state.gridIndex);
      for (const v of villages) {
        // NxM 마을: 점유하는 모든 격자 셀에 slug 등록
        const gw = v.gridWidth || 1;
        const gh = v.gridHeight || 1;
        for (let dy = 0; dy < gh; dy++) {
          for (let dx = 0; dx < gw; dx++) {
            newIndex.set(gridKey(v.gridX + dx, v.gridY + dy), v.slug);
          }
        }
      }
      return { gridIndex: newIndex };
    }),

  getLoadedVillageAtGrid: (gridX, gridY) => {
    const state = get();
    const slug = state.gridIndex.get(gridKey(gridX, gridY));
    if (!slug) return null;
    return state.loadedVillages.get(slug) ?? null;
  },

  getVillageSlugAtGrid: (gridX, gridY) => {
    return get().gridIndex.get(gridKey(gridX, gridY)) ?? null;
  },

  isCollisionAt: (worldX, worldY) => {
    const state = get();
    const { gridX, gridY } = worldToGrid(worldX, worldY);
    const slug = state.gridIndex.get(gridKey(gridX, gridY));

    console.log(`[isCollisionAt] world(${worldX},${worldY}) -> grid(${gridX},${gridY}) -> slug:${slug}`);

    // 마을이 있는 경우
    if (slug) {
      const village = state.loadedVillages.get(slug);
      // 아직 로드 안 된 마을은 이동 불가
      if (!village) {
        console.log(`[isCollisionAt] Village ${slug} not loaded yet -> BLOCKED`);
        return true;
      }

      // village origin 기준으로 로컬 좌표 계산 (NxM 마을 지원)
      const { localX, localY } = worldToLocalInVillage(
        worldX, worldY,
        village.metadata.gridX, village.metadata.gridY,
      );
      const hasCollision = village.collisionTiles.has(`${localX},${localY}`);
      console.log(`[isCollisionAt] Village ${slug} local(${localX},${localY}) -> collision:${hasCollision}`);
      return hasCollision;
    }

    // 마을이 없는 곳: default village 사용 (충돌 없음)
    console.log(`[isCollisionAt] No village at grid(${gridX},${gridY}) -> default map (NOT BLOCKED)`);
    return false;
  },

  hasVillageAt: (worldX, worldY) => {
    const state = get();
    const { gridX, gridY } = worldToGrid(worldX, worldY);
    const hasVillage = state.gridIndex.has(gridKey(gridX, gridY));
    console.log(`[hasVillageAt] world(${worldX},${worldY}) -> grid(${gridX},${gridY}) -> hasVillage:${hasVillage}`);
    return hasVillage;
  },
}));
