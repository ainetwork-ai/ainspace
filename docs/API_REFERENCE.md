# AINSpace API 문서

이 문서는 `src/app/api` 이하에 정의된 Next.js Route Handler 기반 API를 정리한 것입니다. 별도의 명시가 없는 경우 모든 응답은 `application/json` 형식을 사용하며, 타임스탬프는 ISO 8601 문자열입니다.

## 공통 정보
- **Base URL**: `/api`
- **환경 변수**
  - `AINSPACE_STORAGE_REDIS_URL` – Redis 연결(옵션, 미설정 시 로컬 Redis 사용)
  - `OPENAI_API_KEY` – `/convert-image`에서 DALL·E 이미지 편집 요청에 사용
  - `GEMINI_API_KEY` – `/agent-response`, `/commentary`에서 Gemini 호출에 사용
  - `AINSPACE_BLOB_READ_WRITE_TOKEN` – `/upload-tile`에서 Vercel Blob 업로드에 필요
- 일부 엔드포인트는 Redis가 비가용할 때 인메모리 폴백 저장소를 사용합니다(예: `/agents`).

## 엔드포인트 요약

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/agents` | 등록된 에이전트 카드 목록 조회 |
| POST | `/agents` | 에이전트 카드 저장 |
| DELETE | `/agents` | 에이전트 삭제 (쿼리 `url`) |
| POST | `/agent-proxy` | A2A 카드 URL로 에이전트 카드 조회 |
| POST | `/agent-response` | Gemini로 에이전트 응답 생성 |
| POST | `/agent-chat` | 단일 A2A 에이전트와 대화 |
| POST | `/create-agent` | 프롬프트로 새 에이전트 생성 및 배포 |
| GET | `/custom-tiles` | 커스텀 타일 레이어 조회 (쿼리 `userId`) |
| POST | `/custom-tiles` | 커스텀 타일 레이어 저장 |
| POST | `/convert-image` | 이미지 → RPG 타일 변환 작업 생성 |
| GET | `/convert-status` | 변환 작업 상태 조회 (쿼리 `jobId`) |
| GET | `/clear-layer1` | 글로벌 타일 레이어1 초기화 |
| GET | `/position` | 플레이어 위치 조회 (쿼리 `userId`) |
| POST | `/position` | 플레이어 위치 저장 |
| POST | `/thread-message` | A2A 쓰레드에 메시지 송신 및 에이전트 바인딩 |
| GET | `/thread-stream/{threadId}` | 쓰레드 SSE 스트림 프록시 |
| GET | `/threads` | 사용자 쓰레드 매핑 조회 (쿼리 `userId`) |
| POST | `/threads` | 쓰레드 매핑 저장 |
| DELETE | `/threads` | 쓰레드 매핑 삭제 (쿼리 `userId`, `threadName`) |
| POST | `/upload-tile` | 타일 PNG 업로드 (multipart/form-data) |
| GET | `/test-agent` | 외부 A2A 카드 페치 테스트 |
| GET | `/sentry-example-api` | Sentry 연동 테스트용 오류 발생 |

아래는 각 엔드포인트의 상세 설명입니다.

---

## `/agents`

### GET `/agents`
- **설명**: Redis(`agents:` 키 prefix) 또는 인메모리 폴백에서 모든 등록된 에이전트를 최근 등록 순으로 반환합니다.
- **응답**
  ```json
  {
    "success": true,
    "agents": [
      {
        "url": "https://...",
        "card": { "name": "Explorer Bot", "...": "..." },
        "timestamp": 1718350123456
      }
    ]
  }
  ```
- **오류**: Redis 연결 실패 등 서버 오류 시 `500`.

### POST `/agents`
- **설명**: 에이전트 카드 정보를 저장합니다. 동일 URL이 이미 존재하면 `duplicate: true`로 응답합니다.
- **요청 본문**
  ```json
  {
    "agentUrl": "https://.../.well-known/agent.json",
    "agentCard": { "name": "Explorer Bot", "...": "..." }
  }
  ```
- **응답**: `success: true`, 저장된 URL·카드 정보. 중복 시에도 200 응답.
- **오류**: 필수 필드 누락 시 `400`, 저장 실패 시 `500`.

### DELETE `/agents?url=<agentUrl>`
- **설명**: 주어진 URL에 해당하는 에이전트를 Redis 또는 폴백 스토어에서 제거합니다.
- **오류**: 존재하지 않는 경우 `404`.

---

## POST `/agent-proxy`
- **설명**: 프런트엔드가 URL만 전달하면 서버에서 A2A SDK를 통해 카드 정보를 가져와 반환합니다.
- **요청 본문**
  ```json
  { "agentUrl": "https://.../.well-known/agent.json" }
  ```
- **응답**: `agentCard`, `agentUrl`, `success: true`.
- **오류**: URL 누락 시 `400`, 카드 페치 실패 시 `500`.

---

## POST `/agent-response`
- **설명**: `src/lib/gemini.ts`의 `generateAgentResponse`를 호출해 게임 내 에이전트 대사를 생성합니다.
- **요청 본문 예시**
  ```json
  {
    "agentData": {
      "name": "Explorer Bot",
      "behavior": "explorer",
      "position": { "x": 1, "y": 5 },
      "playerPosition": { "x": 2, "y": 7 },
      "distance": 4.1,
      "userMessage": "안녕!"
    }
  }
  ```
- **응답**
  ```json
  {
    "response": "Gemini가 생성한 메시지",
    "timestamp": "2024-06-14T05:15:32.123Z"
  }
  ```
- **오류**: `agentData` 누락 시 `400`, 내부 오류 시 `500`.

---

## POST `/agent-chat`
- **설명**: 단일 A2A 에이전트와 직접 대화를 수행합니다. `contextId`를 전달하면 SDK 레벨에서 컨텍스트 유지가 시도됩니다.
- **요청 본문**
  ```json
  {
    "agentUrl": "https://.../.well-known/agent.json",
    "message": "Hi!",
    "contextId": "optional-context-id",
    "metadata": { "tileId": "123" }
  }
  ```
- **응답**
  ```json
  {
    "success": true,
    "response": "에이전트 응답 텍스트",
    "contextId": "유지 혹은 새 ID",
    "taskId": "옵션",
    "fullResponse": { "..." : "A2A SDK Raw Response" }
  }
  ```
- **오류**: 필수 필드 누락 시 `400`, 통신 실패 시 `500`.

---

## POST `/commentary`
- **설명**: 현재 게임 상태(`gameState`)를 바탕으로 Gemini가 내레이션을 생성합니다.
- **요청 본문**
  ```json
  {
    "gameState": {
      "worldPosition": { "x": 10, "y": 12 },
      "currentTerrain": "grass",
      "visibleAgents": [{ "name": "Explorer Bot", "color": "#00f" }],
      "recentMovements": ["N", "E", "E"],
      "biome": "forest"
    }
  }
  ```
- **응답**: `commentary`, `timestamp`.

---

## POST `/create-agent`
- **설명**: AINetwork A2A Builder API를 통해 프롬프트 기반 에이전트를 생성·배포합니다.
- **요청 본문**
  ```json
  { "prompt": "생성하고 싶은 에이전트에 대한 설명" }
  ```
- **흐름**
  1. `POST /api/generate-agent` 호출로 config 생성
  2. 필수 필드 보강(`id`, `url`, `protocolVersion` 등)
  3. `POST /api/deploy-agent` 호출
- **응답**
  ```json
  {
    "success": true,
    "url": "https://.../.well-known/agent.json",
    "agentId": "agent-<timestamp>",
    "config": { "...": "보강된 설정" }
  }
  ```
- **오류**: 각 단계 실패 시 원본 상태코드/메시지를 전파.

---

## `/custom-tiles`

### GET `/custom-tiles?userId=<id>`
- **설명**: 현재는 글로벌(`global-tiles`) 키에서 레이어 정보를 로드하며, 사용자 ID는 하위 호환을 위해 받지만 사용되지 않습니다.
- **응답**
  ```json
  {
    "tiles": {
      "layer0": { "...": "..." },
      "layer1": { },
      "layer2": { }
    },
    "lastUpdated": "2024-06-14T05:10:32.123Z",
    "isDefault": false
  }
  ```
- **오류**: Redis 오류 시 `500`.

### POST `/custom-tiles`
- **설명**: 전달된 레이어 데이터를 기존 글로벌 타일과 병합 후 저장합니다.
- **요청 본문**
  ```json
  {
    "userId": "0x123...",
    "customTiles": {
      "layer0": { "tileId": "asset-url" },
      "layer1": {},
      "layer2": {}
    }
  }
  ```
- **응답**: `success`, 저장된 tile 개수(`tileCount`), `savedAt`.
- **오류**: 구조 잘못된 경우 `400`, 저장 실패 시 `500`.

---

## `/convert-image`

### POST `/convert-image`
- **설명**: 업로드된 이미지를 DALL·E 2 편집 API로 512×512 PNG 타일로 변환합니다. 비동기 작업을 생성하고 즉시 `jobId`를 반환합니다.
- **요청 형식**: `multipart/form-data`
  - `image`: File (필수)
- **응답**
  ```json
  {
    "success": true,
    "jobId": "job_1718350123456_abcd123",
    "message": "Image conversion started. Use the jobId to check status."
  }
  ```
- **오류**: 파일 누락 시 `400`, OpenAI 호출 실패 시 `500`.

### GET `/convert-status?jobId=<id>`
- **설명**: 인메모리 작업 상태를 반환합니다. 완료/실패 후 1시간이 지나면 `Job expired`.
- **응답**
  ```json
  {
    "jobId": "job_...",
    "status": "completed",
    "result": "data:image/png;base64,...",
    "error": null
  }
  ```
- **상태 값**: `pending`, `processing`, `completed`, `failed`.
- **오류**: `jobId` 누락 시 `400`, 존재하지 않는 경우 `404`.

---

## GET `/clear-layer1`
- **설명**: Redis `global-tiles` 자료구조에서 `layer1`만 비우고 나머지 레이어를 유지합니다. 정리 로그를 포함한 요약을 반환합니다.

---

## `/position`

### GET `/position?userId=<id>`
- **설명**: 저장된 플레이어 위치를 조회합니다. 없으면 기본 위치 `{x:0, y:0}`와 `isDefault: true`를 반환합니다.

### POST `/position`
- **설명**: 플레이어 위치를 Redis에 저장(24시간 TTL).
- **요청 본문**
  ```json
  {
    "userId": "0x123...",
    "position": { "x": 10, "y": 5 }
  }
  ```
- **응답**: `success`, 저장된 좌표, `savedAt`.
- **오류**: 검증 실패 시 `400`.

---

## POST `/thread-message`
- **설명**: A2A Orchestration 쓰레드에 메시지를 전송하고, 필요 시 범위 내 에이전트를 쓰레드에 추가합니다.
- **요청 본문**
  ```json
  {
    "message": "Hello agents!",
    "playerPosition": { "x": 10, "y": 12 },
    "broadcastRadius": 5,
    "threadId": "optional-existing-thread",
    "agentNames": ["Explorer Bot"],
    "mentionedAgents": ["Patrol Bot"]
  }
  ```
  - `agentNames`가 있으면 해당 이름만 사용, 없으면 `broadcastRadius`나 `mentionedAgents` 기반으로 백엔드가 필터링
  - 기존 쓰레드 ID가 없으면 새 쓰레드를 생성하고 선택된 에이전트를 추가
- **응답**
  ```json
  {
    "success": true,
    "threadId": "generated-or-existing",
    "agentsAdded": 2,
    "totalAgents": 3,
    "isNewThread": true,
    "failedAgents": [
      { "success": false, "agent": "Patrol Bot", "error": { "...": "..." } }
    ]
  }
  ```
- **오류**: 메시지/좌표 누락 시 `400`, 쓰레드 생성/전송 실패 시 `500`, 에이전트 없음 `404`.

---

## GET `/thread-stream/{threadId}`
- **설명**: A2A Orchestration의 SSE 스트림을 프록시합니다. `Content-Type: text/event-stream`. Node.js 런타임(`runtime = 'nodejs'`), 최대 5분(`maxDuration = 300`).
- **사용 예시**
  ```ts
  const source = new EventSource('/api/thread-stream/abcd');
  source.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log(data);
  };
  ```

---

## `/threads`

### GET `/threads?userId=<id>`
- **설명**: 사용자별 쓰레드 매핑(`user:{userId}:threads`)을 모두 가져옵니다.
- **응답**
  ```json
  {
    "success": true,
    "threads": {
      "General": {
        "threadName": "General",
        "backendThreadId": "a2a-thread-id",
        "agentNames": ["Explorer Bot"],
        "createdAt": "...",
        "lastMessageAt": "..."
      }
    }
  }
  ```

### POST `/threads`
- **설명**: 쓰레드 이름과 A2A 쓰레드 ID를 저장(30일 TTL).
- **요청 본문**
  ```json
  {
    "userId": "0x123...",
    "threadName": "General",
    "backendThreadId": "a2a-thread-id",
    "agentNames": ["Explorer Bot", "Patrol Bot"]
  }
  ```

### DELETE `/threads?userId=<id>&threadName=<name>`
- **설명**: 특정 쓰레드 매핑 삭제.

---

## POST `/upload-tile`
- **설명**: 업로드된 PNG를 Vercel Blob(`tiles/{tileId}.png`)에 저장하고 URL을 반환합니다.
- **요청 형식**: `multipart/form-data`
  - `file`: File (필수)
  - `tileId`: string (필수)
- **응답**
  ```json
  { "success": true, "url": "https://blob.vercel-storage.com/...", "tileId": "sample-tile" }
  ```
- **오류**: 필드 누락 시 `400`, 업로드 실패 시 `500`.

---

## GET `/test-agent`
- **설명**: 하드코딩된 A2A 카드 URL에 대한 테스트 호출. 응답 본문과 헤더를 반환해 네트워크 디버깅에 사용합니다.

---

## GET `/sentry-example-api`
- **설명**: 호출 시 항상 `SentryExampleAPIError`를 throw하여 Sentry 서버 측 에러 추적을 검증하기 위한 테스트용 라우트입니다.

