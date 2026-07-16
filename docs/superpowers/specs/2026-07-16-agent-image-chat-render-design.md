# 에이전트 이미지 답변 — 채팅 렌더 (cross-repo) Design

**작성일:** 2026-07-16
**범위:** 2개 레포 — `a2a-slack-notion` (base backend, NestJS) + `ainspace` (프론트)
**관련:** `a2a-agent-builder` PR #38 (에이전트 전송 포맷 정의; 이 설계는 그걸 건드리지 않음)

## 목표

폼 인텐트에 첨부된 이미지를 에이전트가 A2A `FilePart`로 답변에 실어 보내면(PR #38), 그 이미지를 **ainspace 채팅 창에서 `<img>`로 렌더**한다. 라이브(SSE)와 히스토리(새로고침) 모두에서 보여야 한다.

## 배경 / 현재 상태 (검증된 사실)

에이전트 이미지의 실제 전달 경로:

```
a2a-agent-builder 에이전트
  └─ A2A 응답 parts: FilePart {kind:'file', file:{uri, mimeType, name?}}  (PR #38, GCS 공개 URL)
       ▼
base backend (a2a-slack-notion, NestJS)   ← BACKEND_BASE_URL, /orchestration/dm/:id/stream
       ▼ SSE
ainspace (프론트)  ← thread-stream 프록시 → ChatBox → ChatMessageCard
```

**중요:** ainspace 채팅은 에이전트와 직접 A2A로 대화하지 않고, base backend의 SSE(`/orchestration/dm/:id/stream`)를 바이트 프록시(`ainspace: src/app/api/thread-stream/[threadId]/route.ts`)한다. (별도 `a2a-orchestration` 서비스는 이 경로에 없음 — 레거시 스레드/리포트용.)

현재 문제점(둘 다 수정 필요):

1. **base backend가 이미지를 버린다.** A2A 응답 파서 3곳이 모두 `kind === 'text'`만 추출:
   - `backend/src/domain/shared/a2a-send.ts:88,105` — 단일 에이전트 blocking send (**1:1 DM 주경로**)
   - `backend/src/orchestration/agent/agent.service.ts:237` `parseResponse` — 멀티 에이전트(2명+)
   - `backend/src/domain/shared/a2a-stream.ts` — DM 영속 경로 아님(별도 헬퍼), 이번 범위 밖
   SSE 이벤트(`backend/src/orchestration/orchestration-events.ts:14` `OrchestrationMessageEvent.data`)는 `{ id, conversationId, speaker, userId, content, parentId?, createdAt }` — 파일 필드 없음.

2. **ainspace가 이미지를 받는/렌더하는 필드가 없다.** `ChatMessage`(`src/stores/useChatStore.ts`)에 파일 필드 없음. SSE 파서(`src/components/chat/ChatBox.tsx handleStreamEvent`)와 히스토리 매핑(`src/lib/backend/dm-mapping.ts`)은 `content`만 읽음. `ChatMessageCard`(`src/components/chat/ChatMessageCard.tsx`)는 `message.text`만 렌더.

기존 자산(재사용):

- backend `files` 테이블(`backend/src/db/schema.ts:342`): `{ id, messageId(NN), userId(NN, FK users), fileName(NN), fileUrl(NN), fileSize, mimeType, width, height, createdAt }`.
- `insertAttachmentRows(executor, messageId, userId, IncomingAttachment[])` (`backend/src/domain/shared/attachments.ts:51`) — `url→fileUrl`, `size→fileSize` 매핑, `.returning()`으로 삽입 row 반환.
- DM 히스토리(`backend/src/domain/dm/dm.service.ts:635,640,645` `getMessages`)는 **이미 메시지당 `files[]`(full row)를 반환** — 유저 업로드 첨부에만 채워지고 에이전트 응답엔 비어있음.

## 설계 결정

- **A안 채택 — files 테이블 저장 + SSE에 실음.** 라이브·히스토리 모두 동작, 기존 첨부 인프라 재사용. (B: SSE-only passthrough는 새로고침 시 소실. C: content에 마크다운 삽입은 텍스트 오염/메타데이터 없음 → 기각.)
- **이미지만 렌더.** 백엔드는 모든 FilePart를 `files`에 저장하되, ainspace는 `mimeType`이 `image/*`인 것만 `<img>`로 렌더. 비이미지 파일은 현재 무시(스코프 최소).
- **SSE `data.files`는 저장 row shape와 동일** (`fileUrl`/`fileName`/`mimeType`/…). 프론트는 SSE·히스토리를 **단일 매핑**으로 처리.
- **필수 컬럼 기본값 합성**: FilePart는 `uri`+`mimeType`(+옵션 `name`)만 주므로 → `fileUrl=file.uri`, `fileName=file.name ?? uri basename ?? 'image'`, `mimeType=file.mimeType ?? null`, `fileSize/width/height` 생략(null).
- **`parseAttachments` 우회**: 이 validator는 `size`/`fileName` 없으면 drop하므로, 에이전트 파일은 `IncomingAttachment[]`를 직접 구성(`size: 0`)해서 `insertAttachmentRows`에 전달.
- **도배 방지(dedup)는 이번 범위 밖** — PR #38에서 에이전트(빌더) 측 Redis sent-set으로 이미 처리. ainspace/backend는 받은 것을 그대로 렌더.

## 변경 사항

### 레포 1: `a2a-slack-notion` (base backend)

공용 타입:
- 신규 `AgentResponseFile { uri: string; mimeType?: string; name?: string }` (공유 위치, 예: `backend/src/domain/shared/`).
- `A2ASendResult`(`a2a-send.ts:11`) += `files?: AgentResponseFile[]`.
- `AgentResponse`(`agent.service.ts:27`) += `files?: AgentResponseFile[]`.

파서(텍스트 추출 옆에 `kind==='file'` 분기 추가):
- `a2a-send.ts:88,105` — `parts.filter(p => p.kind==='file')` → `{uri: p.file.uri, mimeType: p.file.mimeType, name: p.file.name}` 매핑, `A2ASendResult.files`에 실음.
- `agent.service.ts parseResponse:237` — 동일, `AgentResponse.files`에 실음.

파일 → 삽입 row 헬퍼 (신규, `attachments.ts`에 추가):
- `toIncomingAgentAttachments(files: AgentResponseFile[]): IncomingAttachment[]` — `parseAttachments` 우회, `fileName`/`size`(0) 합성. `uri` 없는 항목은 제외.

영속 + emit:
- 단일 에이전트 `agents.service.ts sendToAgent`(~:1023): 메시지 insert 후 `response.files?.length`면 `insertAttachmentRows(this.db, agentMessage.id, agent.id, toIncomingAgentAttachments(...))` → 반환 row를 SSE emit(~:1041)의 `files`로 사용.
- 멀티 에이전트 `orchestration.service.ts`(~:334): 동일하게 `agent.userId`로 삽입, emit(~:471 `emitMessageEvent`)에 `files` 전달.
- `OrchestrationMessageEvent.data`(`orchestration-events.ts:14`) += `files?: Array<typeof files.$inferSelect>` (저장 row shape). 두 emitter에서 채움. `emitMessageEvent` 시그니처/호출부에 files 전달 추가.
- **히스토리는 무수정** — `getMessages`가 이미 `files[]` 반환. 위 삽입으로 자동 노출.

주의: 단일 에이전트 insert(`agents.service.ts:1023`)는 트랜잭션 밖 — 파일 insert는 메시지 insert 뒤 별도 statement(비원자적이나 허용).

### 레포 2: `ainspace` (프론트)

타입:
- `ChatMessage`(`src/stores/useChatStore.ts`) += `files?: ChatMessageFile[]`, 신규 `ChatMessageFile { fileUrl: string; mimeType?: string | null; fileName?: string | null; width?: number | null; height?: number | null }`.
- `StreamEvent.data`(`src/lib/a2aOrchestration.ts:29`) += `files?: ChatMessageFile[]` (직접 필드 + 중첩 data 둘 다 커버).

수신(SSE + 히스토리 → 단일 매핑):
- `ChatBox.tsx handleStreamEvent`(:298): `messageData.files`를 읽어 `agentMessage.files`에 세팅.
- 히스토리: `dm-mapping.ts BackendDmMessage`(:34) += `files?`, `mapBackendMessageToAinspace`(:76)에서 매핑. 그리고 `ChatBox.tsx BackendMessage`(:190) + `mappingBackendMessagesToChatMessages`(:200)에도 동일 매핑.
- 헬퍼(선택): `toChatMessageFiles(raw)` — SSE/히스토리 공용 정규화.

렌더:
- `ChatMessageCard.tsx`(:54-71 텍스트 블록 아래): `message.files?.filter(f => f.mimeType?.startsWith('image/'))`를 `<img src={f.fileUrl}>`로 렌더. 스타일 `max-w-full rounded-lg mt-2`, `onError`로 깨진 이미지 숨김(PR #38 규칙 그대로).

## 데이터 계약 (레포 간 인터페이스)

SSE `message` 이벤트 및 DM 히스토리 메시지의 `files[]` 원소 (backend `files` row):

```
{ id: string; messageId: string; userId: string;
  fileName: string; fileUrl: string;          // NOT NULL
  fileSize: number | null; mimeType: string | null;
  width: number | null; height: number | null;
  createdAt: string }
```

ainspace는 `fileUrl` + `mimeType`만 렌더에 사용(나머지 무시 허용). `mimeType?.startsWith('image/')` 만 이미지로 렌더.

## 검증

- **backend**: 레포에 테스트 러너 유무 확인 후, 순수 로직(파서 `kind==='file'` 추출, `toIncomingAgentAttachments` 기본값 합성)은 유닛/어서션. 이미지 인텐트 트리거 → SSE `data.files`에 항목, 히스토리 재조회 시 `files[]` 유지.
- **ainspace**: `nvm use 22 && yarn build` 통과(프로젝트 규칙). 이미지 답변을 SSE로 받았을 때 버블에 `<img>` 렌더, 새로고침(히스토리) 후에도 유지, 비이미지/누락 시 텍스트만.
- **end-to-end 수동**: LLM/GCS/Redis 자격증명이 있는 환경에서 실제 에이전트 이미지 답변 → 두 레포 배포 → ainspace 채팅에서 이미지 확인.

## 스코프 밖 (YAGNI)

- 비이미지 파일 렌더(다운로드 링크 등).
- 에이전트 측 도배 방지(PR #38이 담당).
- 이미지 업로드/저장(에이전트/빌더 측; ainspace는 수신·렌더만).
- 멀티 에이전트 편집 경로의 카드 outputModes 재계산 등 PR #38 follow-up 항목.
