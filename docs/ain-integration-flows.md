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

## B. 세션 증명 — Teams 가 대신 위임을 발급

Space 는 AIN SSO 로 로그인하지 않는다(지갑·키오스크 → backend(ainteams) JWT). 그래서 봉인해 둘 ID 토큰이 Space 에는 없고,
대신 **같은 사용자의 ID 토큰을 봉인해 둔 Teams** 가 위임을 발급한다(`src/lib/ain-integration/teams-delegation.ts`).

- env `AIN_TEAMS_DELEGATION_URL`(Teams backend `…/api/ain/delegation`, https — http 는 localhost 만). 없으면 예전 경로:
  `getSessionProof` 는 운영에서 항상 null → 파일을 넘기는 호출은 `auth_required` + AIN SSO 연결 actionUrl.
- 계약(양쪽이 정확히 맞아야 한다): `POST {url}`, `Authorization: Bearer <Space 클라이언트가 이미 든 Teams JWT>`(= 이 요청의 bearer,
  Space 가 먼저 검증), 바디 `{ agentRef: AgentRef, fileKeys: string[], conversationContextId, actions: ['read'] }`
  → 200 `{ delegation: { token, exp, jti } }` → `ai.ain/delegation` part(audience = 파일 issuer).
  오류: 401 `auth_required`(Teams 의 actionUrl 전달, 없으면 `AIN_SSO_CONNECT_URL`) · 403 `forbidden`(사용자의 aindrive 연결로 볼 수
  없는 fileKey) · 404 → 503 `teams_delegation_disabled`(Teams 플래그 off) · 429 `rate_limited` · 그 밖 `temporary_failure`.
- 이 경로에서는 Space 가 SSO 를 직접 부르지 않는다(`AIN_SSO_CLIENT_ID/SECRET` 불필요). Teams JWT·위임 토큰·Teams 의 문장은 로그·응답에
  싣지 않는다. Space 도 먼저 호출자의 aindrive 로 파일을 해석한다(볼 수 없으면 Teams 를 부르기 전에 `forbidden`).
- 테스트: `src/app/api/ain/villages/teams-delegation-e2e.test.ts`(진짜 HTTP 가짜 Teams 서버 — 마을 자료·고른 파일이 에이전트에 도착).
- 개발 전용 `AIN_SESSION_PROOF_FILE` 은 그대로(production 무시).

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
  → 호출자의 위임(B: Teams 발급) → 같은 file-refs part·같은 idempotencyKey. `AIN_TEAMS_DELEGATION_URL` 이 없는 배포에서는
  자료가 하나라도 있으면 고른 파일과 마찬가지로 `auth_required` 로 끝난다(자료를 조용히 빼고 부르지 않는다). `agent` 자료도 호출자가
  aindrive 에서 볼 수 있어야 넘어간다(에이전트 전용 공유 계정으로 대신 해석하지 않는다).
- 클라이언트: `useAinVillagePresence`(MapTab) 가 로그인 상태로 마을에 들어가면 presence `PUT`, 5분마다 갱신, 떠나면(다른 마을·마을 밖·
  pagehide keepalive) `DELETE`. 마을 소유자는 "전시·마을" 패널(`components/village/VillageAinPanel.tsx`)에서 멤버를 넣고 뺀다.

## 17.3 소유권 변경

- StoredAgent `ainOwnerKey`(배치를 받아들인 소유자 `kind:issuer#subject`) · `ainOwnerChange`(재확인 대기 `{from,to,detectedAt}`).
- 관찰은 서버가 Ainize 레지스트리에서: `POST /api/ain/events/apply` 의 `agent.updated`/`agent.moved`(이 제품에 배치된 것만 재조회,
  응답 `ownerChanges`)와 invoke 의 resolve. 첫 관찰은 기준만 기록, 원래 소유자로 돌아오면 표시 해제.
- 대기 중: **배치 유지**, 마을 자료는 넘기지 않는다(`agent_not_placed_in_village`), 일반 대화는 된다.
- `GET /api/ain/villages/:slug/agents`(마을 소유자) → 배치된 공유 에이전트와 `ownerChange`; `POST {agentKey, decision:'confirm'}` → 재확인.
  패널에 "소유자가 바뀐 에이전트 — 재확인" 으로 나온다.

## 17.4 작품·전시 자료

- 마을 자료에 `exhibition: true` 를 붙인 것이 전시 자료. `PUT /api/ain/villages/:slug/materials {fileKey, audience: public|members, exhibition: true}`
  와 전시 자료의 변경·`DELETE` 는 **마을 소유자만**(일반 자료는 멤버). 패널에서 기존 "공유 파일" 선택기로 고른다.
- `GET /api/ain/villages/:slug/exhibition` → `{viewer, isOwner, items:[{ref, audience, addedAt, availability}], actionUrl?}` —
  가용성은 **보는 사람의** aindrive 로 다시 확인: available · offline · deleted · forbidden(여는 위치 비노출) · unknown(미연결이면 연결 actionUrl).

## 17.6 contextId 경계

`conversationContextId = ctx:<account>:<org>:ainspace:<room>:<conversation>`. `villageConversationId(slug, agentKey[, thread])` 는
(마을, 에이전트, 스레드)로 결정적이라 재입장·재시작 후에도 같은 방문자는 같은 contextId, 다른 방문자는 account 조각이 달라
섞이지 않는다. 테스트: `src/lib/ain-integration/village-context.test.ts`(동시 호출·재시작 포함).

## 17.7 자산 인벤토리·이관

`docs/ain-asset-migration.md`.
