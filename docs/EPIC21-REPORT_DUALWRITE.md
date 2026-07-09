# EPIC21 - REPORT_DUALWRITE (리포트 이중 기록)

> ainspace 에서 사용자가 메시지를 보내고 공유 backend(NestJS DM)로부터 에이전트 응답을 받을 때, ainspace 가 **그 대화 턴을 별도 서비스인 a2a-orchestrator 의 ingest 엔드포인트에도 함께 POST**한다. orchestrator 는 리포트/애널리틱스 저장소(자체 Redis + T3C 리포트 파이프라인)를 소유하며, ainspace 가 자기 자신이 진행한 턴만 이중 기록함으로써 "무엇이 ainspace 대화인가"의 권위를 갖게 된다. **공유 backend 는 리포트를 전혀 모른다(코드·DB 마킹 없음).** 이중 기록은 **best-effort** — 실패해도 채팅 UX 를 절대 막지 않는다.

## 의존성
- EPIC13 (JWT auth) / EPIC14 (backend DM conversation + SSE stream) / EPIC15 (DM create + agent-mapping) / EPIC16 (agent list sync — `StoredAgent.backendUuid`, agent 명부 materialize)
- 인접 EPIC17~20 (agent import / kiosk / auth recovery / email login) — 본 EPIC 은 이들과 파일이 거의 겹치지 않는다(§주의사항 참조).
- **인터-레포 계약(입력):** a2a-orchestrator EPIC8 — `POST /api/ingest/conversation` (아래 §계약).
- 사회적 계약: **"ainspace 에서 말한 것은 공개·집계 대상"** — 리포트 대상은 오직 ainspace 대화. provenance 는 **send 시점**에 결정되며, ainspace 가 자기 턴만 orchestrator 로 이중 기록하는 행위 자체가 곧 "이 대화는 ainspace 대화"라는 표식이다. backend DB 에 별도 provenance 마킹을 두지 않는다.

## 배경

### 현재 send 플로우 (본 EPIC 의 hook 지점)
ainspace 의 채팅은 **송신(요청/응답)과 에이전트 응답(SSE)이 분리**되어 있다.

1. **사용자 턴 송신** — `src/components/chat/ChatBox.tsx:536` 에서 `bffAuthFetch('/api/thread-message', { message, threadId })` POST. BFF(`src/app/api/thread-message/route.ts:36`)가 backend `POST /dm/:id/messages` 로 프록시하고, backend 가 내부적으로 오케스트레이션까지 트리거한다. 이 응답은 `{ success, threadId }` 뿐 — **사용자 메시지의 backend canonical id 를 돌려주지 않는다.**
2. **에이전트 턴 수신** — 응답은 SSE 로 도착한다. `src/components/chat/ChatBox.tsx:196-292` `handleStreamEvent`, 특히 `event.type === 'message'` 분기(`:207-244`). payload 는 `{ id, speaker, content, userId }` — `speaker` = 에이전트 표시명, `userId` = 에이전트의 backend user UUID(= `StoredAgent.backendUuid`). **a2aUrl 은 SSE 에 실려오지 않는다.**
3. **thread 생성** — 새 스레드는 먼저 `POST /api/threads` 로 backend DM 을 만들고(`ChatBox.tsx:492`), 반환된 `Thread.id`(= backend conversationId)를 threadId 로 사용한다.

즉 하나의 "라운드트립 이후" 지점이 존재하지 않고, **사용자 턴은 송신 성공 시점에**, **에이전트 턴은 각 SSE `message` 이벤트 시점에** 각각 관측된다. 이중 기록도 이 두 지점에서 각각 일어난다. orchestrator ingest 는 메시지 id 기준 **멱등**(재-POST 시 skip)이고 배열을 받으므로, 턴 단위로 나눠 보내도 안전하다.

### 식별자 가용성 (조사 결과)
> **원칙(coordinator 정정): "backend identity" = 공유 backend 의 canonical row id 들**(ainspace 가 auth 를 위해 *이미* 보유하는 backend id) — **지갑주소가 아니다.** 목적은 orchestrator 레코드를 나중에 공유 backend 와 상호참조(relocation/reconcile)하고 정확히 귀속시키기 위함.

