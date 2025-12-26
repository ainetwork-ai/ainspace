import { NextRequest, NextResponse } from 'next/server';
import { initializeDefaultAuths } from '@/lib/auth/defaultAuths';

/**
 * POST /api/auth/init
 * Default Auth Definitions 초기화
 *
 * 주의: 이 API는 개발/관리 목적으로만 사용해야 합니다.
 * Production 환경에서는 적절한 인증을 추가하거나 제거해야 합니다.
 */
export async function POST(request: NextRequest) {
  try {
    // TODO(yoojin): Production에서는 admin 권한 체크 필요
    // 또는 환경 변수로 제한
    if (process.env.NODE_ENV === 'production') {
      // Production에서는 특정 secret key 확인
      const { secretKey } = await request.json();

      if (secretKey !== process.env.INIT_AUTH_SECRET) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
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
