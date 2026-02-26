import { NextRequest, NextResponse } from 'next/server';
import { uploadSharedTileset, listSharedTilesets } from '@/lib/gcs';

/**
 * POST /api/tilesets — 공유 타일셋 업로드
 * Body (FormData):
 *   - name: string (타일셋 식별자)
 *   - files: File[] (TSX + 이미지 파일들)
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const name = formData.get('name') as string;
    const files = formData.getAll('files') as File[];

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: name' },
        { status: 400 },
      );
    }

    // name 형식 검증
    if (!/^[a-zA-Z0-9 _-]+$/.test(name)) {
      return NextResponse.json(
        { success: false, error: 'Name must contain only letters, numbers, spaces, underscores, and hyphens' },
        { status: 400 },
      );
    }

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one file is required' },
        { status: 400 },
      );
    }

    const uploadedFiles: { fileName: string; url: string }[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const url = await uploadSharedTileset(buffer, file.name);
      uploadedFiles.push({ fileName: file.name, url });
    }

    return NextResponse.json(
      { success: true, files: uploadedFiles },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error in POST /api/tilesets:', error);
    const message = error instanceof Error ? error.message : 'Failed to upload shared tileset';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

/**
 * GET /api/tilesets — 공유 타일셋 목록 조회
 * TSX 파일 기준으로 그룹핑하여 반환
 */
export async function GET() {
  try {
    const files = await listSharedTilesets();

    // TSX 파일 기준으로 그룹핑
    const tilesetMap = new Map<string, { fileName: string; url: string }[]>();

    for (const file of files) {
      const { fileName } = file;
      // TSX 파일명에서 확장자를 제거한 것을 기준으로 그룹핑
      const baseName = fileName.endsWith('.tsx')
        ? fileName.replace(/\.tsx$/, '')
        : fileName.replace(/\.[^.]+$/, '');

      if (!tilesetMap.has(baseName)) {
        tilesetMap.set(baseName, []);
      }
      tilesetMap.get(baseName)!.push({
        fileName,
        url: file.url,
      });
    }

    const tilesets = Array.from(tilesetMap.entries()).map(([name, groupFiles]) => ({
      name,
      files: groupFiles,
    }));

    return NextResponse.json({ success: true, tilesets });
  } catch (error) {
    console.error('Error in GET /api/tilesets:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list shared tilesets' },
      { status: 500 },
    );
  }
}
