import { NextRequest } from 'next/server';
import { getAindriveConnectUrl, getAindriveUrl } from '@/lib/ain-integration/config';
import { sharedFilesDeps as deps } from '@/lib/ain-integration/deps';
import { failureResponse, guardAinRoute, okResponse } from '@/lib/ain-integration/route';
import { AIN_CONTRACT_VERSION, AinContractError } from '@/lib/ain-integration/types';

export const runtime = 'nodejs';

/** 드라이브 안 경로의 뿌리(주소 이동 대체값이 아니다). */
const DRIVE_ROOT_PATH = '/';

/**
 * GET /api/ain/shared-files/folder?folder=<fileKey>&path=<경로>
 *
 * 공유 파일 선택기의 "폴더 열기" — 공유 목록의 공유 뿌리(내 드라이브 루트 포함) 아래 폴더 하나의 직계 항목을
 * 계약 목록 모양(+ `folder`)으로 준다. 앱 세션으로 보호, 사용자의 aindrive 계정 토큰으로 원본이 권한을 다시 판단한다.
 * 토큰이 없으면 `auth_required` + actionUrl. 플래그 off 면 404. 원본 호출은 `sharedFilesDeps`(테스트 주입 지점).
 */
export async function GET(request: NextRequest) {
  const guard = await guardAinRoute(request);
  if (!('userId' in guard)) return guard;
  try {
    const folder = request.nextUrl.searchParams.get('folder');
    if (!folder) throw new AinContractError('unsupported_input', 'folder 가 필요합니다.');
    const token = await deps.getAindriveAccountToken(guard.userId);
    const out = await deps.listFolderItems(
      { aindriveUrl: getAindriveUrl(), token, connectUrl: getAindriveConnectUrl(request.nextUrl.origin) },
      folder,
      request.nextUrl.searchParams.get('path') ?? DRIVE_ROOT_PATH,
    );
    return okResponse({ contract: AIN_CONTRACT_VERSION, asOf: new Date().toISOString(), nextCursor: null, folder: out.folder, items: out.items });
  } catch (e) {
    return failureResponse(e);
  }
}