- **사용자 identity** — `thread.userId` = **backend user id**(= backend `users.id`). ainspace 는 이를 `useUserStore.backendUser.id`(`BackendUser { id, displayName, ainAddress }`, `src/types/backend.ts:4`)로 이미 보유한다. **가용.** `getUserId()`(`ChatBox.tsx:86`)가 반환하는 `address ?? sessionId`(지갑주소, `useUserStore.ts:53-56`)를 **쓰지 않는다** — 반드시 `backendUser.id`.
- **에이전트 identity — 두 id 를 모두 실어야 한다: `a2aUrl`(canonical A2A id, 리포트 필터가 사용) + `backendAgentId`(에이전트의 backend `users.id`).** `name` 과 함께 **둘 다** 보존.
  - send 시점: 새 스레드는 `nearbyAgents`(`AgentState[]`, `.name`+`.agentUrl`=a2aUrl 보유, `ChatBox.tsx:443,483`). `backendAgentId` 는 `AgentState.backendUuid`(EPIC16 sync 로 채워지는 backend user UUID, `agent.ts:9-12`) — **optional 이라 sync 전이면 비어있을 수 있음(FLAG).** 기존 스레드 선택 시엔 `selectedThread.agentNames`(이름만; `Thread` 타입에 url/id 없음, `src/types/thread.ts:1-10`)라 a2aUrl·backendUuid 를 **로컬 agent store 에서 해석**.
  - SSE 턴 시점: `message` payload 의 `userId` 가 곧 **에이전트의 backend user UUID(= backendAgentId)** 이고 `speaker` 가 표시명. 즉 **에이전트 턴에선 backendAgentId 가 SSE 로 직접·안정적으로 온다.** `a2aUrl` 은 `messageData.userId → StoredAgent.backendUuid → StoredAgent.url(a2aUrl)` 로 로컬 해석(이름 매칭 fallback). send 시점에 `backendUuid` 가 비어있던 에이전트도 SSE `userId` 로 backfill 가능.
- **메시지 id/타임스탬프** — 메시지 레벨 backend id 는 **불필요**(귀속은 사람=`thread.userId`, 에이전트=`speaker→agents[].backendAgentId` 로 충분). ingest id 는 스레드 내 고유·안정이면 됨: 에이전트 턴 = `messageData.id`, 사용자 턴 = optimistic `newMessage.id`(`ChatBox.tsx:425`, thread-message POST 가 canonical id 를 안 돌려줌). 타임스탬프 = epoch **ms**(`Date.now()`).

### conversationId ↔ threadId 매핑
ainspace 는 backend conversationId 를 **그대로** thread id 로 쓴다(`Thread.id` = backend DM id). 계약도 `thread.id == orchestrator thread id` 로 규정한다. 따라서 **기본 매핑은 identity**(`orchestrator threadId = backend conversationId`)다. 다만 향후 relocation(리포트가 공유 backend + Notion 으로 이동) 대비 **매핑을 한 모듈에 캡슐화**하고, 별도 변환이 필요해질 경우를 위한 hook 만 남긴다. 이 상태는 **ainspace-side**(모듈 상수/필요 시 localStorage) 로만 두고 **공유 backend 에 저장하지 않는다.**

### sovereignty 예외 (명시)
orchestrator 리포트 파이프라인은 외부 OpenAI/Azure 임베딩을 사용한다. 본 EPIC 범위에서 **데이터 sovereignty 는 운영자가 명시적으로 waive** 했다 — 차단 요소로 취급하지 않는다. (리포트 산출물은 현재 markdown 이며, 추후 공유 backend + Notion 으로 이전 가능한 **과도기적·실용적 배치**다. 그래서 이중 기록을 느슨하게 결합해 relocation 비용을 낮춘다.)

## 목표
- ainspace 가 진행한 대화 턴(사용자 + 에이전트 응답)을 backend 라운드트립 이후 orchestrator ingest 로 **이중 기록**한다.
- 이중 기록은 **best-effort** — 실패/타임아웃이 사용자 채팅을 막거나 에러 버블을 띄우지 않는다(리포트 복제본은 eventually-consistent).
- 공유 backend 코드/DB/응답을 **일절 건드리지 않는다.**
- INGEST_TOKEN 등 시크릿은 브라우저에 노출하지 않는다 — 기존 BFF 패턴대로 서버(라우트)에서만 보유.
- 오직 ainspace 가 진행한 턴만 기록(provenance = send 시점).

---

