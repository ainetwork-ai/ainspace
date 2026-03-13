import { NextRequest, NextResponse } from 'next/server';
import { initializeDefaultAuths } from '@/lib/auth/defaultAuths';
import { hasAdminAccess } from '@/lib/auth/permissions';

/**
 * POST /api/auth/init
 * Default Auth Definitions 초기화
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json().catch(() => ({ userId: undefined }));

    const adminCheck = await hasAdminAccess(userId ?? '');
    if (!adminCheck.allowed) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    await initializeDefaultAuths();

    return NextResponse.json({
      success: true,
      message: 'Default auth definitions initialized successfully',
      data: {
        initializedAuths: [
          'ain_token_holder',
          'uncommon_member',
          'admin',
        ],
      },
    });
  } catch (error) {
    console.error('Failed to initialize default auth definitions:', error);
    return NextResponse.json(
      { error: 'Failed to initialize default auth definitions' },
      { status: 500 }
    );
  }
}
