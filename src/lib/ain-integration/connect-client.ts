/**
 * 브라우저 쪽: `auth_required.actionUrl` 을 따라가기.
 *
 * actionUrl 이 이 제품의 aindrive 연결 시작 라우트(`/api/ain/aindrive/connect`)면 세션 bearer 를 헤더로 실어 `fetch` 로
 * 부르고(브라우저 탐색은 헤더를 못 싣는다), 돌려받은 `authorizeUrl` 로 이동한다. 연결이 끝나면 aindrive 가 콜백을 거쳐
 * 지금 페이지(`returnTo`)로 돌려보낸다. 그 밖의 actionUrl(AIN SSO 연결 등)은 새 탭으로 연다.
 */
import { AINDRIVE_CONNECT_PATH } from './config';

export type ConnectFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface FollowActionOptions {
  fetcher: ConnectFetcher;
  navigate: (url: string) => void;
  openTab: (url: string) => void;
  /** 현재 오리진과 경로(돌아올 곳). */
  location: { origin: string; pathname: string; search: string };
}

export const isAindriveConnectUrl = (actionUrl: string, origin: string): boolean => {
  try { const u = new URL(actionUrl, origin); return u.origin === origin && u.pathname === AINDRIVE_CONNECT_PATH; } catch { return false; }
};

/** 성공이면 null, 연결을 시작하지 못했으면 사용자에게 보여 줄 문장. */
export async function followActionUrl(actionUrl: string, o: FollowActionOptions): Promise<string | null> {
  if (!isAindriveConnectUrl(actionUrl, o.location.origin)) { o.openTab(actionUrl); return null; }
  const u = new URL(AINDRIVE_CONNECT_PATH, o.location.origin);
  u.searchParams.set('returnTo', `${o.location.pathname}${o.location.search}`);
  try {
    const res = await o.fetcher(`${u.pathname}${u.search}`, { headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => null) as { authorizeUrl?: unknown; error?: { message?: string } } | null;
    if (res.ok && typeof body?.authorizeUrl === 'string') { o.navigate(body.authorizeUrl); return null; }
    return body?.error?.message ?? `aindrive 연결을 시작하지 못했습니다 (${res.status})`;
  } catch {
    return 'aindrive 연결을 시작하지 못했습니다.';
  }
}