## Story 21.1: ingest 계약 타입 + orchestrator 클라이언트 config

**수정 파일:** `src/lib/backend/config.ts`, `src/types/report.ts`(또는 신규 `src/types/ingest.ts`)

### 배경
이중 기록의 대상 URL·토큰과 요청/응답 타입을 한 곳에 정의한다. 기존 config 패턴(`src/lib/backend/config.ts` — 서버 전용 `process.env.X ?? ''` + `isXConfigured()` 게이트, 브라우저 미노출)을 그대로 따른다. `INGEST_TOKEN` 은 **절대 `NEXT_PUBLIC_` 아님** — 브라우저가 아니라 BFF 라우트(Story 21.4)가 헤더에 싣는다.

> 주의: 기존 `src/lib/report.ts` 의 `REPORT_API_BASE_URL`(`DEMO_REPORT_URL || NEXT_PUBLIC_A2A_ORCHESTRATION_BASE_URL`)은 **리포트 조회(read)** 용이며 client-exposed 다. 이중 기록(write)은 이와 별개의 서버 전용 config 로 둔다(토큰 노출 방지).

### 참고 파일
- `src/lib/backend/config.ts` — `BACKEND_BASE_URL`/`isBackendConfigured()` 패턴
- `src/types/report.ts` — 기존 리포트 타입(참고용, 조회 shape)
- `src/types/thread.ts:12` — 이미 존재하는 `ThreadInOrchestration`(리포트향 이전 groundwork)

### 태스크
- [x] `config.ts` 에 서버 전용 추가: `ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? ''`, `INGEST_TOKEN = process.env.INGEST_TOKEN ?? ''`, `isReportIngestConfigured = () => ORCHESTRATOR_URL.trim().length > 0 && INGEST_TOKEN.trim().length > 0`
- [x] `.env.example` 에 `ORCHESTRATOR_URL=` / `INGEST_TOKEN=` 주석과 함께 추가(값 없이). 둘 다 서버 전용임을 주석 명기.
- [x] ingest 계약 타입 정의(계약과 1:1):
  - `IngestThread { id: string; name?: string; userId: string; agents: IngestAgent[] }` — `id` = backend conversationId, `userId` = backend `users.id`.
  - `IngestAgent { name: string; a2aUrl: string; backendAgentId?: string; role?: string; color?: string }` — `a2aUrl`(canonical, 필터용) + `backendAgentId`(backend `users.id`, reconcile용) 둘 다 보존. **주의: 계약(a2a-orchestrator EPIC8) agents[] 정식 필드엔 `backendAgentId` 가 없다** — orchestrator 가 현재는 무시할 수 있는 **additive 필드**로 실어 보낸다(향후 backend 상호참조용). orchestrator 측 수용은 별 조율.
  - `IngestMessage { id: string; speaker: string; content: string; timestamp: number; senderA2aUrl?: string; replyTo?: string; status?: 'accepted' | 'dropped' }`
  - `IngestPayload { thread: IngestThread; messages: IngestMessage[] }`
  - `IngestResponse { ok: boolean; threadId: string; ingested: number; skipped: number }`

### 주의사항
- `INGEST_TOKEN` 을 `NEXT_PUBLIC_` 로 만들면 sovereignty 이전에 **토큰 유출**. 반드시 서버 전용.
- `isReportIngestConfigured()` false 면 이중 기록 전체를 **no-op 로 degrade**(로그도 시끄럽지 않게) — 폐쇄망/미설정 환경에서 채팅은 그대로 동작.

---

## Story 21.2: conversationId ↔ threadId 매핑 (ainspace-side)

**수정 파일:** `src/lib/report/thread-mapping.ts`(신규)

### 배경
계약상 `thread.id == orchestrator thread id` 이고 ainspace 는 backend conversationId 를 그대로 threadId 로 쓰므로, **기본 매핑은 identity**다. 그러나 relocation 대비 매핑을 한 함수 뒤에 캡슐화해 호출부가 conversationId 를 직접 쓰지 않게 한다. 상태는 ainspace-side 로만.

### 태스크
- [x] `export function orchestratorThreadId(conversationId: string): string` — 기본 구현은 `return conversationId`(identity). 향후 변환이 필요하면 이 함수만 교체.
- [x] (선택) 비-identity 매핑이 필요해질 때를 위한 localStorage 기반 조회/저장 헬퍼 stub 만 주석으로 남긴다. **backend 저장 금지.**

