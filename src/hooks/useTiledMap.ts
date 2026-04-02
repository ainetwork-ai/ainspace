import { useEffect, useMemo, useRef, useState } from "react";
import { useGameStateStore } from "@/stores";
import { TILE_SIZE, VILLAGE_SIZE } from "@/constants/game";
import { useVillageStore, LoadedVillage } from "@/stores/useVillageStore";
import { gridToWorldRange } from "@/lib/village-utils";
import {
  getActualGid,
  FLIPPED_HORIZONTALLY_FLAG,
  FLIPPED_VERTICALLY_FLAG,
  FLIPPED_DIAGONALLY_FLAG,
} from "@/lib/village-map-loader";

/** 뷰포트 밖으로 미리 렌더하는 타일 수 (각 방향) */
const RENDER_BUFFER = 6;

/**
 * 멀티 빌리지 타일맵 렌더링 훅.
 *
 * 오버사이즈 canvas에 뷰포트 + 버퍼 영역을 렌더하고,
 * 이동 시에는 CSS transform만 변경하여 canvas redraw를 최소화한다.
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

  // 마지막 full redraw 시점의 worldPosition (canvas 중심)
  const canvasCenterRef = useRef({ x: 0, y: 0 });

  // redraw 트리거 카운터 (버퍼 소진 시 증가)
  const [redrawTrigger, setRedrawTrigger] = useState(0);

  const actualTileSize = effectiveTileSize || TILE_SIZE;

  // --- 버퍼 소진 감지: worldPosition 변경 시 redraw 필요 여부 판단 ---
  useEffect(() => {
    const dx = Math.abs(worldPosition.x - canvasCenterRef.current.x);
    const dy = Math.abs(worldPosition.y - canvasCenterRef.current.y);
    const isInitial = canvasCenterRef.current.x === 0 && canvasCenterRef.current.y === 0
        && worldPosition.x !== 0 && worldPosition.y !== 0;
    if (isInitial || dx >= RENDER_BUFFER - 1 || dy >= RENDER_BUFFER - 1) {
      setRedrawTrigger(n => n + 1);
    }
  }, [worldPosition]);

  // --- Canvas offset: 버퍼 오프셋 + worldPosition과 canvasCenter의 차이를 픽셀로 변환 ---
  const bufferOffsetPx = RENDER_BUFFER * actualTileSize;
  const canvasOffset = {
    x: -(worldPosition.x - canvasCenterRef.current.x) * actualTileSize - bufferOffsetPx,
    y: -(worldPosition.y - canvasCenterRef.current.y) * actualTileSize - bufferOffsetPx,
  };

  // --- Full redraw useEffect (worldPosition이 의존성에 없음) ---
  useEffect(() => {
    if (loadedVillages.size === 0 || !isCurrentVillageLoaded) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // worldPosition은 의존성에 없으므로 getState로 최신값 읽기
    const currentPos = useGameStateStore.getState().worldPosition;
    canvasCenterRef.current = { x: currentPos.x, y: currentPos.y };

    canvasRenderCountRef.current++;
    const renderN = canvasRenderCountRef.current;
    const isDev = process.env.NEXT_PUBLIC_ENABLE_PERF_MARKS === 'true';
    const renderMarkStart = `canvas-render-${renderN}-start`;
    if (isDev) performance.mark(renderMarkStart);

    // 오버사이즈 캔버스 크기 (뷰포트 + 양쪽 버퍼)
    const bufferPx = RENDER_BUFFER * actualTileSize;
    const totalWidth = canvasSize.width + bufferPx * 2;
    const totalHeight = canvasSize.height + bufferPx * 2;
    if (canvas.width !== totalWidth || canvas.height !== totalHeight) {
      canvas.width = totalWidth;
      canvas.height = totalHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 오버사이즈 canvas 기준 타일 개수
    const tilesX = Math.ceil(canvas.width / actualTileSize);
    const tilesY = Math.ceil(canvas.height / actualTileSize);
    const viewTilesX = Math.ceil(canvasSize.width / actualTileSize);
    const viewTilesY = Math.ceil(canvasSize.height / actualTileSize);
    const halfTilesX = Math.floor(viewTilesX / 2);
    const halfTilesY = Math.floor(viewTilesY / 2);

    // 카메라 위치: canvasCenter 기준, 버퍼 포함
    const cameraTilePositionX = currentPos.x - halfTilesX - RENDER_BUFFER;
    const cameraTilePositionY = currentPos.y - halfTilesY - RENDER_BUFFER;

    // 렌더링 범위 (글로벌 좌표)
    const renderStartX = cameraTilePositionX;
    const renderEndX = cameraTilePositionX + tilesX;
    const renderStartY = cameraTilePositionY;
    const renderEndY = cameraTilePositionY + tilesY;

    // 뷰포트에 겹치는 마을들 수집
    const visibleVillages: Array<{
      village: LoadedVillage;
      worldStartX: number;
      worldStartY: number;
      worldEndX: number;
      worldEndY: number;
    }> = [];

    const gridStartX = Math.floor((renderStartX + VILLAGE_SIZE / 2) / VILLAGE_SIZE);
    const gridEndX = Math.floor((renderEndX + VILLAGE_SIZE / 2) / VILLAGE_SIZE);
    const gridStartY = Math.floor((renderStartY + VILLAGE_SIZE / 2) / VILLAGE_SIZE);
    const gridEndY = Math.floor((renderEndY + VILLAGE_SIZE / 2) / VILLAGE_SIZE);

    for (let gy = gridStartY; gy <= gridEndY; gy++) {
      for (let gx = gridStartX; gx <= gridEndX; gx++) {
        const gKey = `${gx},${gy}`;
        const slug = gridIndex.get(gKey);

        if (slug) {
          const village = loadedVillages.get(slug);

          if (!village) {
            if (!defaultVillage) continue;
            const range = gridToWorldRange(gx, gy, 1, 1);
            visibleVillages.push({
              village: { ...defaultVillage, metadata: { ...defaultVillage.metadata, gridX: gx, gridY: gy } },
              worldStartX: range.startX, worldStartY: range.startY,
              worldEndX: range.endX, worldEndY: range.endY,
            });
            continue;
          }

          const range = gridToWorldRange(
            village.metadata.gridX, village.metadata.gridY,
            village.metadata.gridWidth || 1, village.metadata.gridHeight || 1,
          );
          visibleVillages.push({
            village,
            worldStartX: range.startX, worldStartY: range.startY,
            worldEndX: range.endX, worldEndY: range.endY,
          });
        } else if (defaultVillage) {
          const range = gridToWorldRange(gx, gy, 1, 1);
          visibleVillages.push({
            village: { ...defaultVillage, metadata: { ...defaultVillage.metadata, gridX: gx, gridY: gy } },
            worldStartX: range.startX, worldStartY: range.startY,
            worldEndX: range.endX, worldEndY: range.endY,
          });
        }
      }
    }

    if (visibleVillages.length === 0) return;

    // 최대 레이어 수 파악
    let maxLayers = 0;
    for (const { village } of visibleVillages) {
      const layerCount = village.mapData.layers.filter(
        (l) => l.type === "tilelayer" && l.visible
      ).length;
      if (layerCount > maxLayers) maxLayers = layerCount;
    }

    // 레이어 순서대로 모든 마을의 타일 그리기
    for (let layerIdx = 0; layerIdx < maxLayers; layerIdx++) {
      for (const vd of visibleVillages) {
        const { village, worldStartX, worldStartY } = vd;
        const { mapData, tilesets } = village;
        const { width, height } = mapData;

        const visibleLayers = mapData.layers.filter(
          (l) => l.type === "tilelayer" && l.visible
        );
        if (layerIdx >= visibleLayers.length) continue;
        const layer = visibleLayers[layerIdx];

        const localStartX = Math.max(0, renderStartX - worldStartX);
        const localEndX = Math.min(width, renderEndX - worldStartX + 1);
        const localStartY = Math.max(0, renderStartY - worldStartY);
        const localEndY = Math.min(height, renderEndY - worldStartY + 1);

        for (let localY = localStartY; localY < localEndY; localY++) {
          for (let localX = localStartX; localX < localEndX; localX++) {
            const tileIndex = localY * width + localX;
            const rawGid = layer.data[tileIndex];
            if (rawGid === 0) continue;

            const gid = getActualGid(rawGid);
            if (gid === 0) continue;

            const ts = [...tilesets].reverse().find((t) => gid >= t.firstgid);
            if (!ts) continue;

            const localId = gid - ts.firstgid;
            const scale = ts.imageScale || 1;
            const sx = (localId % ts.columns) * ts.tilewidth * scale;
            const sy = Math.floor(localId / ts.columns) * ts.tileheight * scale;
            const sw = ts.tilewidth * scale;
            const sh = ts.tileheight * scale;

            if (ts.tilewidth <= 0 || ts.tileheight <= 0) continue;

            const worldTileX = worldStartX + localX;
            const worldTileY = worldStartY + localY;
            const screenTileX = worldTileX - cameraTilePositionX;
            const screenTileY = worldTileY - cameraTilePositionY;
            const dx = screenTileX * TILE_SIZE - TILE_SIZE / 4;
            const dy = screenTileY * TILE_SIZE - TILE_SIZE / 4;

            const flippedH = (rawGid & FLIPPED_HORIZONTALLY_FLAG) !== 0;
            const flippedV = (rawGid & FLIPPED_VERTICALLY_FLAG) !== 0;
            const flippedD = (rawGid & FLIPPED_DIAGONALLY_FLAG) !== 0;

            if (flippedH || flippedV || flippedD) {
              ctx.save();
              ctx.translate(dx + TILE_SIZE / 2, dy + TILE_SIZE / 2);
              if (flippedD) {
                ctx.rotate(Math.PI / 2);
                ctx.scale(-1, 1);
              }
              if (flippedH) ctx.scale(-1, 1);
              if (flippedV) ctx.scale(1, -1);
              ctx.drawImage(ts.image, sx, sy, sw, sh, -TILE_SIZE / 2, -TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
              ctx.restore();
            } else {
              ctx.drawImage(ts.image, sx, sy, sw, sh, dx, dy, TILE_SIZE, TILE_SIZE);
            }
          }
        }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedVillages, isCurrentVillageLoaded, redrawTrigger, canvasSize, actualTileSize, defaultVillage, gridIndex]);

  // --- cameraTilePosition: 에이전트/플레이어 DOM 위치 계산용 (뷰포트 기준) ---
  const cameraTilePosition = useMemo(() => {
    const viewTilesX = Math.ceil(canvasSize.width / actualTileSize);
    const viewTilesY = Math.ceil(canvasSize.height / actualTileSize);
    return {
      x: worldPosition.x - Math.floor(viewTilesX / 2),
      y: worldPosition.y - Math.floor(viewTilesY / 2),
    };
  }, [worldPosition, canvasSize, actualTileSize]);

  return { canvasRef, cameraTilePosition, canvasOffset };
}
