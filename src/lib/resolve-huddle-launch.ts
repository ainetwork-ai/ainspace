import type { VillageFetcher } from './ain-integration/village-client';
import { huddleLaunchUrl } from './huddle-launch-url';

/** Bound the complete permission lookup, including body reads and auth refresh. */
export async function resolveHuddleLaunch(fetcher: VillageFetcher, slug: string, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw signal.reason;
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([cancelled, (async () => {
      const response = await fetcher(`/api/ain/villages/${encodeURIComponent(slug)}/huddle`, { signal });
      if (signal.aborted) { await response.body?.cancel().catch(() => {}); throw signal.reason; }
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw Error('허들 참여 권한을 확인할 수 없습니다.'); }
      const data = await response.json();
      if (typeof data?.joinUrl !== 'string') throw Error('허들 연결이 아직 설정되지 않았습니다.');
      const url = new URL(data.joinUrl);
      if (huddleLaunchUrl(url.origin, slug) !== url.href) throw Error('허들 연결을 확인할 수 없습니다.');
      if (signal.aborted) throw signal.reason;
      return url.href;
    })()]);
  } finally { signal.removeEventListener('abort', onAbort); }
}