### 주의사항
- 이 매핑을 **공유 backend 에 저장하는 어떤 코드도 추가 금지** — invariant.
- identity 매핑이므로 지금은 사실상 pass-through 지만, 호출부가 이 함수를 반드시 경유하게 해 relocation 시 단일 변경점 유지.

---

## Story 21.3: ingest 페이로드 빌더 (턴 → 계약 shape)

**수정 파일:** `src/lib/report/build-ingest-payload.ts`(신규)

### 배경
관측된 턴(사용자/에이전트)과 로컬 identity 로부터 계약 `IngestPayload` 를 조립하는 순수 함수. speaker 규칙·타임스탬프 ms·a2aUrl 해석을 여기에 모은다(테스트 용이).

### 참고 파일
- `src/components/chat/ChatBox.tsx:216-240`(SSE message shape), `:86`(userId), `:443,483`(nearbyAgents)
- `src/stores/useUserAgentStore.ts`(`getAgentByUrl`, `StoredAgent.url`/`.backendUuid`) — 에이전트 a2aUrl 해석 소스
- `src/lib/agent.ts:4-13`(`AgentInfo`: `name`/`agentUrl`/`backendUuid`)

### 태스크
- [x] `buildIngestPayload(input)` — input: `{ conversationId, threadName?, user: { backendUserId }, agents: {name, a2aUrl, backendAgentId?}[], turns: Turn[] }`. 라운드트립 이후 ainspace 가 **이미 보유한 backend id 들**(conversationId, backend userId, per-agent backendAgentId + a2aUrl)을 뽑아 넣는 것이 핵심.
- [x] `thread.id` = **backend conversationId**(`orchestratorThreadId()` 경유). `thread.userId` = **backend `users.id`**(`useUserStore.backendUser.id`) — **지갑주소·display name 아님.**
- [x] `thread.agents[]`: `name`(스레드 내 유니크) + `a2aUrl`(필수) + `backendAgentId`(가능하면) **셋 다**. **에이전트 턴 `speaker` 와 동일 소스에서 name 을 뽑아** 매칭이 깨지지 않게(backend 가 표시명을 suffix 할 수 있음 — `agent.ts:9-12`).
- [x] **speaker 매핑(계약 규칙 정확히):**
  - 사용자 턴 → `speaker: 'User'`(정확히 이 문자열), `senderA2aUrl` 없음. 사람 귀속은 `thread.userId`(backend userId)로 충분(메시지 레벨 backend id 불요).
  - 에이전트 턴 → `speaker = 에이전트 표시명`(= `agents[].name` 일치), `senderA2aUrl = 그 에이전트의 a2aUrl`. 에이전트 귀속은 `speaker → agents[].backendAgentId` 로 backend 상호참조.
- [x] **timestamp = epoch ms**(`Date` → `.getTime()`, `Date.now()`).
- [x] id 해석: 에이전트 턴은 SSE `messageData.userId` 가 곧 `backendAgentId` → 이걸로 `StoredAgent.backendUuid` 매칭해 `a2aUrl`(`StoredAgent.url`) 획득(이름 fallback). 어느 것도 못 구하면 해당 에이전트를 `agents[]`/`senderA2aUrl` 에서 **best-effort 로 생략**(전체 실패로 만들지 않음).

### 주의사항
- speaker 문자열 `'User'` 는 계약상 exact match — 오타/케이스 금지.
- `agents[].name` ↔ 에이전트 턴 `speaker` 불일치 시 orchestrator 가 매칭 못함 → 반드시 같은 소스.

---

## Story 21.4: 이중 기록 BFF 라우트 (토큰 서버 보관)

**수정 파일:** `src/app/api/report-ingest/route.ts`(신규)

### 배경
`INGEST_TOKEN` 을 브라우저에 노출하지 않기 위해, 이중 기록도 기존 BFF 패턴(브라우저 → Next 라우트 → 외부, 시크릿은 라우트가 주입)을 따른다. 브라우저는 조립된 페이로드를 이 라우트에 POST 하고, 라우트가 `Authorization: Bearer <INGEST_TOKEN>` 을 붙여 orchestrator 로 프록시한다.

### 참고 파일
- `src/app/api/thread-message/route.ts` — BFF 프록시 패턴(getBearer/forward status)
- `src/app/api/reports/route.ts` — 외부 리포트 서버 프록시 패턴(config 미설정 시 degrade)

