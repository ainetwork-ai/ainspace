'use client';
import { useEffect, useRef, useState } from 'react';
import { resolveAinCallLaunch } from '@/lib/resolve-aincall-launch';
import type { VillageFetcher } from '@/lib/ain-integration/village-client';
export function SpaceAinCallButton({ slug, fetcher }: { slug: string; fetcher: VillageFetcher }) {
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
    const aincallWindow = window.open('about:blank', '_blank');
    if (!aincallWindow) { setBusy(false); setError('AIN Call 창을 열려면 팝업을 허용해 주세요.'); return; }
    pendingWindow.current = aincallWindow;
    const controller = new AbortController(); pendingRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(new Error('AIN Call 연결 확인이 지연되고 있습니다. 다시 시도해 주세요.')), 15_000);
    try {
      aincallWindow.opener = null;
      const url = await resolveAinCallLaunch(fetcher, slug, controller.signal);
      if (generation.current !== attempt || aincallWindow.closed) { aincallWindow.close(); return; }
      aincallWindow.location.replace(url);
      pendingWindow.current = null;
    } catch (failure) { aincallWindow.close(); if (generation.current === attempt) setError(failure instanceof Error ? failure.message : 'AIN Call에 연결할 수 없습니다.'); }
    finally { window.clearTimeout(timeout); if (pendingRequest.current === controller) pendingRequest.current = null; if (pendingWindow.current === aincallWindow) pendingWindow.current = null; if (generation.current === attempt) setBusy(false); }
  }
  return <div className="grid gap-1"><button type="button" disabled={busy} onClick={() => void join()} className="rounded-lg bg-[#7F4FE8] px-3 py-2 text-sm font-bold disabled:opacity-60">{busy ? 'AIN Call 연결 중…' : 'AIN Call 참여'}</button>{error && <p role="alert" className="text-xs text-[#FFB020]">{error}</p>}</div>;
}
