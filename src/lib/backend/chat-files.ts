import { ChatMessageFile } from '@/stores/useChatStore';

/**
 * EPIC22: Normalize a raw `files` payload (from SSE or history) into the
 * `ChatMessageFile[]` shape consumed by ChatMessage. Returns `undefined`
 * when nothing usable is found so callers can omit the field cleanly.
 *
 * Accepts `unknown` because the upstream shape varies (SSE vs. history
 * responses); we defensively filter to items that carry at least a `fileUrl`.
 */
export function toChatMessageFiles(
  raw: unknown
): ChatMessageFile[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const mapped: ChatMessageFile[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).fileUrl === 'string') {
      const r = item as Record<string, unknown>;
      mapped.push({
        fileUrl: r.fileUrl as string,
        mimeType: typeof r.mimeType === 'string' ? r.mimeType : (r.mimeType ?? null) as string | null,
        fileName: typeof r.fileName === 'string' ? r.fileName : (r.fileName ?? null) as string | null,
        width: typeof r.width === 'number' ? r.width : null,
        height: typeof r.height === 'number' ? r.height : null,
      });
    }
  }

  return mapped.length > 0 ? mapped : undefined;
}