### 태스크
- [x] `POST /api/report-ingest` — body = `IngestPayload`.
- [x] `isReportIngestConfigured()` false → **200 `{ ok:false, skipped:true }` 로 조용히 no-op**(클라가 실패로 취급하지 않도록). 채팅 흐름 무영향.
- [x] `fetch(`${ORCHESTRATOR_URL}/api/ingest/conversation`, { method:'POST', headers:{ Authorization:`Bearer ${INGEST_TOKEN}`, 'Content-Type':'application/json' }, body })`.
- [x] orchestrator 응답 상태/JSON 을 forward하되, 상류 에러도 **채팅을 막지 않는 형태**로 반환(클라는 결과를 무시할 수 있음).
- [x] 이 라우트는 사용자 backend 세션과 무관(orchestrator 는 별 서비스·별 토큰) — backend Bearer 를 요구하지 않는다.

### 주의사항
- orchestrator 는 backend 와 별개 인증 도메인 — backend JWT 를 여기로 보내지 않는다.
- 라우트 자체가 시크릿 게이트: 미설정이면 존재하지만 no-op.

---

## Story 21.5: ChatBox 이중 기록 hook (best-effort, fire-and-forget)

**수정 파일:** `src/components/chat/ChatBox.tsx`, `src/lib/report/dual-write.ts`(신규 — 클라 헬퍼)

### 배경
관측 두 지점에서 이중 기록을 건다: (1) 사용자 턴 송신 성공 직후, (2) 각 에이전트 SSE `message` 이벤트. 두 경우 모두 **fire-and-forget** — `void dualWriteTurn(...)`, await 하지 않으며 `.catch()` 로 조용히 삼킨다(Sentry breadcrumb 정도만). 채팅 상태(`isMessageLoading`, 메시지 렌더, 타임아웃)에 **어떤 영향도 주지 않는다.**

### 참고 파일
- `src/components/chat/ChatBox.tsx:536-557`(사용자 턴 송신 성공 지점), `:207-244`(에이전트 SSE message 분기), `:86`(userId), `:443,483`(nearbyAgents/agentUrls)
- `src/stores/useUserAgentStore.ts` — 에이전트 a2aUrl 해석
- `src/stores/useUserStore.ts` — `backendUser`(canonical userId)

### 태스크
- [x] `dual-write.ts`: `export function dualWriteTurn(payload: IngestPayload): void` — 내부에서 `void fetch('/api/report-ingest', ...).catch(() => {})`. 절대 throw 하지 않음.
- [x] **사용자 턴 hook** — `ChatBox.tsx` 의 thread-message POST 가 `response.ok`(`:549` 이후)일 때, Story 21.3 빌더로 사용자 턴 페이로드 조립 후 `dualWriteTurn` 호출. `thread.userId`/`agents[]` 는 현재 스레드 컨텍스트(new: `nearbyAgents`, 기존: 선택 스레드 + store 해석)에서 얻는다. ingest id = optimistic `newMessage.id`.
- [x] **에이전트 턴 hook** — `handleStreamEvent` 의 `event.type === 'message'` 렌더 직후(`:241` 부근), 같은 payload 빌더로 에이전트 턴 조립 후 `dualWriteTurn`. ingest id = `messageData.id`, `senderA2aUrl` = store 해석.
- [x] 이중 기록은 `isReportIngestConfigured` 여부를 클라가 몰라도 됨 — 라우트가 no-op 하므로 클라는 항상 호출만.
- [x] backend 세션이 없거나(guest) send 자체가 안 되는 경로에서는 애초에 hook 도 안 탄다(기존 send 가드 `:342` 재사용).

### 주의사항
- **절대 await 금지, 절대 throw 전파 금지** — 리포트 복제가 채팅을 막으면 안 됨(핵심 invariant).
- SSE 는 다른 클라이언트(ainteams)가 트리거한 응답도 흘려보낸다(`:300-303` enabled 주석). 그런 턴까지 무차별 이중 기록하면 "ainspace 가 진행한 턴만" 위배 가능 → **ainspace 가 방금 이 스레드에서 send 한 세션에 한해** 에이전트 턴을 기록하도록 게이트(예: 직전 send 의 threadId + 진행 플래그)를 둔다. (판단 근거: provenance = ainspace 가 실제로 진행한 대화.)
- 사용자 턴 id 가 backend canonical 이 아니라 optimistic id 인 점은 멱등성에 무해(스레드 내 유일하면 됨). 단 같은 사용자 메시지를 재전송하면 새 optimistic id → orchestrator 가 새 메시지로 취급(정상).

