'use client';

import { useCallback, useState } from 'react';
import { ChevronLeft, ChevronRight, FolderOpen, FileText, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isAinIntegrationEnabledClient } from '@/lib/ain-integration/config';
import { followActionUrl } from '@/lib/ain-integration/connect-client';
import { fileLinkMarkdown } from '@/lib/ain-integration/link-part';
import { fileKey, type FileListItem, type FileListScope, type FileRef } from '@/lib/ain-integration/types';
import { PICKER_SCOPES, back, canOpen, initialNav, openFolder, pickerListUrl, trailLabel, withScope, type PickerNav } from '@/lib/ain-integration/picker-nav';

/**
 * "공유 파일" — 채팅 입력 옆 파일 진입점 (어댑터 사양 §제품에 넣을 것 3).
 * `/api/ain/shared-files` 목록에서 고르면 링크 파트(markdown)를 입력에 넣는다. 업로드 없음.
 * 플래그 off 면 아무것도 렌더링하지 않는다.
 * 범위 탭(나에게 공유됨 · 내 파일)과 폴더 행의 "열기"(›)로 공유 뿌리 안의 파일까지 고른다(`picker-nav.ts`).
 */

export interface SharedFilePick { markdown: string; ref: FileRef }

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetcher: Fetcher = (input, init) => import('@/lib/backend/bff-fetch').then((m) => m.bffAuthFetch(input, init));

interface SharedFilePickerProps {
  onPick: (pick: SharedFilePick) => void;
  disabled?: boolean;
  enabled?: boolean;
  scope?: FileListScope;
  fetcher?: Fetcher;
  /** 목록을 여는 방향. 채팅 입력(화면 아래)은 위로, 마을 패널(화면 위)은 아래로. */
  placement?: 'up' | 'down';
}

interface ListError { message: string; actionUrl?: string }

export default function SharedFilePicker({
  onPick,
  disabled = false,
  enabled = isAinIntegrationEnabledClient(),
  scope = 'shared_with_me',
  fetcher = defaultFetcher,
  placement = 'up',
}: SharedFilePickerProps) {
  const [open, setOpen] = useState(false);
  const [nav, setNav] = useState<PickerNav>(() => initialNav(scope));
  const [items, setItems] = useState<FileListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ListError | null>(null);

  const load = useCallback(async (at: PickerNav = nav) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetcher(pickerListUrl(at));
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
  }, [fetcher, nav]);

  const go = (next: PickerNav) => { setNav(next); setItems(null); void load(next); };

  // actionUrl 이 이 제품의 연결 시작 라우트면 bearer 를 실어 불러 aindrive 로 이동하고, 아니면 새 탭으로 연다.
  const connect = useCallback(async (actionUrl: string) => {
    const message = await followActionUrl(actionUrl, {
      fetcher,
      navigate: (u) => window.location.assign(u),
      openTab: (u) => window.open(u, '_blank', 'noopener,noreferrer'),
      location: window.location,
    });
    if (message) setError({ message });
  }, [fetcher]);

  if (!enabled) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && items === null) void load();
    if (!next && nav.trail.length) { setNav(initialNav(nav.scope)); setItems(null); }
  };

  const pick = (ref: FileRef) => {
    const markdown = fileLinkMarkdown(ref);
    if (!markdown) return;
    onPick({ markdown, ref });
    setOpen(false);
    if (nav.trail.length) { setNav(initialNav(nav.scope)); setItems(null); }
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
        <div className={cn('absolute z-20 flex', placement === 'up' ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-2')} data-placement={placement}>
        <div className="flex w-72 max-w-[80vw] flex-col gap-1 rounded-lg border border-[#4A4E56] bg-[#222529] p-2 text-white shadow-lg">
          <div className="flex items-center justify-between text-xs text-[#CAD0D7]">
            <span>공유 파일</span>
            <button type="button" onClick={() => void load()} disabled={loading} className="underline disabled:opacity-60">
              {loading ? '불러오는 중…' : '새로고침'}
            </button>
          </div>

          <div className="flex gap-1" role="tablist" aria-label="공유 파일 범위">
            {PICKER_SCOPES.map((s) => (
              <button
                key={s.scope}
                type="button"
                role="tab"
                aria-selected={nav.scope === s.scope && nav.trail.length === 0}
                onClick={() => go(withScope(nav, s.scope))}
                className={cn('rounded-full px-2 py-0.5 text-[11px]', nav.scope === s.scope ? 'bg-white text-[#222529]' : 'bg-[#2F333B] text-[#CAD0D7]')}
              >
                {s.label}
              </button>
            ))}
          </div>

          {nav.trail.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-[#CAD0D7]" data-testid="shared-file-folder-trail">
              <button type="button" onClick={() => go(back(nav))} className="flex items-center rounded px-1 hover:bg-[#2F333B]">
                <ChevronLeft className="h-3.5 w-3.5" />뒤로
              </button>
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{trailLabel(nav)}</span>
            </div>
          )}

          {error && (
            <p className="text-xs text-[#FFB020]">
              {error.message}
              {error.actionUrl && (
                <> <button type="button" onClick={() => void connect(error.actionUrl!)} className="underline">aindrive 연결</button></>
              )}
            </p>
          )}

          {!error && items && items.length === 0 && !loading && (
            <p className="py-2 text-center text-xs text-[#CAD0D7]">공유된 파일이 없습니다.</p>
          )}

          <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {(items ?? []).map((item) => {
              const { ref } = item;
              const offline = ref.availability.state === 'offline';
              const gone = ref.availability.state === 'deleted';
              const pickable = !!ref.sourceUrl && !gone && !disabled;
              return (
                <li key={fileKey(ref)} className="flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={!pickable}
                    onClick={() => pick(ref)}
                    className={cn('flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-[#2F333B] disabled:cursor-not-allowed disabled:opacity-50', offline && 'opacity-70')}
                    title={ref.legacy?.path ?? ref.displayName}
                  >
                    {ref.kind === 'folder' ? <FolderOpen className="h-4 w-4 shrink-0" /> : <FileText className="h-4 w-4 shrink-0" />}
                    <span className="truncate">{ref.displayName}</span>
                    {(offline || gone) && <span className="ml-auto shrink-0 text-[10px] text-[#FFB020]">{gone ? '삭제됨' : '오프라인'}</span>}
                  </button>
                  {canOpen(item) && (
                    <button
                      type="button"
                      onClick={() => go(openFolder(nav, ref))}
                      aria-label={`${ref.displayName} 폴더 열기`}
                      title={`${ref.displayName} 폴더 열기`}
                      className="shrink-0 rounded p-1 text-[#CAD0D7] hover:bg-[#2F333B]"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        </div>
      )}
    </div>
  );
}
