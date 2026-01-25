import { useEffect, useRef, useState, useCallback } from "react";
import { XMLParser } from "fast-xml-parser";
import { useMapStore, Tileset, TilesetInfo } from "@/stores/useMapStore";
import { useGameStateStore } from "@/stores";
import { TILE_SIZE } from "@/constants/game";

// Tiled flip flags
const FLIPPED_HORIZONTALLY_FLAG = 0x80000000;
const FLIPPED_VERTICALLY_FLAG = 0x40000000;
const FLIPPED_DIAGONALLY_FLAG = 0x20000000;
const FLIP_MASK = ~(FLIPPED_HORIZONTALLY_FLAG | FLIPPED_VERTICALLY_FLAG | FLIPPED_DIAGONALLY_FLAG);

// 기본 타일 ID (빈 땅)
const DEFAULT_TILE_ID = 415;

// 커스텀 타일 ID 시작 번호
const CUSTOM_TILE_ID_START = 100000;

// 버퍼 영역 (화면 밖으로 추가 로드할 타일 수)
const BUFFER_TILES = 10;

function getActualGid(gid: number): number {
  return (gid & FLIP_MASK) >>> 0;
}

export function useTiledMap(
  canvasSize: { width: number; height: number },
  effectiveTileSize?: number,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraTilePosition, setCameraTilePosition] = useState({ x: 0, y: 0 });
  const { worldPosition } = useGameStateStore();
  const tilesetsLoadedRef = useRef(false);

  const {
    tiles,
    tilesets,
    tilesetInfos,
    customTileImages,
    isLoaded,
    isLoading,
    setTilesets,
    setIsLoaded,
    loadTilesFromDB,
  } = useMapStore();

  // 커스텀 타일 이미지 캐시 (HTMLImageElement)
  const customTileImageCache = useRef<{ [tileId: number]: HTMLImageElement }>({});
  const [customImagesVersion, setCustomImagesVersion] = useState(0);  // 리렌더링 트리거용

  // 타일셋 이미지 로드 (한 번만 실행)
  const loadTilesets = useCallback(async () => {
    if (tilesetsLoadedRef.current || tilesets.length > 0) return;
    if (!tilesetInfos || tilesetInfos.length === 0) return;

    tilesetsLoadedRef.current = true;

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      ignoreDeclaration: true,
    });

    const loadedTilesets: Tileset[] = await Promise.all(
      tilesetInfos.map(async (ts: TilesetInfo) => {
        try {
          if (ts.source) {
            const tsxPath = "/map/image-sources/" + ts.source;
            const tsxText = await (await fetch(tsxPath)).text();
            const tileset = parser.parse(tsxText).tileset;

            const imagePath = "/map/image-sources/" + tileset.image.source.replace("./", "");
            const image = new Image();

            await new Promise<void>((resolve) => {
              image.onload = () => resolve();
              image.src = imagePath;
            });

            const columns = parseInt(tileset.columns) || 1;
            const tilecount = parseInt(tileset.tilecount) || 1;
            const tilewidth = parseInt(tileset.tilewidth) || 40;
            const tileheight = parseInt(tileset.tileheight) || 40;

            const xmlImageWidth = parseInt(tileset.image.width) || image.width;
            const imageScale = image.width / xmlImageWidth;

            return {
              firstgid: ts.firstgid,
              image,
              columns,
              tilecount,
              tilewidth,
              tileheight,
              imageScale,
            };
          }

          // 인라인 타일셋
          const imagePath = "/map/image-sources/" + (ts.image || "").replace("./", "");
          const image = new Image();
          await new Promise<void>((resolve) => {
            image.onload = () => resolve();
            image.src = imagePath;
          });

          return {
            firstgid: ts.firstgid,
            image,
            columns: ts.columns || 1,
            tilecount: ts.tilecount || 1,
            tilewidth: ts.tilewidth || 40,
            tileheight: ts.tileheight || 40,
            imageScale: 1,
          };
        } catch (err) {
          console.error(`Error loading tileset ${ts.firstgid}:`, err);
          return null as unknown as Tileset;
        }
      })
    );

    setTilesets(loadedTilesets.filter(Boolean));
  }, [tilesetInfos, tilesets.length, setTilesets]);

  // 타일셋 정보가 로드되면 이미지 로드
  useEffect(() => {
    if (tilesetInfos.length > 0 && tilesets.length === 0) {
      loadTilesets();
    }
  }, [tilesetInfos, tilesets.length, loadTilesets]);

  // 플레이어 위치 기반으로 타일 로드
  useEffect(() => {
    const actualTileSize = effectiveTileSize || TILE_SIZE;
    const tilesX = Math.ceil(canvasSize.width / actualTileSize);
    const tilesY = Math.ceil(canvasSize.height / actualTileSize);
    const halfTilesX = Math.floor(tilesX / 2);
    const halfTilesY = Math.floor(tilesY / 2);

    const startX = worldPosition.x - halfTilesX - BUFFER_TILES;
    const startY = worldPosition.y - halfTilesY - BUFFER_TILES;
    const endX = worldPosition.x + halfTilesX + BUFFER_TILES;
    const endY = worldPosition.y + halfTilesY + BUFFER_TILES;

    loadTilesFromDB(startX, startY, endX, endY);
  }, [worldPosition.x, worldPosition.y, canvasSize, effectiveTileSize, loadTilesFromDB]);

  // 렌더링
  useEffect(() => {
    if (tilesets.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 캔버스 크기 설정
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;

    // 실제 타일 크기
    const actualTileSize = effectiveTileSize || TILE_SIZE;
    const tilesX = Math.ceil(canvas.width / actualTileSize);
    const tilesY = Math.ceil(canvas.height / actualTileSize);
    const halfTilesX = Math.floor(tilesX / 2);
    const halfTilesY = Math.floor(tilesY / 2);

    // 카메라 위치 (플레이어 중심) - 경계 없음
    const cameraTilePositionX = worldPosition.x - halfTilesX;
    const cameraTilePositionY = worldPosition.y - halfTilesY;

    setCameraTilePosition({ x: cameraTilePositionX, y: cameraTilePositionY });

    // 렌더링 범위 (버퍼 포함)
    const renderStartX = cameraTilePositionX - BUFFER_TILES;
    const renderEndX = cameraTilePositionX + tilesX + BUFFER_TILES;
    const renderStartY = cameraTilePositionY - BUFFER_TILES;
    const renderEndY = cameraTilePositionY + tilesY + BUFFER_TILES;

    // 배경 클리어 (흰색 - 경계 바깥 영역)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 레이어별 렌더링
    const layers = ['layer0', 'layer1', 'layer2'] as const;

    for (const layerKey of layers) {
      for (let tileY = renderStartY; tileY < renderEndY; tileY++) {
        for (let tileX = renderStartX; tileX < renderEndX; tileX++) {
          const key = `${tileX},${tileY}`;
          let rawGid = tiles[layerKey][key];

          // 타일이 없으면 스킵 (흰색 배경 유지 - 경계 바깥)
          if (rawGid === undefined) {
            continue;
          }

          if (rawGid === 0) continue;

          // flip 플래그 제거
          const gid = getActualGid(rawGid);
          if (gid === 0) continue;

          const screenTileX = tileX - cameraTilePositionX;
          const screenTileY = tileY - cameraTilePositionY;
          const dx = screenTileX * actualTileSize - actualTileSize / 4;
          const dy = screenTileY * actualTileSize - actualTileSize / 4;

          // 커스텀 타일 처리 (tileId >= 100000)
          if (gid >= CUSTOM_TILE_ID_START) {
            // 캐시에서 이미지 찾기
            let cachedImg = customTileImageCache.current[gid];

            if (!cachedImg && customTileImages[gid]) {
              // 이미지 로드 및 캐시
              const img = new Image();
              img.onload = () => {
                // 이미지 로드 완료 시 리렌더링 트리거
                setCustomImagesVersion(v => v + 1);
              };
              img.src = customTileImages[gid];
              customTileImageCache.current[gid] = img;
              cachedImg = img;
            }

            if (cachedImg && cachedImg.complete && cachedImg.naturalWidth > 0) {
              ctx.drawImage(
                cachedImg,
                dx, dy,
                actualTileSize, actualTileSize
              );
            }
            continue;
          }

          // 타일셋 찾기
          const ts = [...tilesets].reverse().find((t) => gid >= t.firstgid);
          if (!ts) continue;

          const localId = gid - ts.firstgid;
          const scale = ts.imageScale || 1;

          const sx = (localId % ts.columns) * ts.tilewidth * scale;
          const sy = Math.floor(localId / ts.columns) * ts.tileheight * scale;
          const sw = ts.tilewidth * scale;
          const sh = ts.tileheight * scale;

          if (ts.tilewidth <= 0 || ts.tileheight <= 0) continue;

          // Flip 처리
          const flippedH = (rawGid & FLIPPED_HORIZONTALLY_FLAG) !== 0;
          const flippedV = (rawGid & FLIPPED_VERTICALLY_FLAG) !== 0;
          const flippedD = (rawGid & FLIPPED_DIAGONALLY_FLAG) !== 0;

          if (flippedH || flippedV || flippedD) {
            ctx.save();
            ctx.translate(dx + actualTileSize / 2, dy + actualTileSize / 2);

            if (flippedD) {
              ctx.rotate(Math.PI / 2);
              ctx.scale(-1, 1);
            }

            if (flippedH) ctx.scale(-1, 1);
            if (flippedV) ctx.scale(1, -1);

            ctx.drawImage(
              ts.image,
              sx, sy, sw, sh,
              -actualTileSize / 2, -actualTileSize / 2,
              actualTileSize, actualTileSize
            );

            ctx.restore();
          } else {
            ctx.drawImage(
              ts.image,
              sx, sy, sw, sh,
              dx, dy,
              actualTileSize, actualTileSize
            );
          }
        }
      }
    }

    setIsLoaded(true);
  }, [tiles, tilesets, customTileImages, customImagesVersion, worldPosition, canvasSize, effectiveTileSize, setIsLoaded]);

  return {
    canvasRef,
    isLoaded,
    cameraTilePosition,
    // 기존 호환성 - 무한 맵이므로 경계 없음
    mapStartPosition: { x: -Infinity, y: -Infinity },
    mapEndPosition: { x: Infinity, y: Infinity },
  };
}
