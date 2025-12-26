import { NextRequest, NextResponse } from 'next/server';
import {
  getUserPermissions,
  deleteUserPermissions,
} from '@/lib/auth';

/**
 * GET /api/auth/permissions/[address]
 * 사용자 권한 조회
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    if (!address) {
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }

    const userPermissions = await getUserPermissions(address);

    if (!userPermissions) {
      return NextResponse.json({
        success: true,
        data: null,
        message: 'No permissions found for this user',
      });
    }

    return NextResponse.json({
      success: true,
      data: userPermissions,
    });
  } catch (error) {
    console.error('Failed to get user permissions:', error);
    return NextResponse.json(
      { error: 'Failed to get user permissions' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/auth/permissions/[address]
 * 사용자 권한 삭제
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    if (!address) {
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }

    await deleteUserPermissions(address);

    return NextResponse.json({
      success: true,
      message: `Permissions for address ${address} deleted successfully`,
    });
  } catch (error) {
    console.error('Failed to delete user permissions:', error);
    return NextResponse.json(
      { error: 'Failed to delete user permissions' },
      { status: 500 }
    );
  }
}
