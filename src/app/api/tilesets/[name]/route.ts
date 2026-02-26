import { NextRequest, NextResponse } from 'next/server';
import { listSharedTilesets, deleteSharedTilesetFiles } from '@/lib/gcs';

/**
 * DELETE /api/tilesets/[name] — 공유 타일셋 삭제
 * 해당 name과 관련된 파일 전체 삭제 (TSX + 이미지)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Missing tileset name' },
        { status: 400 },
      );
    }

    // GCS에서 공유 타일셋 파일 목록 조회
    const allFiles = await listSharedTilesets();

    // name과 관련된 파일 필터링 (baseName이 일치하는 파일)
    const targetFiles = allFiles.filter(file => {
      const baseName = file.fileName.replace(/\.[^.]+$/, '');
      return baseName === name;
    });

    if (targetFiles.length === 0) {
      return NextResponse.json(
        { success: false, error: `No files found for tileset: ${name}` },
        { status: 404 },
      );
    }

    const fileNames = targetFiles.map(f => f.fileName);
    await deleteSharedTilesetFiles(fileNames);

    return NextResponse.json({
      success: true,
      deletedFiles: fileNames.length,
    });
  } catch (error) {
    console.error('Error in DELETE /api/tilesets/[name]:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete shared tileset';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
