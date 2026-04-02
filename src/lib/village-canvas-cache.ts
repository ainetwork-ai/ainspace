import { TILE_SIZE } from '@/constants/game';
import { LoadedVillage } from '@/stores/useVillageStore';
import {
  getActualGid,
  FLIPPED_HORIZONTALLY_FLAG,
  FLIPPED_VERTICALLY_FLAG,
  FLIPPED_DIAGONALLY_FLAG,
} from '@/lib/village-map-loader';

const villageCanvasCache = new Map<string, HTMLCanvasElement>();

/**
 * 마을의 전체 타일을 canvas에 렌더하여 반환.
 * 모든 레이어를 순서대로 그려 최종 합성된 이미지를 생성.
 */
function renderVillageToCanvas(village: LoadedVillage): HTMLCanvasElement {
  const { mapData, tilesets } = village;
  const { width, height } = mapData;

  const canvas = document.createElement('canvas');
  canvas.width = width * TILE_SIZE;
  canvas.height = height * TILE_SIZE;
  const ctx = canvas.getContext('2d')!;

  const visibleLayers = mapData.layers.filter(
    (l) => l.type === 'tilelayer' && l.visible
  );

  for (const layer of visibleLayers) {
    for (let localY = 0; localY < height; localY++) {
      for (let localX = 0; localX < width; localX++) {
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

        const dx = localX * TILE_SIZE;
        const dy = localY * TILE_SIZE;

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

  return canvas;
}

/** 캐시에서 마을 canvas 반환. 없으면 렌더 후 캐시 */
export function getVillageCanvas(slug: string, village: LoadedVillage): HTMLCanvasElement {
  const cached = villageCanvasCache.get(slug);
  if (cached) return cached;

  const canvas = renderVillageToCanvas(village);
  villageCanvasCache.set(slug, canvas);
  return canvas;
}

/** 마을 언로드 시 캐시 제거 */
export function removeVillageCanvas(slug: string): void {
  villageCanvasCache.delete(slug);
}

/** 캐시 무효화 후 재렌더 */
export function invalidateVillageCanvas(slug: string, village: LoadedVillage): void {
  villageCanvasCache.delete(slug);
  const canvas = renderVillageToCanvas(village);
  villageCanvasCache.set(slug, canvas);
}
