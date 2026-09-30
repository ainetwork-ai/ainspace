'use client';

import { useCallback, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { isAinIntegrationEnabledClient } from '@/lib/ain-integration/config';
import { followActionUrl } from '@/lib/ain-integration/connect-client';
import type { SharedFilePick } from './SharedFilePicker';

/**
 * 17.7 "파일 첨부" — 새 채팅 첨부는 사용자의 aindrive 폴더에 올리고(`POST /api/ain/attachments`), 채팅 입력에는
 * 링크 파트(markdown)만 넣는다. Space/backend 스토리지에 올리지 않는다. 옛 첨부 렌더링은 그대로다.
 * 플래그 off 면 아무것도 렌더링하지 않는다.
 */
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetcher: Fetcher = (input, init) => import('@/lib/backend/bff-fetch').then((m) => m.bffAuthFetch(input, init));

interface Props {
  onUploaded: (pick: SharedFilePick) => void;
  disabled?: boolean;
  enabled?: boolean;
  fetcher?: Fetcher;
}

interface UploadError { message: string; actionUrl?: string }

export async function uploadChatAttachment(fetcher: Fetcher, file: File, folderKey?: string): Promise<{ ok: true; pick: SharedFilePick } | { ok: false; error: UploadError }> {
  const form = new FormData();
  form.set('file', file);
  if (folderKey) form.set('folderKey', folderKey);
  try {
    const res = await fetcher('/api/ain/attachments', { method: 'POST', body: form });
    const body = await res.json().catch(() => null);
    if (res.ok && typeof body?.markdown === 'string' && body?.file) return { ok: true, pick: { markdown: body.markdown, ref: body.file } };
    const e = body?.error as { message?: string; actionUrl?: string } | undefined;
    return { ok: false, error: { message: e?.message ?? `첨부를 올리지 못했습니다 (${res.status})`, actionUrl: e?.actionUrl } };
  } catch {
    return { ok: false, error: { message: '첨부를 올리지 못했습니다.' } };
  }
}

export default function ChatAttachmentUpload({ onUploaded, disabled = false, enabled = isAinIntegrationEnabledClient(), fetcher = defaultFetcher }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UploadError | null>(null);

  const onChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    const r = await uploadChatAttachment(fetcher, file);
    setBusy(false);
    if (r.ok) onUploaded(r.pick);
    else setError(r.error);
  }, [fetcher, onUploaded]);

  const connect = useCallback(async (actionUrl: string) => {
    const message = await followActionUrl(actionUrl, {
      fetcher, navigate: (u) => window.location.assign(u), openTab: (u) => window.open(u, '_blank', 'noopener,noreferrer'), location: window.location,
    });
    if (message) setError({ message });
  }, [fetcher]);

  if (!enabled) return null;

  return (
    <div className="relative" data-testid="chat-attachment-upload">
      <input ref={inputRef} type="file" className="hidden" onChange={onChange} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy}
        aria-label="파일 첨부"
        title="파일 첨부 (내 aindrive 에 저장)"
        className="flex items-center gap-1 rounded-full bg-black/30 p-2 text-white disabled:opacity-60"
      >
        <Upload className="h-4 w-4" />
        <span className="sr-only">파일 첨부</span>
      </button>
      {error && (
        <p className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-lg border border-[#4A4E56] bg-[#222529] p-2 text-xs text-[#FFB020]">
          {error.message}
          {error.actionUrl && (<> <button type="button" onClick={() => void connect(error.actionUrl!)} className="underline">aindrive 연결</button></>)}
        </p>
      )}
    </div>
  );
}
