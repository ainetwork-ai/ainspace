import { NextRequest } from 'next/server';
import { MAX_ATTACHMENT_BYTES } from '@/lib/ain-integration/chat-attachments';
import { getAindriveConnectUrl, getAindriveUrl } from '@/lib/ain-integration/config';
import { attachmentsDeps as deps } from '@/lib/ain-integration/deps';
import { readBodyCapped } from '@/lib/ain-integration/http';
import { errorResponse, failureResponse, guardAinRoute, okResponse } from '@/lib/ain-integration/route';
import { makeError, parseFileKey } from '@/lib/ain-integration/types';

export const runtime = 'nodejs';

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * POST /api/ain/attachments (multipart: file, folderKey?) → 200 { file: FileRef, markdown, reused }
 *
 * 17.7 채팅 첨부 이관: 새 첨부를 사용자의 aindrive 폴더에 쓴다(saveTo 와 같은 경로, 충돌 정책 rename). 채팅에는
 * 돌려준 `markdown` 링크 파트만 넣는다. 옛 첨부(backend `/api/files/:id`)는 바뀌지 않는다.
 * 앱 세션(검증된 backend JWT)으로 보호한다. aindrive 연결이 없으면 401 auth_required + 연결 시작 actionUrl.
 * 응답에 토큰 없음. 플래그 off 면 404.
 */
export async function POST(request: NextRequest) {
  const guard = await guardAinRoute(request);
  if (!('userId' in guard)) return guard;

  // 본문은 한도(파일 10MB + multipart 오버헤드 64KB)까지만 읽는다. Content-Length 가 없는 chunked 요청도 스트림을
  // 세면서 읽다가 넘는 순간 413 — 전부 버퍼링한 뒤에 크기를 보지 않는다.
  const raw = await readBodyCapped(request, MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES).catch(() => null);
  if (raw === 'too_large') return errorResponse(makeError('unsupported_input', `첨부는 ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB 이하여야 합니다.`), 413);

  let form: FormData;
  try {
    if (!raw) throw new Error('body');
    form = await new Response(raw, { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData();
  } catch { return errorResponse(makeError('unsupported_input', 'multipart/form-data 로 file 을 보내야 합니다.'), 400); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return errorResponse(makeError('unsupported_input', 'file 이 필요합니다.'), 400);
  const folderKeyRaw = form.get('folderKey');
  const folderKey = typeof folderKeyRaw === 'string' && folderKeyRaw ? folderKeyRaw : undefined;
  if (folderKey && (folderKey.length > 1024 || !parseFileKey(folderKey))) return errorResponse(makeError('unsupported_input', 'folderKey 는 `issuer#driveId#fileId` 문자열이어야 합니다.'), 400);
  if (file.size > MAX_ATTACHMENT_BYTES) return errorResponse(makeError('unsupported_input', `첨부는 ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB 이하여야 합니다.`), 413);

  try {
    const token = await deps.getAindriveAccountToken(guard.userId);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await deps.saveChatAttachment(
      { aindriveUrl: getAindriveUrl(), token, connectUrl: getAindriveConnectUrl(request.nextUrl.origin) },
      { folderKey, name: file.name || 'attachment', bytes, mimeType: file.type || undefined },
    );
    return okResponse(res);
  } catch (e) {
    return failureResponse(e);
  }
}