---

## 구현 규칙

### 데이터 흐름 방향
- 리포트 데이터 흐름은 **ainspace → orchestrator 단방향**. orchestrator → ainspace 는 없음(리포트 조회는 별개의 기존 read 경로).
- ainspace ↔ backend 는 메시지 send/수신뿐. backend 는 리포트를 모른다.

### 식별자 (backend id 보존이 핵심)
- `thread.id` = backend **conversationId**(identity 매핑, `orchestratorThreadId()` 경유).
- `thread.userId` = backend **`users.id`**(`backendUser.id`) — **지갑주소·display name 아님.**
- 각 에이전트 = `name` + `a2aUrl`(canonical, 필터용) + `backendAgentId`(backend `users.id`, reconcile용) **셋 다**.
- 사용자 speaker = `'User'`(exact). 에이전트 speaker = 표시명(= `agents[].name`), `senderA2aUrl` = a2aUrl.
- timestamp = epoch **ms**.
- 목적: orchestrator 레코드를 나중에 공유 backend 와 상호참조(relocation/reconcile)·정확 귀속하기 위해 backend id 를 보존.

### 결합도
- 이중 기록은 loosely coupled — BFF 라우트 + 빌더 + fire-and-forget 헬퍼로 격리해 relocation(→ 공유 backend + Notion) 시 변경점을 좁게 유지.

## 금지사항
- 공유 backend 코드/DB/스키마/응답 **일절 수정 금지**(리포트 코드·provenance 마킹 포함).
- conversationId↔threadId 매핑을 **공유 backend 에 저장 금지**(ainspace-side only).
- `INGEST_TOKEN` 을 `NEXT_PUBLIC_`/브라우저 노출 **금지**(BFF 라우트가 주입).
- 이중 기록을 **await 하거나 실패를 채팅 UX 로 전파 금지**(best-effort invariant).
- ainspace 가 진행하지 않은 턴(타 클라이언트 트리거)을 무차별 기록 **금지**.
- **backfill 금지 / 리포트 UI 금지 / read 경로 변경 금지**(§비목표).

## 비목표 (Non-goals)
- **backfill 없음** — 과거 대화를 소급 ingest 하지 않는다. 본 EPIC 이후 진행된 턴만.
- **backend 변경 없음** — 어떤 마이그레이션·엔드포인트·마킹도 backend 에 추가하지 않는다.
- **리포트 UI 범위 밖** — 리포트 렌더/조회는 ainspace-report 레포 책임. 본 EPIC 은 write(ingest)만.
- **T3C 파이프라인·임베딩 구현 범위 밖** — orchestrator 소관. sovereignty waive 는 운영자 수용사항.

## 완료 조건
> 아래는 **로컬 orchestrator 연동 런타임 검증 필요**(구현 후 체크).
- [ ] `ORCHESTRATOR_URL`/`INGEST_TOKEN` 설정 시, ainspace 에서 메시지를 보내면 사용자 턴이 `POST /api/ingest/conversation` 으로 기록된다(`ok:true`, `ingested≥1`).
- [ ] 에이전트 SSE 응답이 도착하면 각 에이전트 턴이 `speaker=표시명`+`senderA2aUrl` 로 기록된다.
- [ ] 같은 메시지 id 재-POST 는 orchestrator 에서 `skipped` 로 멱등 처리된다.
- [ ] `thread.userId` = backend `users.id`(지갑주소/display-name 아님), `agents[]` 에 `a2aUrl` + (가능하면) `backendAgentId` 가 채워진다.
- [ ] 미설정(`isReportIngestConfigured` false) 환경에서 채팅이 완전히 정상 동작하고 이중 기록은 조용히 no-op 한다.
- [ ] orchestrator 를 죽여도(연결 실패/타임아웃) 채팅 send·응답·로딩 상태에 **회귀 없음**(에러 버블 없음).
- [x] 공유 backend 코드/DB 에 변경이 없다(diff = ainspace 프론트만).
- [x] `nvm use 22 && yarn build` 통과.
