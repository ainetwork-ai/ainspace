import { NextRequest, NextResponse } from 'next/server';
import { backendFetch, getBearer } from '@/lib/backend/server-client';

// 스트림을 통과시키므로 node 런타임이어야 한다.
export const runtime = 'nodejs';

/**
 * GET /api/files/:id?token=<accessToken>
 *
 * EPIC23 — 첨부 바이트 프록시. backend `GET /files/:id/stream` 을 대신 부른다.
 *
 * 왜 프록시가 필요한가: 바이트는 자체호스팅 스토리지에만 있고 그 서빙 라우트는 Bearer 를
 * 요구한다. `<img src>` 는 `Authorization` 헤더를 보낼 수 없으므로(SSE 에서 만난 것과
 * 같은 벽 — `/api/thread-stream/:threadId` 가 `?token=` 으로 푼 그 문제다) 같은 오리진의
 * 이 라우트가 토큰을 헤더로 옮겨 준다.
 *
 * ⚠️ **status 를 정규화하지 않는다.** 200·206·304·404·416 을 그대로 흘린다. 특히 304 를
 * 200 으로 바꾸면 조건부 요청이 무력화돼 같은 이미지를 매 렌더마다 전량 다시 받는다.
 *
 * ⚠️ **보안 헤더는 전달하지 않고 여기서 붙인다.** `X-Content-Type-Options` ·
 * `Content-Security-Policy` 는 인라인 서빙의 XSS 방어인데, upstream 이 보낸 것을
 * *전달* 하면 그 방어가 **다른 레포의 현재 배포 상태에 의존**하게 된다 — backend 롤백,
 * 헤더를 떼는 hop, `BACKEND_BASE_URL` 오설정 중 무엇이든 같은 바이트를 방어 없이
 * `Content-Disposition: inline` 으로 내보내게 된다(저장형 XSS). 바이트가 **이 오리진**
 * 에서 나가므로 이 오리진이 스스로 방어를 선언한다. 값은 backend 와 동일하니 정상
 * 경로에서는 덮어쓰기가 no-op 이다.
 */

/**
 * 그대로 전달할 응답 헤더 — **allowlist 다**(전량 복사가 아니다).
 *
 * 그래서 `Set-Cookie` 가 구조적으로 새지 않는다: backend 응답의 쿠키를 흘리면 ainspace
 * 오리진에 남는다. 새 헤더가 필요해지면 여기 이름을 더한다.
 */
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'cache-control',
  'content-disposition',
] as const;

/** 이 오리진이 **스스로** 선언하는 헤더 — upstream 값에 기대지 않는다(위 주석). */
const ENFORCED_RESPONSE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox;",
  // upstream 의 `Cache-Control` 을 echo 하지 않는다. 그 상수가 언젠가 `public` 으로
  // 느슨해지면 **토큰이 실린 URL** 이 CDN 저장소·로그로 넘어간다. 304 목표는
  // `no-cache`(저장은 하되 매번 재검증)로 충분하다.
  'Cache-Control': 'private, no-cache',
};

/** backend `files.id` 는 uuid 다 — 그 형식만 upstream 으로 보낸다. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // 형식 검사를 **fetch 전에** 한다. `encodeURIComponent` 가 `/`·`?`·`#` 는 막지만
  // `id` 가 정확히 `..` 이면 URL 파서가 dot-segment 를 지워 upstream 이 `/files/` 밖의
  // 경로가 된다. 인코딩마다 따지는 대신 형식으로 한 번에 닫는다.
  //
  // 404 인 이유는 backend 와 같다 — 잘못된 id·없는 파일·권한 없는 파일이 구분되지
  // 않아야 한다(400 을 주면 "이 id 는 형식조차 아니다" 를 알려주는 오라클이 된다).
  if (!UUID_RE.test(id)) {
    return new NextResponse(null, { status: 404 });
  }

  const token = getBearer(request);
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 조건부·부분 요청을 **전달**한다. 빼면 304 가 영영 오지 않아(=validator 가 없는 것과
  // 같다) 캐시가 죽고, Range 를 빼면 동영상 탐색이 안 된다.
  // `Authorization` 은 `backendFetch` 가 붙인다 — 여기서 또 만들면 backend 인증 계약이
  // 바뀔 때(공용 헤더 추가 등) 이 라우트만 조용히 빠진다.
  const forwardHeaders = new Headers();
  // ⚠️ `identity` 를 요구한다. Node fetch 는 기본으로 gzip 을 받아 **본문을 디코드** 하는데
  // `content-length` 는 인코딩된 길이다 — 앞단에 압축하는 hop(nginx·ALB·CDN)이 있으면
  // 우리가 선언하는 길이와 실제 바이트가 어긋나 이미지가 잘린다. 그 hop 이 있는 환경에서만
  // 재현되는 종류라 여기서 원천 차단한다(이미지·동영상은 압축 이득도 없다).
  forwardHeaders.set('Accept-Encoding', 'identity');
  const range = request.headers.get('range');
  if (range) forwardHeaders.set('Range', range);
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch) forwardHeaders.set('If-None-Match', ifNoneMatch);

  let upstream: Response;
  try {
    upstream = await backendFetch(
      token,
      `/files/${encodeURIComponent(id)}/stream`,
      // `no-store` 는 Next 의 Data Cache 가 25MB 바이너리를 memo 하려 드는 것을 막는다
      // (undici 는 HTTP 캐시가 없으므로 위 조건부 헤더나 upstream 304 에는 무관하다).
      { headers: forwardHeaders, cache: 'no-store' }
    );
  } catch (error) {
    console.error('File proxy error:', error);
    return NextResponse.json({ error: 'file unavailable' }, { status: 502 });
  }

  const headers = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  for (const [name, value] of Object.entries(ENFORCED_RESPONSE_HEADERS)) {
    headers.set(name, value);
  }

  // 본문은 **스트림 그대로** 넘긴다 — 버퍼로 모으면 최대 25MB 가 이 프로세스 메모리에
  // 올라가고, 동시 요청이 몇 개만 겹쳐도 그대로 배가된다.
  //
  // null-body status(204·304)에는 body 를 **명시적으로 null** 로 넘긴다. `Response`
  // 생성자는 그 status 에 non-null body 가 오면 `TypeError` 를 던지고, 그러면 캐시된
  // 이미지를 다시 볼 때마다(=304 가 정상 응답인 그 경로에서) 500 이 된다.
  //
  // Node 20·22 의 `fetch` 는 304 에 `body === null` 을 준다(실측). 그래도 가드를 두는
  // 이유는 이 라우트가 도는 배포 런타임을 여기서 돌려볼 수 없기 때문이다 — 한 줄이고
  // 정상 경로에서는 no-op 인데, 빠졌을 때의 실패는 조용하고 재방문마다 반복된다.
  const nullBody = upstream.status === 204 || upstream.status === 304;
  return new NextResponse(nullBody ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}
