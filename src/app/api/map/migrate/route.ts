import { NextRequest, NextResponse } from 'next/server';
import { setMapTilesBulk, setMapTilesets, getMapTileCount, MapTilesetInfo } from '@/lib/redis';
import fs from 'fs';
import path from 'path';

/**
 * POST /api/map/migrate
 * tmj 파일을 DB로 마이그레이션
 */
export async function POST(request: NextRequest) {
  try {
    // tmj 파일 읽기
    const tmjPath = path.join(process.cwd(), 'public/map/map.tmj');
    const tmjData = JSON.parse(fs.readFileSync(tmjPath, 'utf8'));

    const { width, height, layers, tilesets } = tmjData;

    console.log(`Migrating map: ${width}x${height}, ${layers.length} layers, ${tilesets.length} tilesets`);

    // 타일셋 정보 저장
    const tilesetInfos: MapTilesetInfo[] = tilesets.map((ts: {
      firstgid: number;
      source?: string;
      image?: string;
      columns?: number;
      tilecount?: number;
      tilewidth?: number;
      tileheight?: number;
    }) => ({
      firstgid: ts.firstgid,
      source: ts.source,
      image: ts.image,
      columns: ts.columns || 1,
      tilecount: ts.tilecount || 1,
      tilewidth: ts.tilewidth || 40,
      tileheight: ts.tileheight || 40,
    }));

    await setMapTilesets(tilesetInfos);

    // 맵 중앙을 (0, 0)으로 설정
    const mapCenterX = Math.floor(width / 2);
    const mapCenterY = Math.floor(height / 2);

    // 레이어별로 타일 데이터 변환
    const layerTiles: { [key: string]: { [coord: string]: number } } = {
      layer0: {},
      layer1: {},
      layer2: {}
    };

    for (const layer of layers) {
      if (layer.type !== 'tilelayer' || !layer.data) continue;

      // 레이어 이름에서 레이어 번호 추출 (Layer0_x, Layer1_x, Layer2_x)
      let layerNum = 0;
      if (layer.name.startsWith('Layer1')) layerNum = 1;
      else if (layer.name.startsWith('Layer2')) layerNum = 2;
      else if (layer.name.startsWith('Layer0')) layerNum = 0;

      const layerKey = `layer${layerNum}`;

      // 레이어 자체의 width/height 사용
      const layerWidth = layer.width || width;
      const layerHeight = layer.height || height;

      console.log(`Processing ${layer.name}: ${layerWidth}x${layerHeight}`);

      // 타일 데이터 변환
      for (let mapY = 0; mapY < layerHeight; mapY++) {
        for (let mapX = 0; mapX < layerWidth; mapX++) {
          const tileIndex = mapY * layerWidth + mapX;
          const tileId = layer.data[tileIndex];

          // 0이 아닌 타일만 저장 (나중 레이어가 이전 레이어 위에 덮어씀)
          if (tileId !== 0) {
            // 월드 좌표로 변환 (맵 중앙이 0,0)
            const worldX = mapX - mapCenterX;
            const worldY = mapY - mapCenterY;
            const key = `${worldX},${worldY}`;

            // 나중 레이어의 0이 아닌 타일이 이전 타일을 덮어씀
            layerTiles[layerKey][key] = tileId;
          }
        }
      }
    }

    // DB에 저장
    await Promise.all([
      setMapTilesBulk(0, layerTiles.layer0),
      setMapTilesBulk(1, layerTiles.layer1),
      setMapTilesBulk(2, layerTiles.layer2),
    ]);

    const counts = await getMapTileCount();

    return NextResponse.json({
      success: true,
      message: 'Map migration completed',
      originalSize: { width, height },
      center: { x: mapCenterX, y: mapCenterY },
      tileCounts: counts,
      tilesetCount: tilesetInfos.length
    });
  } catch (error) {
    console.error('Error migrating map:', error);
    return NextResponse.json(
      { error: 'Failed to migrate map', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/map/migrate
 * 마이그레이션 상태 확인
 */
export async function GET() {
  try {
    const counts = await getMapTileCount();
    const total = counts.layer0 + counts.layer1 + counts.layer2;

    return NextResponse.json({
      migrated: total > 0,
      tileCounts: counts,
      total
    });
  } catch (error) {
    console.error('Error checking migration status:', error);
    return NextResponse.json(
      { error: 'Failed to check migration status' },
      { status: 500 }
    );
  }
}
