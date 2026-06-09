# Agent 목록 동기화 설계 (Agent List Sync)

> 작성일: 2026-06-09
> 선행: EPIC13/14/15 (DM/chat backend 마이그레이션) 완료. 백엔드 계약은
> `a2a-slack-notion/docs/integration/ainspace-agent-sync.md` 및
> `docs/ainspace-integration-guide.md` 참조.

## 1. 목표 / 범위

ainspace 가 teams(공유 백엔드 NestJS)의 **workspace agent 명부를 pull 동기화**하되,
**에이전트의 좌표·배치여부·sprite 등 게임 배치 정보는 기존처럼 Redis 에서 관리**한다.

- 백엔드 = "어떤 agent 가 존재하는가"의 권위 (active workspace 멤버, 소유자, status, a2aUrl, card)
- Redis = 각 agent 의 배치 오버레이 (x/y/isPlaced/mapName/movementMode/spawn, sprite, full card)

**범위 안:** agent 목록을 백엔드에서 당겨와 Redis StoredAgent 로 정합(upsert)하고, AgentTab
"My Agents" 목록에 반영. 비활성 agent disabled 표시. 수동 새로고침.

**범위 밖:** 맵 렌더 경로(`GET /api/agents?villages=`), import(`POST`)·place(`PUT`) write 경로,
agent 생성/초대 흐름의 백엔드 이전, 사람 메시지 실시간 동기화.

## 2. 핵심 결정 (확정)

| # | 결정 | 근거 |
|---|---|---|
| 1 | **권위 = Union.** 백엔드 명부 ∪ Redis. 죽은 agent 는 chat 시 백엔드가 `404 agent unavailable` 반환하므로 표시해도 안전 | agent-sync.md "Stale 목록 처리" |
| 2 | **소비 분리.** 맵 렌더 = Redis 배치본만(`?villages=` 불변) / AgentTab 인벤토리 = 동기화된 StoredAgent | 기존 UI 구조 |
| 3 | **A안 = BFF 서버사이드 동기화 엔드포인트.** DM 마이그레이션의 BFF 병합 패턴 재사용 | EPIC14/15 |
| 4 | **join 키 = 정규화 `a2aUrl` ↔ `backendUuid(id)`** + `setAgentBackendUuid` backfill | EPIC15 `agent-mapping.ts` |
| 5 | **명부를 별도 캐시로 두지 않고 StoredAgent 로 materialize.** roster 구조 없음 | 단일 데이터 모델 유지, AgentTab 읽기 경로 불변 |
| 6 | **AgentTab 스코프 = 내 것만** (`agentInvitedBy === 내 backend userId`) + Redis `creator === 내 지갑` | agent-sync.md 소유 정보 |
| 7 | **pull cadence = 30분 + 수동 새로고침 버튼** | 사용자 결정 |
| 8 | **workspaceId = `BACKEND_WORKSPACE_ID`(config)** | 토큰에 미포함 (agent-sync.md) |

## 3. 데이터 모델 (Redis 포맷 변경)

### StoredAgent (변경 최소)
```ts
// key: agents:<base64(url)>  — 기존 그대로
interface StoredAgent {
  url: string;            // a2aUrl (전역 유일 키) — 기존
  card: AgentCard;        // 기존. materialize 시 부분({name: displayName}), 배치 시 full 갱신
  state: AgentStateForDB; // 기존 (배치 정보)
  spriteUrl?, spriteHeight?; // 기존 (게임 sprite, Redis 소유)
  isPlaced: boolean;      // 기존
  creator: string;        // 기존 (지갑 주소)
  timestamp: number;      // 기존
  backendUuid?: string;   // 기존 (EPIC15, a2aUrl 매칭 캐시)
  backendStatus?: 'active' | 'inactive'; // 🆕 pull 때 갱신, disabled 판정용
}
```

### 신규 키
```
agents_sync:{wallet}  →  number   // lastSyncedAt (30분 cadence 게이트)
```

### 불변
- `user:{wallet}:placed_agents` 해시 (배치 카운트/권한)
- 맵 렌더 조회 경로 `GET /api/agents?villages=` (isPlaced + mapName 필터)

**별도 roster 캐시 키는 두지 않는다.** pull 시점에 백엔드 목록을 손에 쥔 채 Redis 와
정합하고, disabled 판정 결과를 `backendStatus` 에 박아두므로 읽기 시점엔 백엔드 호출 불필요.

## 4. 컴포넌트 / 데이터 흐름

### 4.1 동기화 엔드포인트 (BFF, 신규)
`GET /api/agents/sync?address=<wallet>&refresh=<0|1>`

read-through 캐시 의미: 호출하면 stale(또는 `refresh=1`)일 때만 백엔드를 pull 해 Redis 를
정합하고, **항상 내 StoredAgent[] 를 반환**한다(AgentTab 이 추가 조회 없이 바로 사용).

```
1. token = getBearer(req); 없으면 401
2. workspaceId = BACKEND_WORKSPACE_ID; 미설정이면 500
3. myUserId = token 의 `sub` claim (BFF 서버사이드 디코드)
4. lastSyncedAt = redis.get(agents_sync:{wallet})
5. if (refresh !== '1' && now - lastSyncedAt < 30분):
     → skip pull (이미 최신)
   else:
     a. roster = backendFetch(token, `/agents?workspaceId=${workspaceId}`)
     b. mine = roster.filter(a => a.agentInvitedBy === myUserId)
     c. local = getAgents().filter(a => a.creator === wallet)
     d. 정합(upsert) — §4.2
     e. redis.set(agents_sync:{wallet}, now)
6. return { success: true, agents: getAgents().filter(a => a.creator === wallet) }
```

