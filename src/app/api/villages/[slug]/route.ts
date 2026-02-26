import { NextRequest, NextResponse } from 'next/server';
import { getVillage, updateVillage, deleteVillage } from '@/lib/village-redis';
import {
  deleteVillageFiles,
  uploadVillageTmj,
  uploadVillageTileset,
  uploadVillageTsx,
  getRootTilesetBaseUrl,
} from '@/lib/gcs';
import { getFirebaseStorage } from '@/lib/firebase';
import { rewriteTmjTilesetPaths } from '@/lib/tmj-rewriter';

/**
 * GET /api/villages/[slug]
 * 단일 마을 메타데이터 조회
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const village = await getVillage(slug);

    if (!village) {
      return NextResponse.json(
        { success: false, error: 'Village not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, village });
  } catch (error) {
    console.error('Error in GET /api/villages/[slug]:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch village' },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/villages/[slug]
 * 마을 업데이트
 *
 * FormData 요청 시: TMJ + 타일셋 파일 업로드 (경로 리라이트 포함)
 *   - name?: string
 *   - tmj?: File (map.tmj 파일)
 *   - tilesets?: File[] (타일셋 이미지 + TSX 파일들)
 *
 * JSON 요청 시: 메타데이터만 업데이트
 *   - name?, tmjUrl?, tilesetBaseUrl?
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;

    const existing = await getVillage(slug);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Village not found' },
        { status: 404 },
      );
    }

    const contentType = request.headers.get('content-type') || '';

    // FormData 요청: TMJ + 타일셋 업로드
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const name = formData.get('name') as string | null;
      const tmjFile = formData.get('tmj') as File | null;
      const tilesetFiles = formData.getAll('tilesets') as File[];

      // 타일셋 파일들 업로드 (병렬)
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

      const updates: Parameters<typeof updateVillage>[1] = {};
      if (name) updates.name = name;

      // TMJ 파일 업로드 (리라이트 적용)
      if (tmjFile) {
        const tmjText = await tmjFile.text();
        const tmjJson = JSON.parse(tmjText);
        const rewrittenTmj = await rewriteTmjTilesetPaths(tmjJson, uploadedFileNames, slug);
        const tmjBuffer = Buffer.from(rewrittenTmj);
        updates.tmjUrl = await uploadVillageTmj(slug, tmjBuffer);
      }

      if (tilesetFiles.length > 0 || tmjFile) {
        const storage = getFirebaseStorage();
        const bucketName = storage.bucket().name;
        updates.tilesetBaseUrl = getRootTilesetBaseUrl(bucketName);
      }

      const updated = await updateVillage(slug, updates);
      return NextResponse.json({ success: true, village: updated });
    }

    // JSON 요청: 메타데이터만 업데이트
    const body = await request.json();
    const updated = await updateVillage(slug, {
      name: body.name,
      tmjUrl: body.tmjUrl,
      tilesetBaseUrl: body.tilesetBaseUrl,
    });

    return NextResponse.json({ success: true, village: updated });
  } catch (error) {
    console.error('Error in PUT /api/villages/[slug]:', error);
    const message = error instanceof Error ? error.message : 'Failed to update village';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/villages/[slug]
 * 마을 삭제 (Redis 메타데이터 + GCS 파일)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;

    // GCS 파일 삭제
    try {
      await deleteVillageFiles(slug);
    } catch (gcsError) {
      console.warn(`Failed to delete GCS files for village ${slug}:`, gcsError);
    }

    // Redis 메타데이터 삭제
    const deleted = await deleteVillage(slug);
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Village not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/villages/[slug]:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete village' },
      { status: 500 },
    );
  }
}
