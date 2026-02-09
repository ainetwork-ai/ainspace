import { XMLParser } from 'fast-xml-parser';
import { TiledMap, Tileset } from '@/stores/useMapStore';

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
});

// Tiled flip flags
const FLIPPED_HORIZONTALLY_FLAG = 0x80000000;
const FLIPPED_VERTICALLY_FLAG = 0x40000000;
const FLIPPED_DIAGONALLY_FLAG = 0x20000000;
const FLIP_MASK = ~(FLIPPED_HORIZONTALLY_FLAG | FLIPPED_VERTICALLY_FLAG | FLIPPED_DIAGONALLY_FLAG);

export function getActualGid(gid: number): number {
  return (gid & FLIP_MASK) >>> 0;
}

export { FLIPPED_HORIZONTALLY_FLAG, FLIPPED_VERTICALLY_FLAG, FLIPPED_DIAGONALLY_FLAG };

export interface LoadedVillageMap {
  mapData: TiledMap;
  tilesets: Tileset[];
  collisionTiles: Set<string>; // "localX,localY" 형태
}

/**
 * TMJ URL과 타일셋 베이스 URL로 마을 맵을 로드한다.
 * 기존 useTiledMap.ts의 loadMap() 로직을 추출한 것.
 *
 * @param tmjUrl - TMJ 파일의 URL (GCS 또는 로컬)
 * @param tilesetBaseUrl - 타일셋 파일들의 베이스 URL
 * @returns 파싱된 맵 데이터, 로드된 타일셋, 충돌 타일 좌표(로컬)
 */
export async function loadVillageMap(
  tmjUrl: string,
  tilesetBaseUrl: string,
): Promise<LoadedVillageMap> {
  // 1. 맵 JSON 로드
  // NOTE(yoojin): tmp: noCache=true 쿼리 파라미터를 추가하여 캐시를 무시하고 새로 로드한다. (TODO: 나중에 제거)
  const mapRes = await fetch(tmjUrl);
  const mapData = await mapRes.json();

  // 2. 타일셋 로드 (병렬)
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    ignoreDeclaration: true,
  });

  const tilesets: Tileset[] = await Promise.all(
    mapData.tilesets.map(async (ts: TMJParsedTileset) => {
      try {
        if ('source' in ts) {
          // TSX 파일 참조 형태
          const tsxPath = `${tilesetBaseUrl}/${ts.source}?noCache=false`;
          const tsxText = await (await fetch(tsxPath)).text();
          const tileset = parser.parse(tsxText).tileset;

          const imagePath = `${tilesetBaseUrl}/${tileset.image.source.replace('./', '') + '?noCache=false'}`;
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

        // 인라인 타일셋 형태
        const imagePath = `${tilesetBaseUrl}/${ts.image.replace('./', '') + '?noCache=false'}`;
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
    }),
  );

  // 3. Layer1로 시작하는 레이어에서 충돌 타일 좌표 수집 (로컬 좌표)
  const collisionTiles = new Set<string>();
  const { width, height } = mapData;

  for (const layer of mapData.layers) {
    if (layer.type === 'tilelayer' && layer.name.toLowerCase().startsWith('layer1')) {
      for (let localY = 0; localY < height; localY++) {
        for (let localX = 0; localX < width; localX++) {
          const tileIndex = localY * width + localX;
          const rawGid = layer.data[tileIndex];
          const gid = getActualGid(rawGid);
          if (gid !== 0) {
            collisionTiles.add(`${localX},${localY}`);
          }
        }
      }
    }
  }

  return {
    mapData: { ...mapData, tilesets },
    tilesets: tilesets.filter(Boolean),
    collisionTiles,
  };
}
