'use client';

import { useEffect, useRef } from 'react';
import { isAinIntegrationEnabledClient } from '@/lib/ain-integration/config';
import { VillagePresenceSync, type VillageFetcher } from '@/lib/ain-integration/village-client';

const defaultFetcher: VillageFetcher = (input, init) => import('@/lib/backend/bff-fetch').then((m) => m.bffAuthFetch(input, init));

/**
 * 17.5 검증된 체류 — 로그인한 사용자가 마을에 들어가면 `PUT /api/ain/villages/:slug/presence`, 5분마다 갱신,
 * 떠나면(다른 마을·마을 밖·언마운트·페이지 종료) `DELETE`. AIN 통합 플래그 off 또는 로그아웃이면 아무것도 하지 않는다.
 * 기존 SSE presence(useVillagePresence)와는 별개다 — 그쪽은 검증된 사용자와 이어지지 않는다.
 */
export function useAinVillagePresence(slug: string | null, loggedIn: boolean, fetcher: VillageFetcher = defaultFetcher): void {
  const enabled = isAinIntegrationEnabledClient() && loggedIn;
  const syncRef = useRef<VillagePresenceSync | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const sync = new VillagePresenceSync({ fetcher });
    syncRef.current = sync;
    const onHide = () => sync.leave({ keepalive: true });
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      sync.leave();
      syncRef.current = null;
    };
  }, [enabled, fetcher]);

  useEffect(() => {
    const sync = syncRef.current;
    if (!enabled || !sync) return;
    if (slug) sync.enter(slug); else sync.leave();
    // bfcache 에서 돌아오면(pagehide 로 떠난 뒤) 다시 들어간다.
    const onShow = (e: PageTransitionEvent) => { if (e.persisted && slug) sync.enter(slug); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [enabled, slug]);
}
