import { NextRequest, NextResponse } from 'next/server';
import {
  saveVillage,
  getAllVillages,
  getVillageByGrid,
  getNearbyVillages,
  VillageMetadata,
} from '@/lib/village-redis';
import { uploadVillageTmj, uploadVillageTileset, uploadVillageTsx, getRootTilesetBaseUrl } from '@/lib/gcs';
import { getFirebaseStorage } from '@/lib/firebase';
import { rewriteTmjTilesetPaths } from '@/lib/tmj-rewriter';

/**
 * GET /api/villages
 *   - ?nearby=gridX,gridY → 인접 9칸 마을 목록
 *   - ?gridX=0&gridY=0 → 특정 격자 위치 마을
 *   - (없으면) → 전체 마을 목록
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // 인접 마을 조회
    const nearby = searchParams.get('nearby');
    if (nearby) {
      const [gxStr, gyStr] = nearby.split(',');
      const gridX = parseInt(gxStr);
      const gridY = parseInt(gyStr);
      if (isNaN(gridX) || isNaN(gridY)) {
        return NextResponse.json(
          { success: false, error: 'Invalid nearby format. Use: nearby=gridX,gridY' },
          { status: 400 },
        );
      }
      const villages = await getNearbyVillages(gridX, gridY);
      return NextResponse.json({ success: true, villages });
    }

    // 격자 좌표로 단일 마을 조회
    const gridXStr = searchParams.get('gridX');
    const gridYStr = searchParams.get('gridY');
    if (gridXStr !== null && gridYStr !== null) {
      const gridX = parseInt(gridXStr);
      const gridY = parseInt(gridYStr);
      if (isNaN(gridX) || isNaN(gridY)) {
        return NextResponse.json(
          { success: false, error: 'Invalid grid coordinates' },
          { status: 400 },
        );
      }
      const village = await getVillageByGrid(gridX, gridY);
      return NextResponse.json({ success: true, village });
    }

    // 전체 마을 목록
    const villages = await getAllVillages();
    return NextResponse.json({ success: true, villages });
  } catch (error) {
    console.error('Error in GET /api/villages:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch villages' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/villages
 * Body (FormData):
 *   - slug: string (URL-friendly unique ID)
 *   - name: string (표시 이름)
 *   - gridX: number
 *   - gridY: number
 *   - tmj: File (map.tmj 파일)
 *   - tilesets: File[] (타일셋 이미지 + TSX 파일들)
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const slug = formData.get('slug') as string;
    const name = formData.get('name') as string;
    const gridXStr = formData.get('gridX') as string;
    const gridYStr = formData.get('gridY') as string;
    const tmjFile = formData.get('tmj') as File | null;

    if (!slug || !name || !gridXStr || !gridYStr) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: slug, name, gridX, gridY' },
        { status: 400 },
      );
    }

    // slug 형식 검증 (URL-friendly: lowercase, hyphens, numbers)
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json(
        { success: false, error: 'Slug must contain only lowercase letters, numbers, and hyphens' },
        { status: 400 },
      );
    }

    const gridX = parseInt(gridXStr);
    const gridY = parseInt(gridYStr);
    if (isNaN(gridX) || isNaN(gridY)) {
      return NextResponse.json(
        { success: false, error: 'Invalid grid coordinates' },
        { status: 400 },
      );
    }

    const gridWidthStr = formData.get('gridWidth') as string | null;
    const gridHeightStr = formData.get('gridHeight') as string | null;
    const gridWidth = gridWidthStr ? parseInt(gridWidthStr) : 1;
    const gridHeight = gridHeightStr ? parseInt(gridHeightStr) : 1;
    if (gridWidth < 1 || gridHeight < 1) {
      return NextResponse.json(
        { success: false, error: 'gridWidth and gridHeight must be >= 1' },
        { status: 400 },
      );
    }

    let tmjUrl = '';
    let tilesetBaseUrl = '';

    // 타일셋 파일들 업로드 (병렬)
    const tilesetFiles = formData.getAll('tilesets') as File[];
    const uploadedFileNames = tilesetFiles.map(f => f.name);

    await Promise.all(
      tilesetFiles.map(async (file) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        if (file.name.endsWith('.tsx')) {
          await uploadVillageTsx(slug, buffer, file.name);
        } else {
          await uploadVillageTileset(slug, buffer, file.name);
        }
      }),
    );

    // TMJ 파일 업로드 (리라이트 적용)
    if (tmjFile) {
      const tmjText = await tmjFile.text();
      const tmjJson = JSON.parse(tmjText);
      const rewrittenTmj = await rewriteTmjTilesetPaths(tmjJson, uploadedFileNames, slug);
      const tmjBuffer = Buffer.from(rewrittenTmj);
      tmjUrl = await uploadVillageTmj(slug, tmjBuffer);
    }

    if (tilesetFiles.length > 0 || tmjFile) {
      const storage = getFirebaseStorage();
      const bucketName = storage.bucket().name;
      tilesetBaseUrl = getRootTilesetBaseUrl(bucketName);
    }

    const now = Date.now();
    const village: VillageMetadata = {
      slug,
      name,
      gridX,
      gridY,
      gridWidth,
      gridHeight,
      tmjUrl,
      tilesetBaseUrl,
      createdAt: now,
      updatedAt: now,
    };

    await saveVillage(village);

    return NextResponse.json({ success: true, village }, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/villages:', error);
    const message = error instanceof Error ? error.message : 'Failed to create village';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
