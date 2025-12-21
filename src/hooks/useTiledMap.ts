import { useEffect, useRef, useState } from "react";
import { XMLParser } from "fast-xml-parser";
import { useMapStore } from "@/stores/useMapStore";
import { useGameStateStore } from "@/stores";
import { TILE_SIZE } from "@/constants/game";
import { TiledMap, Tileset } from "@/stores/useMapStore";

type TMJParsedTileset = {
  firstgid: number;
} & ({
  source: string;
} | {
  image: string;
  columns: number;
  tilecount: number;
  tilewidth: number;
  tileheight: number;
}
)

interface TMJParsedTilemap extends Omit<TiledMap, 'tilesets'> {
  tilesets: TMJParsedTileset[];
}

// Tiled flip flags
const FLIPPED_HORIZONTALLY_FLAG = 0x80000000;
const FLIPPED_VERTICALLY_FLAG = 0x40000000;
const FLIPPED_DIAGONALLY_FLAG = 0x20000000;
const FLIP_MASK = ~(FLIPPED_HORIZONTALLY_FLAG | FLIPPED_VERTICALLY_FLAG | FLIPPED_DIAGONALLY_FLAG);

function getActualGid(gid: number): number {
  return (gid & FLIP_MASK) >>> 0;
}

export function useTiledMap(
  mapUrl: string,
  canvasSize: { width: number; height: number },
  effectiveTileSize?: number,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraTilePosition, setCameraTilePosition] = useState({ x: 0, y: 0 });
  const { worldPosition } = useGameStateStore();

  const { 
    setMapData,
    setTilesets,
    setCollisionTiles,
    setMapStartPosition,
    setMapEndPosition,
    mapData,
    mapStartPosition,
    mapEndPosition,
    tilesets,
    setIsLoaded,
    isLoaded,
  } = useMapStore();

  useEffect(() => {
    async function loadMap() {
      // 1️⃣ 맵 JSON 로드
      const mapRes = await fetch(mapUrl);
      const _mapData = await mapRes.json();
      setMapData(_mapData);

      // 2️⃣ tileset 들 로드 (병렬)
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
        ignoreDeclaration: true,
      });

      console.log(_mapData.tilesets);

      const _tilesets: Tileset[] = await Promise.all(
        _mapData.tilesets.map(async (ts: TMJParsedTileset) => {
          try {
            if ('source' in ts) {
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
              const imagePath = "/map/image-sources/" + ts.image.replace("./", "");
              const image = new Image();
              await new Promise<void>((resolve) => {
                image.onload = () => resolve();
                image.src = imagePath;
              });

              const columns = ts.columns || 1;
              const tilecount = ts.tilecount || 1;
              const tilewidth = ts.tilewidth || 40;
              const tileheight = ts.tileheight || 40;

              const xmlImageWidth = image.width;
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
          } catch (err) {
            console.error(`Error loading tileset ${ts.firstgid}:`, err);
            return null as unknown as Tileset;
          }
        }),
      );
      setTilesets(_tilesets);

      // 3️⃣ Layer1로 시작하는 레이어에서 충돌 타일 좌표 수집
      const collisionTiles: Array<{ x: number; y: number }> = [];
      const { width, height } = _mapData;

      // 맵 중앙을 (0, 0)으로 설정하기 위한 오프셋 계산 (drawMap과 동일한 좌표계 사용)
      const mapCenterX = Math.floor(width / 2);
      const mapCenterY = Math.floor(height / 2);

      for (const layer of _mapData.layers) {
        // Layer1로 시작하는 레이어만 처리
        if (layer.type === "tilelayer" && layer.name.startsWith("Layer1")) {
          // 타일 데이터 순회 (맵 좌표계)
          for (let mapY = 0; mapY < height; mapY++) {
            for (let mapX = 0; mapX < width; mapX++) {
              const tileIndex = mapY * width + mapX;
              const rawGid = layer.data[tileIndex];
              // flip 플래그 제거하여 실제 gid 추출
              const gid = getActualGid(rawGid);
              // gid가 0이 아니면 충돌 타일로 판정
              if (gid !== 0) {
                // 맵 좌표계를 월드 좌표계로 변환 (맵 중앙이 0, 0)
                const worldX = mapX - mapCenterX;
                const worldY = mapY - mapCenterY;
                collisionTiles.push({ x: worldX, y: worldY });
              }
            }
          }
        }
      }

      setCollisionTiles(collisionTiles);
      setMapStartPosition({ x: -mapCenterX, y: -mapCenterY });
      setMapEndPosition({ x: mapCenterX, y: mapCenterY });
    }
    loadMap();
  }, [mapUrl, setMapData, setTilesets, setCollisionTiles, setMapStartPosition, setMapEndPosition]);

  useEffect(() => {
    async function drawMap() {
      if (!mapData || tilesets.length === 0) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // 3️⃣ 캔버스 크기 지정
      const { width, height } = mapData;
      canvas.width = canvasSize.width;
      canvas.height = canvasSize.height;

      // 4️⃣ 맵 중앙을 (0, 0)으로 설정하기 위한 오프셋 계산
      const mapCenterX = Math.floor(width / 2);
      const mapCenterY = Math.floor(height / 2);

      // 5️⃣ 화면에 보이는 타일 개수 계산
      const actualTileSize = effectiveTileSize || TILE_SIZE;
      const tilesX = Math.ceil(canvas.width / actualTileSize);
      const tilesY = Math.ceil(canvas.height / actualTileSize);
      const halfTilesX = Math.floor(tilesX / 2);
      const halfTilesY = Math.floor(tilesY / 2);

      // 6️⃣ 버퍼 영역 설정 (±2 타일)
      const BUFFER_TILES = 2;

      // 7️⃣ 모든 계산을 맵 중앙 기준 좌표계로 통일
      // 카메라 위치 계산 (맵 중앙 기준 좌표계)
      let cameraTilePositionX = worldPosition.x - halfTilesX;
      let cameraTilePositionY = worldPosition.y - halfTilesY;

      // 맵 경계 체크 (맵 중앙 기준 좌표계로 계산)
      // 맵 왼쪽 위: (-mapCenterX, -mapCenterY)
      // 맵 오른쪽 아래: (mapCenterX, mapCenterY)
      const minCameraX = -mapCenterX;
      const maxCameraX = mapCenterX - tilesX + 1;
      const minCameraY = -mapCenterY;
      const maxCameraY = mapCenterY - tilesY + 1;

      cameraTilePositionX = Math.max(minCameraX, Math.min(maxCameraX, cameraTilePositionX));
      cameraTilePositionY = Math.max(minCameraY, Math.min(maxCameraY, cameraTilePositionY));

      setCameraTilePosition({ x: cameraTilePositionX, y: cameraTilePositionY });

      // 8️⃣ 렌더링 범위 확장 (화면 + 버퍼, 맵 중앙 기준 좌표계)
      const renderStartX = Math.max(-mapCenterX, cameraTilePositionX - BUFFER_TILES);
      const renderEndX = Math.min(mapCenterX + 1, cameraTilePositionX + tilesX + BUFFER_TILES);
      const renderStartY = Math.max(-mapCenterY, cameraTilePositionY - BUFFER_TILES);
      const renderEndY = Math.min(mapCenterY + 1, cameraTilePositionY + tilesY + BUFFER_TILES);

      // 9️⃣ 화면에 보이는 타일 + 버퍼 영역 그리기
      for (const layer of mapData.layers) {
        if (layer.type !== "tilelayer" || !layer.visible) continue;

        // 렌더링 범위의 타일 순회 (버퍼 포함, 맵 중앙 기준 좌표계)
        for (let centerTileY = renderStartY; centerTileY < renderEndY; centerTileY++) {
          for (let centerTileX = renderStartX; centerTileX < renderEndX; centerTileX++) {
            // 타일 배열 인덱싱을 위해 맵 좌표계로 변환 (여기서만 변환!)
            const mapTileX = centerTileX + mapCenterX;
            const mapTileY = centerTileY + mapCenterY;

            // 맵 범위 체크
            if (mapTileX < 0 || mapTileX >= width || mapTileY < 0 || mapTileY >= height) {
              continue;
            }

            // 타일 인덱스 계산 (맵 좌표계 사용)
            const tileIndex = mapTileY * width + mapTileX;
            const rawGid = layer.data[tileIndex];

            if (rawGid === 0) continue;

            // flip 플래그 제거하여 실제 gid 추출
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

            if (ts.tilewidth <= 0 || ts.tileheight <= 0) {
              console.warn(`Invalid tile size for tileset (firstgid: ${ts.firstgid}):`, {
                tilewidth: ts.tilewidth,
                tileheight: ts.tileheight
              });
              continue;
            }

            const screenTileX = centerTileX - cameraTilePositionX;
            const screenTileY = centerTileY - cameraTilePositionY;
            const dx = screenTileX * TILE_SIZE - TILE_SIZE / 4;
            const dy = screenTileY * TILE_SIZE - TILE_SIZE / 4;

            // Flip tile
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

              ctx.drawImage(
                ts.image,
                sx,
                sy,
                sw,
                sh,
                -TILE_SIZE / 2,
                -TILE_SIZE / 2,
                TILE_SIZE,
                TILE_SIZE
              );

              ctx.restore();
            } else {
              ctx.drawImage(
                ts.image,
                sx,
                sy,
                sw,
                sh,
                dx,
                dy,
                TILE_SIZE,
                TILE_SIZE
              );
            }
          }
        }
      }

      setIsLoaded(true);
    }

    drawMap();
  }, [mapData, tilesets, worldPosition, canvasSize, setIsLoaded, effectiveTileSize]);

  
  return { canvasRef, isLoaded, cameraTilePosition, mapStartPosition, mapEndPosition };
}
