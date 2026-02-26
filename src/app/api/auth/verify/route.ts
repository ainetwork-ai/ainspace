import { NextRequest, NextResponse } from 'next/server';
import {
  getAllAuthDefinitions,
  saveUserAuths,
  getUserPermissions,
} from '@/lib/auth';
import { checkIsHolder, CheckIsHolderResponse } from '@/lib/holder-checker/api';

/**
 * POST /api/auth/verify
 * 사용자 로그인 시 토큰 보유 여부 확인 후 권한 자동 등록
 *
 * Request body:
 * {
 *   userId: string; // wallet address
 * }
 *
 * Response:
 * {
 *   success: true;
 *   data: {
 *     grantedAuths: string[]; // 부여된 auth 목록
 *     permissions: UserPermissions; // 최종 권한
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // 0. Admin 사용자는 토큰 검증 스킵
    const existingPermissions = await getUserPermissions(userId);
    if (existingPermissions?.permissions?.adminAccess === true) {
      return NextResponse.json({
        success: true,
        data: {
          grantedAuths: existingPermissions.auths,
          permissions: existingPermissions,
        },
      });
    }

    // 1. 모든 Auth Definition 가져오기
    const allAuthDefinitions = await getAllAuthDefinitions();

    if (allAuthDefinitions.length === 0) {
      // Auth Definition이 없으면 빈 권한으로 등록
      await saveUserAuths(userId, []);
      const userPermissions = await getUserPermissions(userId);

      return NextResponse.json({
        success: true,
        data: {
          grantedAuths: [],
          permissions: userPermissions,
        },
      });
    }

    // 2. 모든 토큰 요구사항 수집
    const allTokenRequirements = allAuthDefinitions.flatMap(
      (auth) => auth.tokenRequirements
    );

    // 중복 제거 (같은 컨트랙트 주소)
    const uniqueContracts = Array.from(
      new Map(
        allTokenRequirements.map((contract) => [contract.address, contract])
      ).values()
    );

    // 3. Holder Checker로 토큰 보유 여부 확인
    let holderCheckResults: CheckIsHolderResponse[] = [];

    if (uniqueContracts.length > 0) {
      try {
        console.log('Checking holder for user:', userId, uniqueContracts.map((contract) => contract.address));
        const response = await checkIsHolder(userId as `0x${string}`, uniqueContracts);
        holderCheckResults = response.results || [];
        console.log('Holder check results:', holderCheckResults.map((result) => result.contractAddress));
      } catch (error) {
        console.error('Holder check failed:', error);
        // Holder check 실패 시 빈 배열로 처리
        holderCheckResults = [];
      }
    }

    // 4. 보유한 토큰들의 set 생성
    const ownedTokenAddresses = new Set(
      holderCheckResults
        .filter((result) => result.isHolder)
        .map((result) => result.contractAddress.toLowerCase())
    );

    // 5. 각 Auth의 토큰 요구사항 중 하나라도 만족하는지 확인
    const grantedAuths = allAuthDefinitions
      .filter((auth) => {
        // 토큰 요구사항이 없으면 부여하지 않음
        if (!auth.tokenRequirements || auth.tokenRequirements.length === 0) {
          return false;
        }

        // 하나 이상의 토큰 요구사항을 만족하면 부여 (OR 조건)
        return auth.tokenRequirements.some((requirement) =>
          ownedTokenAddresses.has(requirement.address.toLowerCase())
        );
      })
      .map((auth) => auth.name);

    // 6. 사용자 권한 저장
    await saveUserAuths(userId, grantedAuths);

    // 7. 최종 권한 조회
    const userPermissions = await getUserPermissions(userId);

    return NextResponse.json({
      success: true,
      data: {
        grantedAuths,
        permissions: userPermissions,
      },
    });
  } catch (error) {
    console.error('Failed to verify and grant auth:', error);
    return NextResponse.json(
      { error: 'Failed to verify and grant auth' },
      { status: 500 }
    );
  }
}
