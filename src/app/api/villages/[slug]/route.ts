import { NextRequest, NextResponse } from 'next/server';
import { getVillage, updateVillage, deleteVillage } from '@/lib/village-redis';
import { deleteVillageFiles } from '@/lib/gcs';

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
 * 마을 메타데이터 업데이트
 * Body (JSON): { name?, tmjUrl?, tilesetBaseUrl? }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await request.json();

    const updated = await updateVillage(slug, {
      name: body.name,
      tmjUrl: body.tmjUrl,
      tilesetBaseUrl: body.tilesetBaseUrl,
    });

    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Village not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, village: updated });
  } catch (error) {
    console.error('Error in PUT /api/villages/[slug]:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update village' },
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
