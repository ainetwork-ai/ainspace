import { NextRequest, NextResponse } from 'next/server';
import { getMapTilesInRange, setMapTile, getMapTilesets, saveCustomTileImages, setMapTilesBulk, getAllCustomTileImages } from '@/lib/redis';

/**
 * GET /api/map/tiles?startX=&startY=&endX=&endY=
 * 범위 내 맵 타일 조회 (커스텀 타일 이미지 포함)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startX = parseInt(searchParams.get('startX') || '-50', 10);
    const startY = parseInt(searchParams.get('startY') || '-50', 10);
    const endX = parseInt(searchParams.get('endX') || '50', 10);
    const endY = parseInt(searchParams.get('endY') || '50', 10);

    const [tiles, tilesets, customTileImages] = await Promise.all([
      getMapTilesInRange(startX, startY, endX, endY),
      getMapTilesets(),
      getAllCustomTileImages()
    ]);

    return NextResponse.json({
      success: true,
      tiles,
      tilesets,
      customTileImages,  // tileId -> base64 이미지 매핑
      range: { startX, startY, endX, endY }
    });
  } catch (error) {
    console.error('Error getting map tiles:', error);
    return NextResponse.json(
      { error: 'Failed to get map tiles' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/map/tiles
 * 맵 타일 설정
 * body: { layer: 0|1|2, x: number, y: number, tileId: number }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { layer, x, y, tileId } = body;

    if (layer === undefined || x === undefined || y === undefined || tileId === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: layer, x, y, tileId' },
        { status: 400 }
      );
    }

    if (![0, 1, 2].includes(layer)) {
      return NextResponse.json(
        { error: 'Invalid layer. Must be 0, 1, or 2' },
        { status: 400 }
      );
    }

    await setMapTile(layer as 0 | 1 | 2, x, y, tileId);

    return NextResponse.json({
      success: true,
      message: `Tile set at (${x}, ${y}) on layer ${layer}`
    });
  } catch (error) {
    console.error('Error setting map tile:', error);
    return NextResponse.json(
      { error: 'Failed to set map tile' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/map/tiles
 * 커스텀 타일 이미지 저장 및 맵에 배치 (bulk)
 * body: {
 *   layer: 0|1|2,
 *   tiles: Array<{ x: number, y: number, imageData: string }>
 * }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { layer, tiles } = body;

    if (layer === undefined || !tiles || !Array.isArray(tiles)) {
      return NextResponse.json(
        { error: 'Missing required fields: layer, tiles' },
        { status: 400 }
      );
    }

    if (![0, 1, 2].includes(layer)) {
      return NextResponse.json(
        { error: 'Invalid layer. Must be 0, 1, or 2' },
        { status: 400 }
      );
    }

    // 1. 이미지 데이터 추출하여 저장하고 tileId 배열 받기
    const imageDataList = tiles.map((t: { imageData: string }) => t.imageData);
    const tileIds = await saveCustomTileImages(imageDataList);

    // 2. 각 위치에 tileId 매핑
    const tilePositions: { [key: string]: number } = {};
    tiles.forEach((t: { x: number; y: number }, index: number) => {
      const key = `${t.x},${t.y}`;
      tilePositions[key] = tileIds[index];
    });

    // 3. 맵에 타일 배치
    await setMapTilesBulk(layer as 0 | 1 | 2, tilePositions);

    return NextResponse.json({
      success: true,
      message: `Saved ${tiles.length} custom tiles on layer ${layer}`,
      tileIds
    });
  } catch (error) {
    console.error('Error saving custom tiles:', error);
    return NextResponse.json(
      { error: 'Failed to save custom tiles' },
      { status: 500 }
    );
  }
}
