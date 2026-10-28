'use client';
import { useEffect, useRef, useState } from 'react';
import { resolveHuddleLaunch } from '@/lib/resolve-huddle-launch';
import type { VillageFetcher } from '@/lib/ain-integration/village-client';
export function SpaceHuddleButton({ slug, fetcher }: { slug: string; fetcher: VillageFetcher }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const generation = useRef(0);
  const pendingWindow = useRef<Window | null>(null);
  const pendingRequest = useRef<AbortController | null>(null);
  useEffect(() => { generation.current += 1; setBusy(false); setError(''); return () => { generation.current += 1; pendingRequest.current?.abort(); pendingRequest.current = null; pendingWindow.current?.close(); pendingWindow.current = null; }; }, [slug]);
  async function join() {
    if (busy || pendingWindow.current) return;
    const attempt = generation.current; setBusy(true); setError('');
    // Open during the click so the browser does not block the asynchronous launch.
    // Keeping this Space tab connected preserves visitor presence authority.
    const huddleWindow = window.open('about:blank', '_blank');
    if (!huddleWindow) { setBusy(false); setError('허들 창을 열려면 팝업을 허용해 주세요.'); return; }
    pendingWindow.current = huddleWindow;
    const controller = new AbortController(); pendingRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(new Error('허들 연결 확인이 지연되고 있습니다. 다시 시도해 주세요.')), 15_000);
    try {
      huddleWindow.opener = null;
      const url = await resolveHuddleLaunch(fetcher, slug, controller.signal);
      if (generation.current !== attempt || huddleWindow.closed) { huddleWindow.close(); return; }
      huddleWindow.location.replace(url);
      pendingWindow.current = null;
    } catch (failure) { huddleWindow.close(); if (generation.current === attempt) setError(failure instanceof Error ? failure.message : '허들에 연결할 수 없습니다.'); }
    finally { window.clearTimeout(timeout); if (pendingRequest.current === controller) pendingRequest.current = null; if (pendingWindow.current === huddleWindow) pendingWindow.current = null; if (generation.current === attempt) setBusy(false); }
  }
  return <div className="grid gap-1"><button type="button" disabled={busy} onClick={() => void join()} className="rounded-lg bg-[#7F4FE8] px-3 py-2 text-sm font-bold disabled:opacity-60">{busy ? '허들 연결 중…' : '허들 참여'}</button>{error && <p role="alert" className="text-xs text-[#FFB020]">{error}</p>}</div>;
}
