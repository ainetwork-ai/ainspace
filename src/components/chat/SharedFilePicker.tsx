'use client';

import { useCallback, useState } from 'react';
import { FolderOpen, FileText, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isAinIntegrationEnabledClient } from '@/lib/ain-integration/config';
import { fileLinkMarkdown } from '@/lib/ain-integration/link-part';
import { fileKey, type FileListItem, type FileListScope, type FileRef } from '@/lib/ain-integration/types';

/**
 * "공유 파일" — 채팅 입력 옆 파일 진입점 (어댑터 사양 §제품에 넣을 것 3).
 * `/api/ain/shared-files` 목록에서 고르면 링크 파트(markdown)를 입력에 넣는다. 업로드 없음.
 * 플래그 off 면 아무것도 렌더링하지 않는다.
 */

export interface SharedFilePick { markdown: string; ref: FileRef }

type Fetcher = (input: string) => Promise<Response>;
const defaultFetcher: Fetcher = (input) => import('@/lib/backend/bff-fetch').then((m) => m.bffAuthFetch(input));

interface SharedFilePickerProps {
  onPick: (pick: SharedFilePick) => void;
  disabled?: boolean;
  enabled?: boolean;
  scope?: FileListScope;
  fetcher?: Fetcher;
}

interface ListError { message: string; actionUrl?: string }

export default function SharedFilePicker({
  onPick,
  disabled = false,
  enabled = isAinIntegrationEnabledClient(),
  scope = 'shared_with_me',
  fetcher = defaultFetcher,
}: SharedFilePickerProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<FileListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ListError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetcher(`/api/ain/shared-files?scope=${encodeURIComponent(scope)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const e = body?.error as { message?: string; actionUrl?: string } | undefined;
        setError({ message: e?.message ?? `공유 파일 목록을 불러오지 못했습니다 (${res.status})`, actionUrl: e?.actionUrl });
        setItems([]);
        return;
      }
      setItems(Array.isArray(body?.items) ? (body.items as FileListItem[]) : []);
    } catch {
      setError({ message: '공유 파일 목록을 불러오지 못했습니다.' });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [fetcher, scope]);

  if (!enabled) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && items === null) void load();
  };

  const pick = (ref: FileRef) => {
    const markdown = fileLinkMarkdown(ref);
    if (!markdown) return;
    onPick({ markdown, ref });
    setOpen(false);
  };

  return (
    <div className="relative" data-testid="shared-file-picker">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label="공유 파일"
        title="공유 파일"
        className="flex items-center gap-1 rounded-full bg-black/30 p-2 text-white disabled:opacity-60"
      >
        <Paperclip className="h-4 w-4" />
        <span className="sr-only">공유 파일</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 flex w-72 max-w-[80vw] flex-col gap-1 rounded-lg border border-[#4A4E56] bg-[#222529] p-2 text-white shadow-lg">
          <div className="flex items-center justify-between text-xs text-[#CAD0D7]">
            <span>공유 파일</span>
            <button type="button" onClick={() => void load()} disabled={loading} className="underline disabled:opacity-60">
              {loading ? '불러오는 중…' : '새로고침'}
            </button>
          </div>

          {error && (
            <p className="text-xs text-[#FFB020]">
              {error.message}
              {error.actionUrl && (
                <> <a href={error.actionUrl} target="_blank" rel="noreferrer" className="underline">aindrive 연결</a></>
              )}
            </p>
          )}

          {!error && items && items.length === 0 && !loading && (
            <p className="py-2 text-center text-xs text-[#CAD0D7]">공유된 파일이 없습니다.</p>
          )}

          <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {(items ?? []).map(({ ref }) => {
              const offline = ref.availability.state === 'offline';
              const gone = ref.availability.state === 'deleted';
              const pickable = !!ref.sourceUrl && !gone && !disabled;
              return (
                <li key={fileKey(ref)}>
                  <button
                    type="button"
                    disabled={!pickable}
                    onClick={() => pick(ref)}
                    className={cn('flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-[#2F333B] disabled:cursor-not-allowed disabled:opacity-50', offline && 'opacity-70')}
                    title={ref.legacy?.path ?? ref.displayName}
                  >
                    {ref.kind === 'folder' ? <FolderOpen className="h-4 w-4 shrink-0" /> : <FileText className="h-4 w-4 shrink-0" />}
                    <span className="truncate">{ref.displayName}</span>
                    {(offline || gone) && <span className="ml-auto shrink-0 text-[10px] text-[#FFB020]">{gone ? '삭제됨' : '오프라인'}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