> 메서드는 `GET` (read-through; 부수효과는 stale 일 때의 캐시 갱신뿐). 매 호출마다 무조건
> 쓰는 게 아니라 cadence 게이트로 pull 을 제한하므로 GET 으로 둔다.

`wallet` 은 클라이언트가 쿼리/헤더로 전달(기존 `?address=` 와 동일 소스). `myUserId` 는 토큰
`sub` 에서 서버가 디코드 — 둘은 동일인.

### 4.2 정합(upsert) 규칙 (pull 1회)
- **roster(mine) 각 항목 `b`:**
  - normalize(b.a2aUrl) 로 local StoredAgent 매칭
  - 매칭됨 → `backendUuid = b.id`, `backendStatus = b.status==='active'? 'active':'inactive'` 갱신
  - 없음 → **default StoredAgent 생성**:
    `{ url: b.a2aUrl, card: { name: b.displayName }, state: <기본값>, isPlaced: false,
       creator: wallet, timestamp: now, backendUuid: b.id, backendStatus: 'active' }`
- **local StoredAgent 중 roster(mine) 에 없는 것** → `backendStatus = 'inactive'` (disabled)
- a2aUrl 정규화: `agent-mapping.ts` `normalizeA2aUrl` 재사용 (소문자/끝슬래시/`.well-known` 제거)
- a2aUrl 없는 roster 항목 → `agentCardJson.url` fallback, 그래도 없으면 skip (매칭 불가)

### 4.3 AgentTab (읽기 — 거의 불변)
- 마운트 시 `GET /api/agents/sync`(stale 면 내부 pull) 호출 후 `useUserAgentStore` 적재
- **수동 새로고침 버튼** 추가 → `GET /api/agents/sync?refresh=1`
- `ImportedAgentCard` 에 `backendStatus==='inactive'` 면 **disabled 표시**(회색 + place/대화 비활성, 안내 툴팁)

### 4.4 배치 시 full card (불변 + 보강)
- backend-only(부분 card) agent 를 배치할 때 기존 import 로직 재사용:
  `/api/agent-proxy` 로 a2aUrl 에서 full AgentCard fetch → `PUT /api/agents` 로 Redis 갱신
- fetch 실패 시 백엔드 `agentCardJson` fallback

## 5. 식별자 / 소유 매핑

| 영역 | 식별자 | 비고 |
|---|---|---|
| Redis agent | `url` (a2aUrl) | 전역 유일 키 |
| Redis 소유 | `creator` (지갑) | `?address=` 필터, 배치 권한 |
| 백엔드 agent | `id` (UUID) | = `backendUuid` |
| 백엔드 소유 | `agentInvitedBy` (UUID) | canonical owner. AgentTab 스코프 |
| 호출자 본인 | token `sub` (UUID) = myUserId | `agentInvitedBy === sub` 로 내 것 판정 |

지갑 ↔ backend userId 는 로그인 사용자 본인 안에서 동일인이므로, Redis 는 `creator=wallet`,
백엔드 명부는 `agentInvitedBy=userId` 로 각각 "내 것"을 추려 union 한다.

## 6. 엣지 케이스

- **disabled agent 동작:** AgentTab 에서 회색 표시 + place/대화 비활성(안내). 이미 배치돼 맵에
  있던 것은 그대로 두되(좌표 보존), 대화 시 백엔드 404 로 막힘. unplace 는 허용.
- **a2aUrl 누락 roster 항목:** `agentCardJson.url` fallback, 없으면 동기화 대상에서 제외.
- **부분 card 상태:** 미배치 backend-only agent 는 `card={name}` 만. AgentTab 표시엔 충분, 배치 시 full fetch.
- **pull 실패(백엔드 5xx/네트워크):** 기존 Redis StoredAgent 로 degrade(목록은 보임), `lastSyncedAt` 갱신 안 함 → 다음 호출에 재시도. 사용자에게 새로고침 실패 토스트(선택).
- **동일 agent 다중 사용자:** Redis 는 url 당 단일 StoredAgent. `agentInvitedBy` 소유자만 자기 AgentTab 에서 보므로 충돌 없음.

## 7. 영향 파일

- 신규: `src/app/api/agents/sync/route.ts` (BFF 동기화 엔드포인트)
- 수정: `src/lib/redis.ts` (StoredAgent `backendStatus`, upsert/sync 헬퍼, `agents_sync:{wallet}`)
- 재사용: `src/lib/backend/agent-mapping.ts` (`normalizeA2aUrl`), `server-client.ts` (`getBearer`/`backendFetch`/`sub` 디코드), `config.ts` (`BACKEND_WORKSPACE_ID`)
- 수정: `src/components/tabs/AgentTab.tsx` (sync 호출 + 새로고침 버튼), `ImportedAgentCard.tsx` (disabled 표시), `useUserAgentStore.ts` (필요 시)

## 8. 테스트 관점

- 정합: roster 신규 → default StoredAgent 생성 / 기존 매칭 → backendUuid·status 갱신 / roster 이탈 → inactive
- 스코프: `agentInvitedBy !== myUserId` 인 워크스페이스 agent 는 내 AgentTab 에 안 뜸
- cadence: 30분 내 재호출은 pull skip, `?refresh=1` 은 강제 pull
- disabled: inactive agent 회색 표시, 맵 배치본 좌표 보존
- 불변 회귀: 맵 렌더(`?villages=`), import/place write 경로 그대로 동작
