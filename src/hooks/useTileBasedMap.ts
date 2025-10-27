import { useState, useEffect, useRef } from 'react';
import * as Sentry from '@sentry/nextjs';

interface TileConfig {
  tileSize: number; // Size of each image tile (840px)
  tilesPerSide: number; // Number of tiles per side (5)
  gameTilesPerImageTile: number; // Game tiles per image tile (21)
}

interface LoadedTile {
  image: HTMLImageElement;
  row: number;
  col: number;
}

const TILE_CONFIG: TileConfig = {
  tileSize: 840, // Each tile is 840x840 pixels
  tilesPerSide: 5, // 5x5 grid of tiles
  gameTilesPerImageTile: 21 // Each tile contains 21x21 game tiles (40px each)
};

/**
 * Custom hook for tile-based map rendering
 * Loads only the visible tiles based on camera position
 */
export function useTileBasedMap(
  layerName: 'land_layer_0' | 'land_layer_1',
  worldPosition: { x: number; y: number },
  canvasSize: { width: number; height: number },
  gameTileSize: number // TILE_SIZE from constants (40px)
) {
  const [loadedTiles, setLoadedTiles] = useState<Map<string, LoadedTile>>(new Map());
  const loadingTilesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Calculate which tiles are visible based on camera position
    const tilesX = Math.ceil(canvasSize.width / gameTileSize);
    const tilesY = Math.ceil(canvasSize.height / gameTileSize);
    const halfTilesX = Math.floor(tilesX / 2);
    const halfTilesY = Math.floor(tilesY / 2);

    const cameraTileX = worldPosition.x - halfTilesX;
    const cameraTileY = worldPosition.y - halfTilesY;

    // Convert camera position (in game tiles) to image tile coordinates
    const startRow = Math.floor(cameraTileY / TILE_CONFIG.gameTilesPerImageTile);
    const endRow = Math.ceil((cameraTileY + tilesY) / TILE_CONFIG.gameTilesPerImageTile);
    const startCol = Math.floor(cameraTileX / TILE_CONFIG.gameTilesPerImageTile);
    const endCol = Math.ceil((cameraTileX + tilesX) / TILE_CONFIG.gameTilesPerImageTile);

    // Load visible tiles
    const visibleTileKeys = new Set<string>();

    for (let row = Math.max(0, startRow); row < Math.min(TILE_CONFIG.tilesPerSide, endRow); row++) {
      for (let col = Math.max(0, startCol); col < Math.min(TILE_CONFIG.tilesPerSide, endCol); col++) {
        const tileKey = `${row}_${col}`;
        visibleTileKeys.add(tileKey);

        // Only load if not already loaded or loading
        if (!loadedTiles.has(tileKey) && !loadingTilesRef.current.has(tileKey)) {
          loadingTilesRef.current.add(tileKey);

          const img = new Image();
          img.onload = () => {
            setLoadedTiles((prev) => {
              const next = new Map(prev);
              next.set(tileKey, { image: img, row, col });
              return next;
            });
            loadingTilesRef.current.delete(tileKey);
          };
          img.onerror = () => {
            const errorMsg = `Failed to load tile: ${layerName}/tile_${row}_${col}.webp`;
            console.error(errorMsg);

            Sentry.captureException(new Error(errorMsg), {
              extra: {
                layerName,
                row,
                col,
                tileKey,
                worldPosition,
                canvasSize
              }
            });

            loadingTilesRef.current.delete(tileKey);
          };
          img.src = `/map/tiles/${layerName}/tile_${row}_${col}.webp`;
        }
      }
    }

    // Cleanup: Remove tiles that are no longer visible (optional - for memory management)
    // You can comment this out if you want to keep all loaded tiles in memory
    setLoadedTiles((prev) => {
      const next = new Map(prev);
      for (const key of next.keys()) {
        if (!visibleTileKeys.has(key)) {
          // Keep tiles in cache for better performance
          // Uncomment the next line to aggressively free memory
          // next.delete(key);
        }
      }
      return next;
    });
  }, [layerName, worldPosition.x, worldPosition.y, canvasSize.width, canvasSize.height, gameTileSize]);

  return { loadedTiles, tileConfig: TILE_CONFIG };
}

/**
 * Draw tiles on canvas
 */
export function drawTiledMap(
  ctx: CanvasRenderingContext2D,
  loadedTiles: Map<string, LoadedTile>,
  tileConfig: TileConfig,
  worldPosition: { x: number; y: number },
  canvasSize: { width: number; height: number },
  gameTileSize: number
) {
  const tilesX = Math.ceil(canvasSize.width / gameTileSize);
  const tilesY = Math.ceil(canvasSize.height / gameTileSize);
  const halfTilesX = Math.floor(tilesX / 2);
  const halfTilesY = Math.floor(tilesY / 2);

  const cameraTileX = worldPosition.x - halfTilesX;
  const cameraTileY = worldPosition.y - halfTilesY;

  loadedTiles.forEach(({ image, row, col }) => {
    // Calculate the position of this tile in world coordinates (game tiles)
    const tileWorldStartX = col * tileConfig.gameTilesPerImageTile;
    const tileWorldStartY = row * tileConfig.gameTilesPerImageTile;

    // Calculate how this tile should be drawn on the canvas
    const screenStartX = (tileWorldStartX - cameraTileX) * gameTileSize;
    const screenStartY = (tileWorldStartY - cameraTileY) * gameTileSize;

    // Calculate dimensions (in case of partial visibility)
    const width = tileConfig.tileSize * (gameTileSize / 40); // Scale based on gameTileSize
    const height = tileConfig.tileSize * (gameTileSize / 40);

    // Only draw if at least partially visible
    if (
      screenStartX + width >= 0 &&
      screenStartX < canvasSize.width &&
      screenStartY + height >= 0 &&
      screenStartY < canvasSize.height
    ) {
      ctx.drawImage(image, screenStartX, screenStartY, width, height);
    }
  });
}
