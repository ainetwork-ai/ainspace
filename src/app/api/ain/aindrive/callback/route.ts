import { NextRequest, NextResponse } from 'next/server';
import { completeAindriveConnect } from '@/lib/ain-integration/aindrive-token';
import { AINDRIVE_CALLBACK_PATH, getAindriveConnectUrl, getAindriveOAuthClientId, getAindriveUrl, getPublicOrigin, isAinIntegrationEnabled } from '@/lib/ain-integration/config';
import { aindriveConnectDeps as deps } from '@/lib/ain-integration/deps';
import { AINDRIVE_STATE_COOKIE } from '@/lib/ain-integration/oauth-cookie';
import { errorResponse, failureResponse } from '@/lib/ain-integration/route';
import { AinContractError, makeError } from '@/lib/ain-integration/types';

export const runtime = 'nodejs';

/**
 * GET /api/ain/aindrive/callback?code&state[&error] — aindrive OAuth 콜백 (공통 항목 A).
 *
 * aindrive 가 브라우저를 여기로 돌려보낸다(Authorization 헤더 없음). 사용자는 연결 시작 때 서버에 둔 state 레코드로
 * 정해지고, 쿼리 state 가 이 브라우저의 쿠키 state 와 같을 때만 받는다(다르면 403 — 레코드도 건드리지 않는다).
 * code 를 `{AINDRIVE_URL}/api/oauth/token` 에서 PKCE verifier 로 교환해 토큰 쌍을 사용자별로 봉인 저장하고
 * `returnTo?ain_aindrive=connected` 로 보낸다. 사용자가 거절했거나 교환이 거절되면 `…=denied|failed`.
 * state 가 만료·재사용이면 401 auth_required + 연결 시작 actionUrl. 토큰·code 는 응답·로그에 없다.
 */
export async function GET(request: NextRequest) {
  if (!isAinIntegrationEnabled()) {
    return errorResponse(makeError('temporary_failure', 'AIN 통합이 이 배포에서 꺼져 있습니다.', { retryable: false, detail: 'ain_integration_disabled' }), 404);
  }
  const clientId = getAindriveOAuthClientId();
  if (!clientId) {
    return failureResponse(new AinContractError('temporary_failure', 'aindrive 계정 연결이 이 배포에 설정되어 있지 않습니다.', { retryable: false, detail: 'aindrive_connect_client_id_missing' }));
  }
  const q = request.nextUrl.searchParams;
  const origin = getPublicOrigin(request.nextUrl.origin);

  let res: NextResponse;
  try {
    const r = await completeAindriveConnect({
      aindriveUrl: getAindriveUrl(), clientId,
      state: q.get('state'), cookieState: request.cookies.get(AINDRIVE_STATE_COOKIE)?.value ?? null,
      code: q.get('code'), error: q.get('error'),
    }, deps);
    if (r.ok) res = redirectTo(origin, r.returnTo, 'connected');
    else if (r.reason === 'state_mismatch') {
      // 쿠키가 다르면 쿠키를 지우지 않는다: 이 브라우저에서 진행 중인 정상 연결을 방해하지 않게.
      return errorResponse(makeError('forbidden', '이 브라우저에서 시작한 aindrive 연결이 아닙니다. 다시 연결해 주세요.', { detail: 'aindrive_connect_state_mismatch' }));
    } else if (r.reason === 'state_expired') {
      res = errorResponse(makeError('auth_required', 'aindrive 연결 요청이 만료되었습니다. 다시 연결해 주세요.', { actionUrl: getAindriveConnectUrl(request.nextUrl.origin), detail: 'aindrive_connect_state_expired' }));
    } else res = redirectTo(origin, r.returnTo ?? '/', r.reason === 'denied' ? 'denied' : 'failed');
  } catch (e) {
    res = failureResponse(e);
  }
  res.cookies.set(AINDRIVE_STATE_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: AINDRIVE_CALLBACK_PATH, maxAge: 0 });
  return res;
}

function redirectTo(origin: string, returnTo: string, status: 'connected' | 'denied' | 'failed'): NextResponse {
  const u = new URL(returnTo, `${origin}/`);
  u.searchParams.set('ain_aindrive', status);
  return NextResponse.redirect(u.toString(), { status: 302, headers: { 'Cache-Control': 'private, no-store' } });
}
