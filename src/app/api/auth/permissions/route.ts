import { NextRequest, NextResponse } from 'next/server';
import {
  saveUserAuths,
  getUserPermissions,
} from '@/lib/auth';

/**
 * POST /api/auth/permissions
 * 사용자에게 auth 부여
 */
export async function POST(request: NextRequest) {
  try {
    // TODO(yoojin): admin 권한 체크 필요
    const body = await request.json();
    const { userId, auths } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    if (!Array.isArray(auths)) {
      return NextResponse.json(
        { error: 'Auths must be an array' },
        { status: 400 }
      );
    } 

    await saveUserAuths(userId, auths);

    const userPermissions = await getUserPermissions(userId);

    return NextResponse.json({
      success: true,
      data: userPermissions,
    });
  } catch (error) {
    console.error('Failed to save user auths:', error);
    return NextResponse.json(
      { error: 'Failed to save user auths' },
      { status: 500 }
    );
  }
}
