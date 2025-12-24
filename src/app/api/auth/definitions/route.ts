import { NextRequest, NextResponse } from 'next/server';
import {
  saveAuthDefinition,
  getAllAuthDefinitions,
} from '@/lib/auth';
import { AuthDefinition } from '@/types/auth';

/**
 * GET /api/auth/definitions
 * 전체 Auth Definition 조회
 */
export async function GET() {
  try {
    const allDefinitions = await getAllAuthDefinitions();

    return NextResponse.json({
      success: true,
      data: allDefinitions,
    });
  } catch (error) {
    console.error('Failed to get auth definitions:', error);
    return NextResponse.json(
      { error: 'Failed to get auth definitions' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth/definitions
 * Auth Definition 생성
 */
export async function POST(request: NextRequest) {
  try {
    // TODO(yoojin): admin 권한 체크 필요
    const body = await request.json();
    const authDefinition: AuthDefinition = body;

    if (!authDefinition.name) {
      return NextResponse.json(
        { error: 'Auth name is required' },
        { status: 400 }
      );
    }

    await saveAuthDefinition(authDefinition);

    return NextResponse.json({
      success: true,
      data: authDefinition,
    });
  } catch (error) {
    console.error('Failed to save auth definition:', error);
    return NextResponse.json(
      { error: 'Failed to save auth definition' },
      { status: 500 }
    );
  }
}
