# AIN 통합 — 흐름 단계 (ainspace)

브랜치 `feat/ain-integration-flows`. 모두 `AIN_INTEGRATION_ENABLED`(서버)·`NEXT_PUBLIC_AIN_INTEGRATION_ENABLED`(진입점) 뒤에 있다 — off 면 라우트 404, UI 없음.
토큰(aindrive 계정 토큰·refresh·PKCE verifier·ID 토큰)은 응답·로그에 싣지 않는다.

## A. aindrive 계정 연결 (사용자별 토큰 저장소)

aindrive 는 계정 grant 용 OAuth 2.1 서버를 이미 운영한다(authorization code + PKCE S256, public client, `aind_aat_`/`aind_art_`,
refresh 회전). Space 쪽:

| 라우트 | 하는 일 |
|---|---|
| `GET /api/ain/aindrive/connect[?returnTo=/path]` | 앱 세션(Authorization bearer) 확인 → state·verifier 생성 → state 레코드를 **봉인해** Redis 10분 + HttpOnly 쿠키(`ain_aindrive_oauth_state`, SameSite=Lax, Path=콜백) → `{AINDRIVE_URL}/oauth/authorize?client_id={AINDRIVE_OAUTH_CLIENT_ID}&redirect_uri={origin}/api/ain/aindrive/callback&scope=profile drives:read drives:write&code_challenge…`. `Accept: application/json` 이면 `{authorizeUrl}`, 아니면 302. |
| `GET /api/ain/aindrive/callback` | 쿼리 state == 쿠키 state 일 때만(아니면 403, 레코드도 건드리지 않음) → 레코드 1회 소비 → `{AINDRIVE_URL}/api/oauth/token` 에서 code 교환 → 토큰 쌍을 사용자별로 봉인 저장 → `returnTo?ain_aindrive=connected`. 거절은 `=denied`/`=failed`, 만료·재사용은 401 + 연결 actionUrl. |
| `DELETE /api/ain/aindrive/connect` | 연결 해제(저장 레코드 삭제). |

- 토큰 엔드포인트는 aindrive AS 메타데이터의 `token_endpoint` = **`/api/oauth/token`** 이다(`/oauth/token` 은 없다).
- 저장: Redis `ain:aindrive_account:<userId>` = AES-256-GCM(`v1.iv.ct.tag`), 키 = HKDF-SHA256(`AINDRIVE_TOKEN_KEY`, 용도별 info),
  AAD = 사용자 id(다른 사용자 자리로 복사하면 열리지 않음). 90일 TTL. 키가 없으면 연결을 시작하지 않는다(평문 저장 없음).
- 사용: `getAindriveAccountToken(userId)` — 만료 60초 전부터 refresh 로 갱신(같은 사용자 동시 갱신은 한 번), 회전된 쌍 저장.
  refresh 가 거절되면 연결을 지우고 null → 모든 라우트가 `auth_required` + actionUrl = **`{origin}/api/ain/aindrive/connect`**.
  원본 장애·갱신 시 `AINDRIVE_OAUTH_CLIENT_ID` 누락은 `temporary_failure`(연결 유지 — 설정 실수로 연결을 지우지 않는다).
  `AINDRIVE_ACCOUNT_TOKEN`(배포 단위 토큰) fallback 은 **`NODE_ENV=development` 에서만**, 사용자 레코드가 아예 없을 때만.
  운영에서는 쓰지 않는다. 레코드는 있는데 봉인을 못 열면(키 회전·변조) 어디서도 fallback 없이 null → `auth_required`(다시 연결).
- 예전 평문 키 `ain:aindrive_token:<userId>` 는 더 읽지 않는다(인벤토리에서 `delete-legacy`).
- Space 세션은 localStorage bearer 라 브라우저 탐색으로는 헤더를 못 싣는다: 클라이언트(`connect-client.ts`)가 actionUrl 이
  연결 시작 라우트면 `fetch`(bearer + Accept JSON)로 불러 `authorizeUrl` 로 이동한다. 공유 파일 picker·첨부 버튼의 "aindrive 연결"이 이것을 쓴다.
- aindrive 운영: 클라이언트를 등록하고(`/api/oauth/register`, redirect_uri 위 값) 필요하면 `AINDRIVE_TRUSTED_OAUTH_CLIENTS` 에 넣는다(동의 화면 생략).
- 알려진 한계: aindrive 에 토큰 폐기(RFC 7009) 엔드포인트가 없어 해제는 Space 쪽 레코드만 지운다(aindrive 의 "연결된 앱"에서 폐기 가능).

env: `AINDRIVE_OAUTH_CLIENT_ID`, `AINDRIVE_TOKEN_KEY`(32자+), `NEXT_PUBLIC_URL`(프록시 뒤 공개 오리진), 선택 `AINDRIVE_CONNECT_URL`.

## B. 세션 증명 — **해당 없음**

