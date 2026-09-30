import { NextRequest, NextResponse } from 'next/server';
import { beginAindriveConnect, disconnectAindrive, STATE_TTL_SEC } from '@/lib/ain-integration/aindrive-token';
import { AINDRIVE_CALLBACK_PATH, getAindriveOAuthClientId, getAindriveUrl, getPublicOrigin } from '@/lib/ain-integration/config';
import { aindriveConnectDeps as deps } from '@/lib/ain-integration/deps';
import { AINDRIVE_STATE_COOKIE } from '@/lib/ain-integration/oauth-cookie';
import { failureResponse, guardAinRoute, okResponse } from '@/lib/ain-integration/route';
import { AinContractError } from '@/lib/ain-integration/types';

export const runtime = 'nodejs';

/**
 * GET /api/ain/aindrive/connect[?returnTo=/path] — aindrive 계정 연결 시작 (공통 항목 A).
 *
 * 앱 세션(검증된 backend JWT, Authorization 헤더)으로 사용자를 확인하고 PKCE·state 를 만들어
 * `{AINDRIVE_URL}/oauth/authorize?client_id={AINDRIVE_OAUTH_CLIENT_ID}&redirect_uri={origin}/api/ain/aindrive/callback
 * &scope=profile drives:read drives:write&code_challenge…` 로 보낸다. state 는 서버(KV, 봉인)와 이 브라우저의 HttpOnly
 * 쿠키 양쪽에 둔다 — 콜백은 둘이 같을 때만 받는다.
 *
 * Space 의 세션은 localStorage 의 bearer 라 브라우저 탐색(주소창·<a>)으로는 헤더를 보낼 수 없다. 그래서 클라이언트는
 * 이 라우트를 `fetch`(Authorization + `Accept: application/json`)로 불러 `{ authorizeUrl }` 을 받고 그리로 이동한다
 * (`lib/ain-integration/connect-client.ts`). JSON 을 원하지 않는 호출(헤더를 붙일 수 있는 프록시 등)에는 302 를 준다.
 *
 * DELETE /api/ain/aindrive/connect — 연결 해제(저장된 토큰 쌍을 지운다).
 *
 * 응답·로그에 토큰·verifier 를 싣지 않는다. 플래그 off 면 404.
 */
export async function GET(request: NextRequest) {
  const guard = await guardAinRoute(request);
  if (!('userId' in guard)) return guard;

  const clientId = getAindriveOAuthClientId();
  if (!clientId) {
    return failureResponse(new AinContractError('temporary_failure', 'aindrive 계정 연결이 이 배포에 설정되어 있지 않습니다.', { retryable: false, detail: 'aindrive_connect_client_id_missing' }));
  }
  const origin = getPublicOrigin(request.nextUrl.origin);
  const redirectUri = `${origin}${AINDRIVE_CALLBACK_PATH}`;
  try {
    const { authorizeUrl, state } = await beginAindriveConnect({
      userId: guard.userId, aindriveUrl: getAindriveUrl(), clientId, redirectUri, returnTo: request.nextUrl.searchParams.get('returnTo'),
    }, deps);
    const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
    const res = wantsJson ? okResponse({ authorizeUrl }) : NextResponse.redirect(authorizeUrl, { status: 302, headers: { 'Cache-Control': 'private, no-store' } });
    res.cookies.set(AINDRIVE_STATE_COOKIE, state, {
      httpOnly: true,
      // 콜백은 aindrive 에서 오는 최상위 GET 이동이다 — Lax 면 실린다(Strict 는 실리지 않는다).
      sameSite: 'lax',
      secure: redirectUri.startsWith('https://'),
      path: AINDRIVE_CALLBACK_PATH,
      maxAge: STATE_TTL_SEC,
    });
    return res;
  } catch (e) {
    return failureResponse(e);
  }
}

export async function DELETE(request: NextRequest) {
  const guard = await guardAinRoute(request);
  if (!('userId' in guard)) return guard;
  try {
    await disconnectAindrive(guard.userId, deps);
    return okResponse({ connected: false });
  } catch (e) {
    return failureResponse(e);
  }
}
