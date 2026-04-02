import { useEffect, useMemo, useRef } from "react";
import { useGameStateStore } from "@/stores";
import { TILE_SIZE, VILLAGE_SIZE } from "@/constants/game";
import { useVillageStore, LoadedVillage } from "@/stores/useVillageStore";
import { gridToWorldRange } from "@/lib/village-utils";
import { getVillageCanvas } from "@/lib/village-canvas-cache";

const BUFFER_TILES = 2;

/**
 * 멀티 빌리지 타일맵 렌더링 훅.
 *
 * 마을별 사전 렌더된 캐시 canvas를 뷰포트에 배치하여
 * 매 이동마다의 타일별 drawImage를 제거한다.
 */
export function useTiledMap(
  canvasSize: { width: number; height: number },
  effectiveTileSize?: number,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { worldPosition } = useGameStateStore();
  const loadedVillages = useVillageStore((s) => s.loadedVillages);
  const isCurrentVillageLoaded = useVillageStore((s) => s.isCurrentVillageLoaded);
  const defaultVillage = useVillageStore((s) => s.defaultVillage);
  const gridIndex = useVillageStore((s) => s.gridIndex);

  const canvasRenderCountRef = useRef(0);

  const actualTileSize = effectiveTileSize || TILE_SIZE;
  const cameraTilePosition = useMemo(() => {
    const tilesX = Math.ceil(canvasSize.width / actualTileSize);
    const tilesY = Math.ceil(canvasSize.height / actualTileSize);
    return {
      x: worldPosition.x - Math.floor(tilesX / 2),
      y: worldPosition.y - Math.floor(tilesY / 2),
    };
  }, [worldPosition, canvasSize, actualTileSize]);

  useEffect(() => {
    if (loadedVillages.size === 0 || !isCurrentVillageLoaded) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvasRenderCountRef.current++;
    const renderN = canvasRenderCountRef.current;
    const isDev = process.env.NEXT_PUBLIC_ENABLE_PERF_MARKS === 'true';
    const renderMarkStart = `canvas-render-${renderN}-start`;
    if (isDev) performance.mark(renderMarkStart);

    // 캔버스 크기 지정 (크기 변경 시에만 재할당)
    if (canvas.width !== canvasSize.width || canvas.height !== canvasSize.height) {
      canvas.width = canvasSize.width;
      canvas.height = canvasSize.height;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const tilesX = Math.ceil(canvas.width / actualTileSize);
    const tilesY = Math.ceil(canvas.height / actualTileSize);

    // 렌더링 범위 (글로벌 좌표, 버퍼 포함)
    const renderStartX = cameraTilePosition.x - BUFFER_TILES;
    const renderEndX = cameraTilePosition.x + tilesX + BUFFER_TILES;
    const renderStartY = cameraTilePosition.y - BUFFER_TILES;
    const renderEndY = cameraTilePosition.y + tilesY + BUFFER_TILES;

    // 뷰포트에 겹치는 grid 범위
    const gridStartX = Math.floor((renderStartX + VILLAGE_SIZE / 2) / VILLAGE_SIZE);
    const gridEndX = Math.floor((renderEndX + VILLAGE_SIZE / 2) / VILLAGE_SIZE);
    const gridStartY = Math.floor((renderStartY + VILLAGE_SIZE / 2) / VILLAGE_SIZE);
    const gridEndY = Math.floor((renderEndY + VILLAGE_SIZE / 2) / VILLAGE_SIZE);

    // 마을별 캐시 canvas를 뷰포트에 배치
    for (let gy = gridStartY; gy <= gridEndY; gy++) {
      for (let gx = gridStartX; gx <= gridEndX; gx++) {
        const gKey = `${gx},${gy}`;
        const slug = gridIndex.get(gKey);

        let village: LoadedVillage | undefined;
        let villageGridX = gx;
        let villageGridY = gy;
        let cacheKey: string;

        if (slug) {
          village = loadedVillages.get(slug);
          if (village) {
            villageGridX = village.metadata.gridX;
            villageGridY = village.metadata.gridY;
            cacheKey = slug;
          } else if (defaultVillage) {
            village = {
              ...defaultVillage,
              metadata: { ...defaultVillage.metadata, gridX: gx, gridY: gy },
            };
            cacheKey = '__default__';
          } else {
            continue;
          }
        } else if (defaultVillage) {
          village = {
            ...defaultVillage,
            metadata: { ...defaultVillage.metadata, gridX: gx, gridY: gy },
          };
          cacheKey = '__default__';
        } else {
          continue;
        }

        const cachedCanvas = getVillageCanvas(cacheKey!, village);
        const range = gridToWorldRange(
          villageGridX, villageGridY,
          village.metadata.gridWidth || 1, village.metadata.gridHeight || 1,
        );

        // 뷰포트에 보이는 영역 계산 (source rect = 마을 canvas 내 좌표, dest rect = 뷰포트 canvas 좌표)
        const overlapStartX = Math.max(renderStartX, range.startX);
        const overlapEndX = Math.min(renderEndX, range.endX + 1);
        const overlapStartY = Math.max(renderStartY, range.startY);
        const overlapEndY = Math.min(renderEndY, range.endY + 1);

        if (overlapStartX >= overlapEndX || overlapStartY >= overlapEndY) continue;

        // source: 마을 canvas 내 픽셀 좌표
        const srcX = (overlapStartX - range.startX) * TILE_SIZE;
        const srcY = (overlapStartY - range.startY) * TILE_SIZE;
        const srcW = (overlapEndX - overlapStartX) * TILE_SIZE;
        const srcH = (overlapEndY - overlapStartY) * TILE_SIZE;

        // dest: 뷰포트 canvas 내 픽셀 좌표
        const dstX = (overlapStartX - cameraTilePosition.x) * TILE_SIZE - TILE_SIZE / 4;
        const dstY = (overlapStartY - cameraTilePosition.y) * TILE_SIZE - TILE_SIZE / 4;

        ctx.drawImage(cachedCanvas, srcX, srcY, srcW, srcH, dstX, dstY, srcW, srcH);
      }
    }

    if (isDev) {
      const renderMarkEnd = `canvas-render-${renderN}-end`;
      performance.mark(renderMarkEnd);
      const renderDuration = performance.measure(`canvas-render-${renderN}`, renderMarkStart, renderMarkEnd).duration;
      if (renderN <= 20) {
        console.log(`  🖼 canvas render #${renderN}: ${renderDuration.toFixed(1)}ms`);
      }
      if (renderN === 1 && performance.getEntriesByName('village-ready').length > 0) {
        performance.measure('⏱ village-ready → first canvas render', 'village-ready', renderMarkEnd);
      }
    }
  }, [loadedVillages, isCurrentVillageLoaded, cameraTilePosition, canvasSize, actualTileSize, defaultVillage, gridIndex]);

  return { canvasRef, cameraTilePosition };
}