Space 는 AIN SSO 로 로그인하지 않는다(지갑·키오스크 → backend(ainteams) JWT). 봉인해 둘 ID 토큰이 생기지 않으므로
`getSessionProof` 는 운영에서 항상 **null** 이고, 파일을 넘기는 에이전트 호출은 `auth_required` + AIN SSO 연결 actionUrl 로 끝난다.
AIN SSO 로그인 전체를 들이는 것은 이 단계 범위 밖이다. 예전의 평문 Redis 키(`ain:sso_id_token:*`, 쓰는 곳 없음)는 읽지 않게 지웠다.
개발 전용 `AIN_SESSION_PROOF_FILE` 만 남는다(production 무시). 로그인이 생기면: ainmem `sso_sessions.id_token_ciphertext` 처럼
세션별로 `sealed.ts` 로 봉인 → 만료 전까지만 반환 → 로그아웃·back-channel 로그아웃에서 삭제.

## 17.5 마을 자료 구분

- Redis hash `village:<slug>:ain_materials` — 필드 = fileKey, 값 = `{ ref: FileRef, audience, addedBy, addedAt }`. audience:
  `public`(방문자·멤버, 에이전트 가능) · `members`(멤버만, **에이전트에 넘기지 않음**) · `agent`(사람 목록 X, 에이전트 호출에만).
- 멤버(backend 사용자 id = 검증된 세션의 sub) = **소유자** `village:<slug>:owner` + set `village:<slug>:members`.
  - 소유자: `POST /api/villages` 를 플래그 on 에서 `Authorization: Bearer <backend JWT>` 로 부르면 그 사용자가 소유자·멤버가 된다
    (bearer 없는 기존 관리자 도구의 생성은 그대로 되고 소유자만 없다). 이미 소유자가 있으면 바꾸지 않는다.
  - 소유자가 없는 기존 마을: 관리자 대시보드 요청(미들웨어가 `ADMIN_API_SECRET` 을 확인해 붙이는 `x-admin-verified`)만
    `POST /api/villages/:slug/members {userId, owner: true}` 로 소유자를 정한다.
  - `GET /api/villages/:slug/members`(멤버) → `{owner, members}`; `POST {userId}`·`DELETE ?userId=` 는 소유자만(소유자 자신은 못 뺀다).
  - 마을 삭제(`DELETE /api/villages/:slug`)는 owner·members·ain_materials·ain_presence 키도 지운다(같은 slug 재생성이 옛 멤버를 물려받지 않게).
- `GET /api/ain/villages/:slug/materials` 방문자 = public, 멤버 = public+members(멤버의 `?view=manage` 는 전부).
  `PUT {fileKey, audience}`·`DELETE ?fileKey=` 는 멤버만, 파일은 그 멤버의 aindrive 에서 해석되는 것만.
- 검증된 체류: `PUT /api/ain/villages/:slug/presence`(검증된 세션, 10분 유효, 갱신 필요)·`DELETE`. 기존 위치/SSE presence 는
  클라이언트가 보낸 wallet/session id 라 검증된 사용자와 이어지지 않아서 따로 둔다. Redis hash `village:<slug>:ain_presence`.
- `POST /api/ain/invoke` 에 `villageMaterials: true`(+ `room` = 마을 slug) → public·agent 자료만 fileKeys 에 더한다. 조건:
  `room` 이 slug 모양 · `agentKey` 가 그 마을에 **배치된** 에이전트(StoredAgent `commonAgentId`·`isPlaced`·`state.mapName`, 비활성 아님)
  · 호출자가 멤버이거나 검증된 체류 중. 아니면 403(`agent_not_placed_in_village` / `not_in_village`), 원본은 부르지 않는다.
- 더해진 자료는 **고른 파일과 똑같은 경로**를 탄다: 같은 fileKeys → 호출자의 aindrive 토큰으로 해석(볼 수 없으면 `forbidden`)
  → 호출자의 세션 증명으로 위임 → 같은 file-refs part·같은 idempotencyKey. 따라서 **B(세션 증명)가 없는 지금의 Space 운영에서는
  자료가 하나라도 있으면 고른 파일과 마찬가지로 `auth_required`** 로 끝난다(자료를 조용히 빼고 부르지 않는다). 즉 17.5 의 에이전트
  전달은 B 가 생길 때까지 실제로는 동작하지 않는다 — 목록·가시성(사람 쪽)은 지금도 동작한다. `agent` 자료도 호출자가 aindrive 에서
  볼 수 있어야 넘어간다(에이전트 전용 공유 계정으로 대신 해석하지 않는다).

## 17.6 contextId 경계

`conversationContextId = ctx:<account>:<org>:ainspace:<room>:<conversation>`. `villageConversationId(slug, agentKey[, thread])` 는
(마을, 에이전트, 스레드)로 결정적이라 재입장·재시작 후에도 같은 방문자는 같은 contextId, 다른 방문자는 account 조각이 달라
섞이지 않는다. 테스트: `src/lib/ain-integration/village-context.test.ts`(동시 호출·재시작 포함).

## 17.7 자산 인벤토리·이관

`docs/ain-asset-migration.md`.
