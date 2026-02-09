import { useEffect, useRef, useCallback } from 'react';
import { useVillageStore, LoadedVillage } from '@/stores/useVillageStore';
import { VillageMetadata } from '@/lib/village-redis';
import { loadVillageMap, loadDefaultVillageMap } from '@/lib/village-map-loader';
import { worldToGrid, gridToWorldRange } from '@/lib/village-utils';
import { useGameStateStore } from '@/stores';

/**
 * 현재 마을 + 인접 마을의 TMJ/타일셋을 로드/언로드하는 훅.
 *
 * 로딩 우선순위: 현재 마을 (await) → NSEW (background) → 대각 (background)
 * 플레이어가 마을 경계를 넘으면 현재 마을을 전환하고 인접 마을을 갱신한다.
 */
export function useVillageLoader(initialVillageSlug: string | null) {
  const { worldPosition } = useGameStateStore();
  const setWorldPosition = useGameStateStore((s) => s.setWorldPosition);
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
  const initializedSlugRef = useRef<string | null>(null);

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
    console.log('[INIT] useEffect triggered', {
      initialVillageSlug,
      initializedSlug: initializedSlugRef.current,
      willRun: initialVillageSlug !== null && initialVillageSlug !== initializedSlugRef.current
    });

    // 이미 이 slug로 초기화했으면 스킵
    if (!initialVillageSlug || initialVillageSlug === initializedSlugRef.current) return;

    initializedRef.current = true;
    initializedSlugRef.current = initialVillageSlug;

    async function init() {
      console.log('[INIT] Starting initialization for:', initialVillageSlug);
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

        // 마을 중심 좌표 계산 및 플레이어 위치 설정
        const range = gridToWorldRange(
          metadata.gridX,
          metadata.gridY,
          metadata.gridWidth || 1,
          metadata.gridHeight || 1
        );
        const centerX = Math.floor((range.startX + range.endX) / 2);
        const centerY = Math.floor((range.startY + range.endY) / 2);
        console.log('[INIT] Setting player to center:', { x: centerX, y: centerY });
        setWorldPosition({ x: centerX, y: centerY });

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

    // Cleanup 제거: initializedSlugRef로 중복 초기화를 방지하므로 cleanup 불필요
  }, [initialVillageSlug, setLoading, setCurrentVillage, setCurrentVillageLoaded, loadVillage, loadNearbyVillages, updateGridIndex, setWorldPosition]);

  // 플레이어 이동 시 마을 전환 감지
  useEffect(() => {
    if (!currentVillage) return;

    const { gridX, gridY } = worldToGrid(worldPosition.x, worldPosition.y);
    const slugAtPlayerGrid = getVillageSlugAtGrid(gridX, gridY);

    console.log('[TRANSITION] Check', {
      worldPos: worldPosition,
      gridX,
      gridY,
      slugAtPlayerGrid,
      currentVillageSlug,
      willTransition: slugAtPlayerGrid !== currentVillageSlug
    });

    // 플레이어가 있는 grid의 slug가 현재 마을 slug와 다르면 마을 전환
    if (slugAtPlayerGrid !== currentVillageSlug) {
      if (!slugAtPlayerGrid) {
        // 마을이 없는 곳 (default map 영역)으로 이동
        loadNearbyVillages(gridX, gridY);
        return;
      }

      // nearbyVillages에서 메타데이터 조회
      const nearbyVillages = useVillageStore.getState().nearbyVillages;
      const newMeta = nearbyVillages.get(slugAtPlayerGrid);
      if (!newMeta) return;

      console.log('[TRANSITION] Switching to village:', slugAtPlayerGrid);
      setCurrentVillage(slugAtPlayerGrid, newMeta);

      // URL 업데이트 (페이지 리로드 없이)
      // NOTE: URL 업데이트를 하면 초기화 useEffect가 다시 실행되어 플레이어가 중앙으로 이동됨
      // 따라서 URL 업데이트는 초기 로드 시에만 수행하고, 마을 전환 시에는 하지 않음
      // const url = new URL(window.location.href);
      // url.searchParams.set('village', slugAtPlayerGrid);
      // window.history.replaceState({}, '', url.toString());

      // 새 인접 마을 로드
      loadNearbyVillages(gridX, gridY);
    }
  }, [worldPosition, currentVillage, currentVillageSlug, getVillageSlugAtGrid, setCurrentVillage, loadNearbyVillages]);

  return {
    isLoading: useVillageStore((s) => s.isLoading),
    isCurrentVillageLoaded: useVillageStore((s) => s.isCurrentVillageLoaded),
    currentVillageSlug,
  };
}
