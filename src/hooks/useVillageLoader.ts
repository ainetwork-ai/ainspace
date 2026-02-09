import { useEffect, useRef, useCallback } from 'react';
import { useVillageStore, LoadedVillage } from '@/stores/useVillageStore';
import { VillageMetadata } from '@/lib/village-redis';
import { loadVillageMap, loadDefaultVillageMap } from '@/lib/village-map-loader';
import { worldToGrid, gridKey, getNearbyCells } from '@/lib/village-utils';
import { useGameStateStore } from '@/stores';

/**
 * 현재 마을 + 인접 마을의 TMJ/타일셋을 로드/언로드하는 훅.
 *
 * 로딩 우선순위: 현재 마을 (await) → NSEW (background) → 대각 (background)
 * 플레이어가 마을 경계를 넘으면 현재 마을을 전환하고 인접 마을을 갱신한다.
 */
export function useVillageLoader(initialVillageSlug: string | null) {
  const { worldPosition } = useGameStateStore();
  const {
    currentVillageSlug,
    currentVillage,
    loadedVillages,
    gridIndex,
    defaultVillage,
    setCurrentVillage,
    setLoading,
    setCurrentVillageLoaded,
    addLoadedVillage,
    removeLoadedVillage,
    setNearbyVillages,
    updateGridIndex,
    getVillageSlugAtGrid,
    setDefaultVillage,
  } = useVillageStore();

  const loadingRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  // 마을 TMJ/타일셋을 로드하는 함수
  const loadVillage = useCallback(async (metadata: VillageMetadata): Promise<LoadedVillage | null> => {
    const slug = metadata.slug;

    // 이미 로드되었거나 로딩 중이면 skip
    if (loadedVillages.has(slug) || loadingRef.current.has(slug)) {
      return loadedVillages.get(slug) ?? null;
    }

    loadingRef.current.add(slug);

    try {
      const { mapData, tilesets, collisionTiles } = await loadVillageMap(
        metadata.tmjUrl,
        metadata.tilesetBaseUrl,
      );

      const loaded: LoadedVillage = {
        metadata,
        mapData,
        tilesets,
        collisionTiles,
      };

      addLoadedVillage(slug, loaded);
      return loaded;
    } catch (err) {
      console.error(`Failed to load village ${slug}:`, err);
      return null;
    } finally {
      loadingRef.current.delete(slug);
    }
  }, [loadedVillages, addLoadedVillage]);

  // 인접 마을 메타데이터를 fetch하고 로드하는 함수
  const loadNearbyVillages = useCallback(async (gridX: number, gridY: number) => {
    try {
      const res = await fetch(`/api/villages?nearby=${gridX},${gridY}`);
      const data = await res.json();

      if (!data.success || !data.villages) return;

      const villages: VillageMetadata[] = data.villages;
      setNearbyVillages(villages);
      updateGridIndex(villages);

      // 인접 마을 분류 (NSEW vs 대각)
      const nsew: VillageMetadata[] = [];
      const diagonal: VillageMetadata[] = [];

      for (const v of villages) {
        if (v.gridX === gridX && v.gridY === gridY) continue; // 현재 마을은 이미 로드됨

        const dx = Math.abs(v.gridX - gridX);
        const dy = Math.abs(v.gridY - gridY);

        if (dx + dy === 1) {
          nsew.push(v);
        } else {
          diagonal.push(v);
        }
      }

      // NSEW 먼저 병렬 로드
      await Promise.all(nsew.map(v => loadVillage(v)));
      // 대각 병렬 로드
      await Promise.all(diagonal.map(v => loadVillage(v)));

      // 더 이상 인접하지 않는 마을 언로드
      const nearbyKeys = new Set(villages.map(v => v.slug));
      for (const [slug] of loadedVillages) {
        if (!nearbyKeys.has(slug)) {
          removeLoadedVillage(slug);
        }
      }
    } catch (err) {
      console.error('Failed to load nearby villages:', err);
    }
  }, [setNearbyVillages, updateGridIndex, loadVillage, loadedVillages, removeLoadedVillage]);

  // Default village 로드
  useEffect(() => {
    if (defaultVillage) return;

    async function loadDefault() {
      try {
        const { mapData, tilesets, collisionTiles } = await loadDefaultVillageMap();

        const loaded: LoadedVillage = {
          metadata: {
            slug: '__default__',
            name: 'Default Map',
            gridX: 0,
            gridY: 0,
            gridWidth: 1,
            gridHeight: 1,
            tmjUrl: '/map/default_map.tmj',
            tilesetBaseUrl: '/map',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          mapData,
          tilesets,
          collisionTiles,
        };

        setDefaultVillage(loaded);
      } catch (err) {
        console.warn('Failed to load default village map:', err);
      }
    }

    loadDefault();
  }, [defaultVillage, setDefaultVillage]);

  // 초기 마을 로드
  useEffect(() => {
    if (!initialVillageSlug || initializedRef.current) return;
    initializedRef.current = true;

    async function init() {
      setLoading(true);

      try {
        // 초기 마을 메타데이터 fetch
        const res = await fetch(`/api/villages/${initialVillageSlug}?noCache=true`);
        const data = await res.json();

        if (!data.success || !data.village) {
          console.error(`Village "${initialVillageSlug}" not found`);
          setLoading(false);
          return;
        }

        const metadata: VillageMetadata = data.village;
        setCurrentVillage(metadata.slug, metadata);

        // 현재 마을의 gridIndex를 먼저 등록 (이동 가능하도록)
        updateGridIndex([metadata]);

        // 현재 마을 우선 로드
        await loadVillage(metadata);
        setCurrentVillageLoaded(true);

        // 인접 마을 로드 (background)
        loadNearbyVillages(metadata.gridX, metadata.gridY);
      } catch (err) {
        console.error('Failed to initialize village:', err);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [initialVillageSlug, setLoading, setCurrentVillage, setCurrentVillageLoaded, loadVillage, loadNearbyVillages, updateGridIndex]);

  // 플레이어 이동 시 마을 전환 감지
  useEffect(() => {
    if (!currentVillage) {
      console.log('[useVillageLoader] No currentVillage, skipping transition check');
      return;
    }

    const { gridX, gridY } = worldToGrid(worldPosition.x, worldPosition.y);
    const currentGrid = gridKey(currentVillage.gridX, currentVillage.gridY);
    const playerGrid = gridKey(gridX, gridY);

    console.log(`[useVillageLoader] currentGrid:${currentGrid}, playerGrid:${playerGrid}, worldPos:(${worldPosition.x},${worldPosition.y})`);

    if (currentGrid !== playerGrid) {
      // 마을 경계를 넘었음
      console.log(`[useVillageLoader] 🚀 Grid boundary crossed!`);
      const newSlug = getVillageSlugAtGrid(gridX, gridY);
      console.log(`[useVillageLoader] newSlug at grid(${gridX},${gridY}): ${newSlug}`);

      if (!newSlug) {
        // 마을이 없는 곳 (default map 영역)으로 이동
        console.log(`[useVillageLoader] ⚠️ No village at new grid -> moving to default map area`);
        // 여전히 nearby village 로딩은 실행 (주변에 마을이 있을 수 있음)
        console.log(`[useVillageLoader] Loading nearby villages for grid(${gridX},${gridY})`);
        loadNearbyVillages(gridX, gridY);
        return;
      }

      // nearbyVillages에서 메타데이터 조회
      const nearbyVillages = useVillageStore.getState().nearbyVillages;
      const newMeta = nearbyVillages.get(newSlug);
      if (!newMeta) {
        console.log(`[useVillageLoader] ⚠️ No metadata for ${newSlug} in nearbyVillages`);
        return;
      }

      console.log(`[useVillageLoader] ✅ Switching to village ${newSlug}`);
      setCurrentVillage(newSlug, newMeta);

      // URL 업데이트 (페이지 리로드 없이)
      const url = new URL(window.location.href);
      url.searchParams.set('village', newSlug);
      window.history.replaceState({}, '', url.toString());

      // 새 인접 마을 로드
      console.log(`[useVillageLoader] Loading nearby villages for grid(${gridX},${gridY})`);
      loadNearbyVillages(gridX, gridY);
    }
  }, [worldPosition, currentVillage, getVillageSlugAtGrid, setCurrentVillage, loadNearbyVillages]);

  return {
    isLoading: useVillageStore((s) => s.isLoading),
    isCurrentVillageLoaded: useVillageStore((s) => s.isCurrentVillageLoaded),
    currentVillageSlug,
  };
}
