import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthDefinition,
  deleteAuthDefinition,
} from '@/lib/auth';

/**
 * GET /api/auth/definitions/[name]
 * 특정 Auth Definition 조회
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;

    if (!name) {
      return NextResponse.json(
        { error: 'Auth name is required' },
        { status: 400 }
      );
    }

    const authDefinition = await getAuthDefinition(name);

    if (!authDefinition) {
      return NextResponse.json(
        { error: 'Auth definition not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: authDefinition,
    });
  } catch (error) {
    console.error('Failed to get auth definition:', error);
    return NextResponse.json(
      { error: 'Failed to get auth definition' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/auth/definitions/[name]
 * Auth Definition 삭제
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    // TODO(yoojin): admin 권한 체크 필요
    const { name } = await params;

    if (!name) {
      return NextResponse.json(
        { error: 'Auth name is required' },
        { status: 400 }
      );
    }

    await deleteAuthDefinition(name);

    return NextResponse.json({
      success: true,
      message: `Auth definition ${name} deleted successfully`,
    });
  } catch (error) {
    console.error('Failed to delete auth definition:', error);
    return NextResponse.json(
      { error: 'Failed to delete auth definition' },
      { status: 500 }
    );
  }
}
