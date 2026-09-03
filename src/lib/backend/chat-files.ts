import { ChatMessageFile } from '@/stores/useChatStore';

/**
 * EPIC22: Normalize a raw `files` payload (from SSE or history) into the
 * `ChatMessageFile[]` shape consumed by ChatMessage. Returns `undefined`
 * when nothing usable is found so callers can omit the field cleanly.
 *
 * Accepts `unknown` because the upstream shape varies (SSE vs. history
 * responses).
 *
 * ⚠️ **EPIC23 — 필터 기준이 `id` 다**(예전에는 `fileUrl`). 렌더에 필요한 값은 `fileUrl`
 * 이 아니라 `id` 이기 때문이다: `fileUrl` 은 backend 저장형(`s3://…`)이라 브라우저가
 * 열 수 없고, 실제 바이트는 `id` 로 서빙 라우트를 조립해야 받는다(`chatFileSrc`).
 *
 * `id` 없는 원소를 버려도 잔존 데이터 문제는 없다 — 채팅 스토어는 `persist` 가 없어
 * 메시지가 매번 SSE·히스토리에서 새로 온다.
 */
export function toChatMessageFiles(
  raw: unknown
): ChatMessageFile[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const mapped: ChatMessageFile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id === '') continue;
    mapped.push({
      id: r.id,
      fileUrl: typeof r.fileUrl === 'string' ? r.fileUrl : null,
      mimeType: typeof r.mimeType === 'string' ? r.mimeType : null,
      fileName: typeof r.fileName === 'string' ? r.fileName : null,
      width: typeof r.width === 'number' ? r.width : null,
      height: typeof r.height === 'number' ? r.height : null,
    });
  }

  return mapped.length > 0 ? mapped : undefined;
}

/**
 * 이 첨부를 화면에 그릴 때 쓸 URL — **URL 문법을 아는 단 한 곳** (EPIC23).
 *
 * 컴포넌트가 직접 조립하면 다음 사람이 `fileUrl` 을 다시 집어 넣는다(그게 이 EPIC 이
 * 고친 버그다). 그래서 렌더 쪽은 이 함수만 부른다.
 *
 * 왜 BFF 프록시를 거치는가 — 바이트는 backend 의 `GET /files/:id/stream` 에만 있고 그
 * 라우트는 Bearer 를 요구한다. `<img src>` 는 `Authorization` 헤더를 보낼 수 없으므로
 * 같은 오리진 프록시가 대신 붙여 준다. `?token=` 형태는 SSE 프록시
 * (`/api/thread-stream/:threadId`)가 같은 벽을 만나 쓴 방식과 동일하다.
 *
 * 토큰이 없으면 `null` — 호출부는 아무것도 렌더하지 않는다(깨진 이미지 아이콘보다 낫다).
 */
export function chatFileSrc(
  file: Pick<ChatMessageFile, 'id'>,
  accessToken: string | null
): string | null {
  if (!file.id || !accessToken) return null;
  return `/api/files/${encodeURIComponent(file.id)}?token=${encodeURIComponent(accessToken)}`;
}
