import { useEffect, useRef, useCallback } from 'react';
import { useVillageStore, LoadedVillage } from '@/stores/useVillageStore';
import { VillageMetadata } from '@/lib/village-redis';
import { loadVillageMap, loadDefaultVillageMap } from '@/lib/village-map-loader';
import { worldToGrid, gridToWorldRange, worldToLocalInVillage, findNearestValidPosition } from '@/lib/village-utils';
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

      // Viewport 기준 언로드: 플레이어 grid에서 ±2 이상 떨어진 마을 제거
      // (viewport 16x12, 마을 20x20이므로 ±2 grid면 충분히 커버)
      const UNLOAD_DISTANCE = 2;
      for (const [slug, village] of loadedVillages) {
        const vgx = village.metadata.gridX;
        const vgy = village.metadata.gridY;
        const vgw = village.metadata.gridWidth || 1;
        const vgh = village.metadata.gridHeight || 1;

        // 마을이 점유하는 grid 범위의 최소 거리 계산
        let minDist = Infinity;
        for (let dy = 0; dy < vgh; dy++) {
          for (let dx = 0; dx < vgw; dx++) {
            const dist = Math.max(
              Math.abs((vgx + dx) - gridX),
              Math.abs((vgy + dy) - gridY)
            );
            minDist = Math.min(minDist, dist);
          }
        }

        // 거리가 UNLOAD_DISTANCE보다 크면 언로드
        if (minDist > UNLOAD_DISTANCE) {
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
    // 이미 이 slug로 초기화했으면 스킵
    if (!initialVillageSlug || initialVillageSlug === initializedSlugRef.current) return;

    initializedRef.current = true;
    initializedSlugRef.current = initialVillageSlug;

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

        // 현재 마을 우선 로드 (collision 데이터 확보)
        const loaded = await loadVillage(metadata);

        // 마을 중심 좌표 계산 및 collision 회피 스폰 위치 결정
        const range = gridToWorldRange(
          metadata.gridX,
          metadata.gridY,
          metadata.gridWidth || 1,
          metadata.gridHeight || 1
        );
        const centerX = Math.floor((range.startX + range.endX) / 2);
        const centerY = Math.floor((range.startY + range.endY) / 2);

        const spawnPos = loaded
          ? findNearestValidPosition(centerX, centerY, (x, y) => {
              const { localX, localY } = worldToLocalInVillage(x, y, metadata.gridX, metadata.gridY);
              return loaded.collisionTiles.has(`${localX},${localY}`);
            })
          : null;

        setWorldPosition(spawnPos ?? { x: centerX, y: centerY });
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

  // 플레이어 이동 시 viewport 범위의 언로드된 마을 재로드
  useEffect(() => {
    if (!currentVillage) return;

    const { gridX, gridY } = worldToGrid(worldPosition.x, worldPosition.y);
    const nearbyVillages = useVillageStore.getState().nearbyVillages;

    // viewport 범위의 grid 확인 (±2 범위)
    const LOAD_DISTANCE = 2;
    const reloadPromises: Promise<void>[] = [];

    for (let dy = -LOAD_DISTANCE; dy <= LOAD_DISTANCE; dy++) {
      for (let dx = -LOAD_DISTANCE; dx <= LOAD_DISTANCE; dx++) {
        const checkGridX = gridX + dx;
        const checkGridY = gridY + dy;
        const checkSlug = getVillageSlugAtGrid(checkGridX, checkGridY);

        if (checkSlug && !loadedVillages.has(checkSlug)) {
          // nearbyVillages에서 메타데이터 확인
          const metadata = nearbyVillages.get(checkSlug);

          if (metadata) {
            // nearbyVillages에 있으면 바로 로드
            loadVillage(metadata);
          } else {
            // nearbyVillages에 없으면 API에서 fetch하여 로드
            const promise = (async () => {
              try {
                const res = await fetch(`/api/villages/${checkSlug}`);
                const data = await res.json();
                if (data.success && data.village) {
                  await loadVillage(data.village);
                }
              } catch (err) {
                console.error(`Failed to fetch village ${checkSlug}:`, err);
              }
            })();
            reloadPromises.push(promise);
          }
        }
      }
    }

    // 모든 fetch 완료 대기 (background)
    if (reloadPromises.length > 0) {
      Promise.all(reloadPromises).catch(err => {
        console.error('Error reloading villages:', err);
      });
    }
  }, [worldPosition, currentVillage, getVillageSlugAtGrid, loadedVillages, loadVillage]);

  return {
    isLoading: useVillageStore((s) => s.isLoading),
    isCurrentVillageLoaded: useVillageStore((s) => s.isCurrentVillageLoaded),
    currentVillageSlug,
  };
}
