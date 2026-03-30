import { useEffect, useRef, useState } from "react";
import { useGameStateStore } from "@/stores";
import { TILE_SIZE, VILLAGE_SIZE } from "@/constants/game";
import { useVillageStore, LoadedVillage } from "@/stores/useVillageStore";
import { gridToWorldRange, worldToGrid } from "@/lib/village-utils";
import {
  getActualGid,
  FLIPPED_HORIZONTALLY_FLAG,
  FLIPPED_VERTICALLY_FLAG,
  FLIPPED_DIAGONALLY_FLAG,
} from "@/lib/village-map-loader";

const BUFFER_TILES = 2;

/**
 * 멀티 빌리지 타일맵 렌더링 훅.
 *
 * useVillageStore의 loadedVillages로부터 현재 뷰포트에 보이는
 * 모든 마을의 타일을 캔버스에 렌더링한다.
 */
export function useTiledMap(
  canvasSize: { width: number; height: number },
  effectiveTileSize?: number,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraTilePosition, setCameraTilePosition] = useState({ x: 0, y: 0 });
  const { worldPosition } = useGameStateStore();
  const loadedVillages = useVillageStore((s) => s.loadedVillages);
  const isCurrentVillageLoaded = useVillageStore((s) => s.isCurrentVillageLoaded);
  const defaultVillage = useVillageStore((s) => s.defaultVillage);
  const gridIndex = useVillageStore((s) => s.gridIndex);

  const canvasRenderCountRef = useRef(0);

  useEffect(() => {
    if (loadedVillages.size === 0 || !isCurrentVillageLoaded) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvasRenderCountRef.current++;
    const renderN = canvasRenderCountRef.current;
    const isDev = process.env.NODE_ENV === 'development';
    const renderMarkStart = `canvas-render-${renderN}-start`;
    if (isDev) performance.mark(renderMarkStart);

    // 캔버스 크기 지정
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 화면에 보이는 타일 개수 계산
    const actualTileSize = effectiveTileSize || TILE_SIZE;
    const tilesX = Math.ceil(canvas.width / actualTileSize);
    const tilesY = Math.ceil(canvas.height / actualTileSize);
    const halfTilesX = Math.floor(tilesX / 2);
    const halfTilesY = Math.floor(tilesY / 2);

    // 카메라 위치 계산 (글로벌 좌표계, 경계 클램프 없음 — 마을 존재 여부로 이동이 제한됨)
    const cameraTilePositionX = worldPosition.x - halfTilesX;
    const cameraTilePositionY = worldPosition.y - halfTilesY;
    setCameraTilePosition({ x: cameraTilePositionX, y: cameraTilePositionY });

    // 렌더링 범위 (글로벌 좌표, 버퍼 포함)
    const renderStartX = cameraTilePositionX - BUFFER_TILES;
    const renderEndX = cameraTilePositionX + tilesX + BUFFER_TILES;
    const renderStartY = cameraTilePositionY - BUFFER_TILES;
    const renderEndY = cameraTilePositionY + tilesY + BUFFER_TILES;

    // 뷰포트에 겹치는 마을들 수집 (로드된 마을 + 빈 grid는 default village)
    const visibleVillages: Array<{
      village: LoadedVillage;
      worldStartX: number;
      worldStartY: number;
      worldEndX: number;
      worldEndY: number;
    }> = [];

    // 뷰포트의 grid 범위 계산
    // worldToGrid 공식: Math.floor((worldX + 10) / 20)
    const gridStartX = Math.floor((renderStartX + VILLAGE_SIZE / 2) / VILLAGE_SIZE);
    const gridEndX = Math.floor((renderEndX + VILLAGE_SIZE / 2) / VILLAGE_SIZE);
    const gridStartY = Math.floor((renderStartY + VILLAGE_SIZE / 2) / VILLAGE_SIZE);
    const gridEndY = Math.floor((renderEndY + VILLAGE_SIZE / 2) / VILLAGE_SIZE);

    // 각 grid 위치에 대해 마을이 있으면 추가, 없으면 defaultVillage 추가
    for (let gy = gridStartY; gy <= gridEndY; gy++) {
      for (let gx = gridStartX; gx <= gridEndX; gx++) {
        const gridKey = `${gx},${gy}`;
        const slug = gridIndex.get(gridKey);

        if (slug) {
          // 마을이 있는 경우
          const village = loadedVillages.get(slug);

          if (!village) {
            // 아직 로드 안 됨: defaultVillage로 fallback
            if (!defaultVillage) continue;

            const range = gridToWorldRange(gx, gy, 1, 1);
            const virtualVillage: LoadedVillage = {
              ...defaultVillage,
              metadata: {
                ...defaultVillage.metadata,
                gridX: gx,
                gridY: gy,
              },
            };

            visibleVillages.push({
              village: virtualVillage,
              worldStartX: range.startX,
              worldStartY: range.startY,
              worldEndX: range.endX,
              worldEndY: range.endY,
            });
            continue;
          }

          const range = gridToWorldRange(
            village.metadata.gridX, village.metadata.gridY,
            village.metadata.gridWidth || 1, village.metadata.gridHeight || 1,
          );
          visibleVillages.push({
            village,
            worldStartX: range.startX,
            worldStartY: range.startY,
            worldEndX: range.endX,
            worldEndY: range.endY,
          });
        } else if (defaultVillage) {
          // 마을이 없는 경우: defaultVillage 사용
          const range = gridToWorldRange(gx, gy, 1, 1);

          // defaultVillage의 가상 인스턴스 생성 (metadata의 grid 위치만 변경)
          const virtualVillage: LoadedVillage = {
            ...defaultVillage,
            metadata: {
              ...defaultVillage.metadata,
              gridX: gx,
              gridY: gy,
            },
          };

          visibleVillages.push({
            village: virtualVillage,
            worldStartX: range.startX,
            worldStartY: range.startY,
            worldEndX: range.endX,
            worldEndY: range.endY,
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

        // 이 마을의 해당 레이어 가져오기
        const visibleLayers = mapData.layers.filter(
          (l) => l.type === "tilelayer" && l.visible
        );
        if (layerIdx >= visibleLayers.length) continue;
        const layer = visibleLayers[layerIdx];

        // 이 마을 내에서 뷰포트에 보이는 로컬 타일 범위 계산
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

            // gid에 맞는 tileset 찾기
            const ts = [...tilesets].reverse().find((t) => gid >= t.firstgid);
            if (!ts) continue;

            const localId = gid - ts.firstgid;
            const scale = ts.imageScale || 1;
            const sx = (localId % ts.columns) * ts.tilewidth * scale;
            const sy = Math.floor(localId / ts.columns) * ts.tileheight * scale;
            const sw = ts.tilewidth * scale;
            const sh = ts.tileheight * scale;

            if (ts.tilewidth <= 0 || ts.tileheight <= 0) continue;

            // 글로벌 좌표 → 스크린 좌표
            const worldTileX = worldStartX + localX;
            const worldTileY = worldStartY + localY;
            const screenTileX = worldTileX - cameraTilePositionX;
            const screenTileY = worldTileY - cameraTilePositionY;
            const dx = screenTileX * TILE_SIZE - TILE_SIZE / 4;
            const dy = screenTileY * TILE_SIZE - TILE_SIZE / 4;

            // Flip 처리
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
  }, [loadedVillages, isCurrentVillageLoaded, worldPosition, canvasSize, effectiveTileSize, defaultVillage, gridIndex]);

  return { canvasRef, cameraTilePosition };
}
