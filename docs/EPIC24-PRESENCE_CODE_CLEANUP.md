# EPIC24 - PRESENCE CODE CLEANUP (멀티유저 프레즌스 코드 정리)

> isNew 페이드인 제거, SSE 공통 훅 추출, DIRECTION enum 통일을 통해 프레즌스 관련 코드의 중복과 타입 불일치를 해소한다.

## 의존성
- EPIC23 (멀티유저 프레즌스 기능 구현 완료 상태)

## 목표
- 미작동하는 `isNew` fade-in 로직 제거
- `useVillagePresence`와 `useThreadStream`의 SSE 연결 관리 보일러플레이트를 공통 훅으로 추출
- 서버/클라이언트 전역에서 direction 타입을 `DIRECTION` enum으로 통일

---

## Story 24.1: isNew 페이드인 로직 제거

**수정 파일:** `src/hooks/useVillagePresence.ts`, `src/components/TileMap.tsx`

### 배경
`OnlinePlayer` 인터페이스의 `isNew` 필드는 PLAYER_JOINED 시 fade-in 애니메이션을 위해 추가되었다. 그러나 TileMap에서 해당 엘리먼트가 마운트될 때 이미 `opacity: 1`이므로, `transition: 'opacity 0.5s ease-in'`은 값 변화가 없어 실제로 발동하지 않는다. CSS transition은 프로퍼티 값이 변할 때만 작동하기 때문이다.

현재 코드:
```tsx
// TileMap.tsx:454-459
opacity: player.isLeaving ? 0 : 1,
transition: player.isLeaving
    ? 'opacity 1.5s ease-out'
    : player.isNew
        ? 'opacity 0.5s ease-in'  // ← 발동하지 않음
        : 'none',
```

또한 `isNew`는 한번 `true`가 되면 리셋되지 않아 해당 플레이어에 영구적으로 남는다.

### 참고 파일
- `src/hooks/useVillagePresence.ts` — `OnlinePlayer` 인터페이스 및 `isNew` 설정 위치
- `src/components/TileMap.tsx` — `isNew` 기반 transition 렌더링

### 태스크

#### OnlinePlayer 인터페이스에서 isNew 제거
- [x] `src/hooks/useVillagePresence.ts:17` — `OnlinePlayer` 인터페이스에서 `isNew: boolean` 필드 삭제
- [x] `src/hooks/useVillagePresence.ts:101` — snapshot 핸들러의 `isNew: false` 제거
- [x] `src/hooks/useVillagePresence.ts:131` — PLAYER_JOINED 기존 플레이어 업데이트의 `isNew: false` 제거
- [x] `src/hooks/useVillagePresence.ts:146` — PLAYER_JOINED 새 플레이어 추가의 `isNew: true` 제거

#### TileMap에서 isNew 기반 transition 제거
- [x] `src/components/TileMap.tsx:454-459` — `isNew` 분기 제거. `isLeaving`만 남기고 나머지는 `'none'`으로 단순화:
  ```tsx
  opacity: player.isLeaving ? 0 : 1,
  transition: player.isLeaving ? 'opacity 1.5s ease-out' : 'none',
  ```

### 주의사항
- `isLeaving` 로직은 유지해야 한다 (PLAYER_LEFT 시 fade-out은 정상 작동)

---

## Story 24.2: SSE 공통 훅 추출 (`useSSEConnection`)

**수정 파일:** `src/hooks/useSSEConnection.ts` (신규), `src/hooks/useVillagePresence.ts`, `src/hooks/useThreadStream.ts`

### 배경
`useVillagePresence`와 `useThreadStream`이 동일한 SSE 연결 관리 패턴을 독립적으로 구현하고 있다:

```
공통 패턴:
- eventSourceRef = useRef<EventSource | null>(null)
- reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
- reconnectAttemptsRef = useRef(0)
- maxReconnectAttempts = 5
- cleanup(): EventSource.close() + clearTimeout
- onerror: Math.min(1000 * Math.pow(2, attempts), 30000) 지수 백오프
- 성공 시 reconnectAttempts 리셋
```

두 훅의 핵심 차이는 **서버 SSE 포맷**에 있다:
- **thread-stream 서버**: unnamed events (`data: {...}\n\n`) → `onmessage`로 수신
- **village-sse 서버**: named events (`event: snapshot\ndata: {...}\n\n`) → `addEventListener`로 수신

EventSource API는 `onmessage`와 `addEventListener`를 동시에 지원하므로, 공통 훅이 두 패턴을 모두 수용할 수 있다.

추가로, `useThreadStream`은 `connectToThreadStream()` 래퍼(`src/lib/a2aOrchestration.ts:231-258`)를 통해 EventSource를 생성하는데, 이 래퍼는 `onmessage`와 `onerror`를 설정한 뒤 EventSource를 반환한다. 그런데 `useThreadStream`이 반환된 EventSource의 `onerror`를 덮어쓰므로 래퍼의 `onerror` 설정은 무의미하다. `connectToThreadStream`은 `useThreadStream`에서만 사용되므로, 공통 훅 전환 시 이 래퍼를 제거하고 URL을 직접 전달하는 구조로 정리한다.

### 참고 파일
- `src/hooks/useThreadStream.ts` — 기존 SSE 훅 (chat thread용)
- `src/hooks/useVillagePresence.ts` — 프레즌스 SSE 훅
- `src/lib/a2aOrchestration.ts:231-258` — `connectToThreadStream` 래퍼 (제거 대상)

### 태스크

#### useSSEConnection 공통 훅 생성
- [x] `src/hooks/useSSEConnection.ts` 파일 생성
- [x] 인터페이스 정의:
  ```typescript
  interface UseSSEConnectionOptions {
    url: string | null;                    // null이면 연결하지 않음
    maxReconnectAttempts?: number;         // 기본값 5
    onMessage?: (event: MessageEvent) => void;                    // unnamed events (onmessage)
    listeners?: Record<string, (event: MessageEvent) => void>;    // named events (addEventListener)
    onConnected?: () => void;
    onDisconnected?: () => void;
    onMaxRetriesReached?: () => void;
  }
  interface UseSSEConnectionReturn {
    isConnected: boolean;
    reconnectAttempts: number;
    disconnect: () => void;
    reconnect: () => void;
  }
  ```
- [x] 공통 로직 구현:
  - `eventSourceRef`, `reconnectTimeoutRef`, `reconnectAttemptsRef` ref 관리
  - `cleanup()` — EventSource close + timeout clear
  - `connect()` — EventSource 생성, `onMessage` 있으면 `es.onmessage` 설정, `listeners` 있으면 각각 `es.addEventListener` 등록
  - `onerror` — 지수 백오프 `Math.min(1000 * Math.pow(2, attempts), 30000)`, max attempts 도달 시 `onMaxRetriesReached` 호출
  - `url` 변경 시 자동 reconnect (useEffect)
  - `isConnected` 상태 관리

#### useThreadStream에서 공통 훅 사용
- [x] `connectToThreadStream()` 사용을 제거하고 URL을 직접 구성: `/api/thread-stream/${threadId}`
- [x] `eventSourceRef`, `reconnectTimeoutRef`, `reconnectAttemptsRef`, `maxReconnectAttempts` 제거
- [x] `cleanup()` 함수를 공통 훅의 `disconnect`로 대체
- [x] `connect()` 함수를 `useSSEConnection`의 `onMessage` 옵션으로 재구성 (JSON 파싱 + `StreamEvent` 콜백)
- [x] Sentry 로깅은 `onDisconnected` 콜백에서 처리
- [x] `connectionStatus`, `lastError`는 useThreadStream 내부에서 유지 (공통 훅의 `isConnected`와 별개)

#### connectToThreadStream 래퍼 제거
- [x] `src/lib/a2aOrchestration.ts:231-258` — `connectToThreadStream` 함수 삭제 (useThreadStream에서만 사용되었으므로)
- [x] `connectToThreadStream` export를 제거

#### useVillagePresence에서 공통 훅 사용
- [x] `eventSourceRef`, `reconnectTimeoutRef`, `reconnectAttemptsRef`, `maxReconnectAttempts` 제거
- [x] `cleanup()`에서 EventSource/reconnect 관련 부분 제거 (debounce, leavingTimers만 남김)
- [x] `connect()` 함수를 `useSSEConnection`의 `listeners` 옵션으로 재구성:
  - `snapshot`, `presence`, `reconnect`, `error` 이벤트 핸들러를 listeners로 전달
  - `onMaxRetriesReached`에서 `setPlayers([])` 호출
- [x] debounce 로직은 `url` 생성 단계에서 처리 (useSSEConnection에 url 전달 시점 조절)

### 주의사항
- `useThreadStream`은 `onmessage` (unnamed events), `useVillagePresence`는 `addEventListener` (named events)를 사용 — 공통 훅이 두 패턴 모두 지원해야 함
- `useVillagePresence`의 `reconnect` 서버 이벤트(SSE function expiry 시 자동 재연결)는 listeners로 처리
- `useThreadStream`의 Sentry 연동과 `connectionStatus` 상태는 기존 동작을 유지해야 함
- `connectToThreadStream`의 JSON 파싱 로직은 `useThreadStream`의 `onMessage` 콜백으로 이동

---

## Story 24.3: DIRECTION enum 통일

**수정 파일:** `src/lib/redis.ts`, `src/app/api/position/route.ts`, `src/app/api/village-sse/route.ts`, `src/hooks/useVillagePresence.ts`

### 배경
클라이언트에 `DIRECTION` enum이 존재하지만 (`src/constants/game.ts:27-33`), 서버/Redis 레이어에서는 `string` 타입과 문자열 리터럴 `'down'`을 사용하고 있다:

```typescript
// src/constants/game.ts:27-33
export enum DIRECTION {
    UP = 'up',
    DOWN = 'down',
    LEFT = 'left',
    RIGHT = 'right',
    STOP = 'stop'
}

// src/lib/redis.ts:64 — string 타입 사용
direction: string;      // 'up' | 'down' | 'left' | 'right'

// src/app/api/position/route.ts:69 — 문자열 리터럴
const dir = direction || 'down';

// src/app/api/village-sse/route.ts:31 — 문자열 리터럴
direction: searchParams.get('direction') || 'down',
```

이 때문에 `useVillagePresence.ts`에 string→DIRECTION 변환용 `DIRECTION_MAP`과 `toDirection()` 함수가 존재한다 (lines 20-29). enum 값이 문자열과 우연히 일치(`DIRECTION.DOWN === 'down'`)하여 동작하지만, 타입 안전성이 없다.

`src/constants/game.ts`에는 `'use client'` 지시문이 없으므로 서버 코드에서도 import 가능하다.

### 참고 파일
- `src/constants/game.ts` — DIRECTION enum 정의
- `src/hooks/useVillagePresence.ts` — `DIRECTION_MAP`, `toDirection()` 변환 함수

### 태스크

#### PlayerPresence direction 타입 변경
- [x] `src/lib/redis.ts:64` — `PlayerPresence` 인터페이스의 `direction` 타입을 `string`에서 `DIRECTION`으로 변경. 단, `STOP`은 프레즌스에서 사용하지 않으므로 `Exclude<DIRECTION, DIRECTION.STOP>`으로 좁히거나, 그대로 `DIRECTION`을 사용
- [x] `src/lib/redis.ts` 상단에 `import { DIRECTION } from '@/constants/game';` 추가

#### 서버 API route에서 enum 사용
- [x] `src/app/api/position/route.ts` 상단에 `import { DIRECTION } from '@/constants/game';` 추가
- [x] `src/app/api/position/route.ts:69` — `const dir = direction || 'down'`를 `const dir = direction || DIRECTION.DOWN`으로 변경
- [x] `src/app/api/village-sse/route.ts` 상단에 `import { DIRECTION } from '@/constants/game';` 추가
- [x] `src/app/api/village-sse/route.ts:31` — `searchParams.get('direction') || 'down'`를 `(searchParams.get('direction') as DIRECTION) || DIRECTION.DOWN`으로 변경

#### useVillagePresence에서 변환 로직 제거
- [x] `src/hooks/useVillagePresence.ts:20-25` — `DIRECTION_MAP` 상수 삭제
- [x] `src/hooks/useVillagePresence.ts:27-29` — `toDirection()` 함수 삭제
- [x] `toDirection(event.direction)` 호출을 `event.direction as DIRECTION`으로 대체 (PLAYER_JOINED, PLAYER_MOVED 핸들러)
- [x] snapshot 핸들러의 `toDirection(p.direction)` 호출도 동일하게 대체

### 주의사항
- Redis에 이미 저장된 데이터는 `string` 형태이므로 JSON.parse 시 타입 캐스팅 필요
- `DIRECTION.STOP`은 프레즌스 방향으로 의미가 없으나, 타입에 포함되어도 런타임 문제는 없음
- `searchParams.get('direction')`의 반환 타입은 `string | null`이므로 `as DIRECTION` 캐스팅 필요

---

## Story 24.4: Heartbeat Redis 분리 및 stale 판정 개선

**수정 파일:** `src/app/api/village-sse/route.ts`, `src/lib/redis.ts`

### 배경
현재 heartbeat(15초 간격)이 player 데이터 hash에서 hGet → JSON.parse → lastUpdated 변경 → hSet을 수행한다. 이 read-modify-write 패턴에 두 가지 문제가 있다:

1. **Race condition**: heartbeat의 read-modify-write 사이에 position POST가 끼면, heartbeat이 이전 좌표로 player 데이터를 덮어쓸 수 있다.
2. **스케일**: N명 접속 시 15초마다 2N Redis round-trip (hGet + hSet per connection).

또한 현재 `lastUpdated`는 **마지막 이동 시점**이므로, idle 유저가 stale로 판정될 수 있다. 향후 유저 간 대화 기능 등을 고려하면, stale 판정은 "이동 여부"가 아닌 **"접속 여부"** 기준이어야 한다.

현재 heartbeat 코드 (`village-sse/route.ts:133-159`):
```typescript
pingInterval = setInterval(async () => {
  send('ping', '{}');
  // Read-modify-write: hGet → parse → update lastUpdated → hSet
  const raw = await redis.hGet(`village:${village}:players`, userId);
  if (raw) {
    const current = JSON.parse(raw);
    current.lastUpdated = Date.now();
    await redis.hSet(`village:${village}:players`, userId, JSON.stringify(current));
  }
}, 15000);
```

현재 SSE cleanup 코드 (`village-sse/route.ts:64-81`):
```typescript
const cleanup = () => {
  // Unsubscribe listener (don't remove presence — rely on lastUpdated lazy cleanup)
  // ← SSE 종료 시 presence 제거 안 함
};
```

### 참고 파일
- `src/app/api/village-sse/route.ts` — heartbeat 및 SSE cleanup 로직
- `src/lib/redis.ts` — `getVillagePlayers` stale 판정 로직

### 태스크

#### heartbeat hash 분리
- [x] heartbeat에서 player data hash (`village:{slug}:players`) 읽기/쓰기 제거
- [x] 대신 별도 heartbeat hash에 갱신: `redis.hSet('village:{slug}:heartbeat', userId, String(Date.now()))` — 1 call, race 없음
- [x] heartbeat의 subscriber health check 로직 제거 (subscriber는 모듈 싱글톤이므로 커넥션별 체크 불필요)

#### SSE cleanup에서 presence 명시적 제거
- [x] `village-sse/route.ts` cleanup 함수에 `removePlayerPresence(village, userId)` 추가
- [x] heartbeat hash에서도 제거: `redis.hDel('village:{slug}:heartbeat', userId)`
- [x] 주석 "rely on lastUpdated lazy cleanup" 제거

#### stale 판정 기준 변경
- [x] `src/lib/redis.ts`의 `getVillagePlayers`에서 stale 판정을 `village:{slug}:players`의 `lastUpdated` 대신 `village:{slug}:heartbeat` hash 기준으로 변경
- [x] stale threshold를 30초에서 **60초**로 변경
- [x] `PlayerPresence` 인터페이스에서 `lastUpdated` 필드 제거 (더 이상 stale 판정에 사용하지 않음)
- [x] `savePlayerPresence`에서 `lastUpdated: Date.now()` 설정 제거

### 주의사항
- `village:{slug}:heartbeat` hash는 `village:{slug}:players`와 별도 키이므로 player data에 영향 없음
- `removePlayerPresence`는 이미 PLAYER_LEFT 이벤트 발행을 포함하므로, SSE cleanup에서 별도 이벤트 발행 불필요
- position POST의 `savePlayerPresence`는 player data만 쓰므로 변경 불필요
- 비정상 종료(abort 미발생) 시 유령 플레이어는 최대 60초간 표시됨 — 게임 특성상 허용 가능

---

## Story 24.5: 새 스레드 첫 메시지 SSE 응답 누락 수정

**수정 파일:** `src/app/api/thread-create/route.ts` (신규), `src/app/api/thread-message/route.ts`, `src/components/chat/ChatBox.tsx`

### 배경
새 스레드에서 첫 메시지를 보낼 때 에이전트 응답이 오지 않고 끝나는 버그가 있다. 원인은 SSE 연결과 메시지 전송 사이의 race condition이다.

현재 흐름 (`/api/thread-message` 단일 요청):
```
1. POST /api/thread-message (threadId 없음)
   → createThread() → addAgentToThread() → sendMessage()
   → A2A 서버가 즉시 응답 스트리밍 시작
   → 응답 반환: { threadId, isNewThread: true }

2. 클라이언트: setCurrentThreadId(threadId)
   → 1초 대기 (ChatBox.tsx line 493: delay = 1000)
   → setHasStartedConversation(true)

3. useThreadStream enabled → SSE 연결 시작
   → /api/thread-stream/${threadId}

4. BUT: A2A 서버는 이미 1단계에서 응답 스트리밍을 완료했음
   → SSE 연결 시점에 수신할 이벤트가 없음
```

`sendMessage()`가 호출되면 A2A 서버가 즉시 처리를 시작하여 SSE stream으로 응답을 보내는데, 클라이언트는 threadId를 받은 뒤 1초 후에야 SSE에 연결하므로 응답을 놓친다. threadId가 없으면 SSE를 연결할 수 없어 딜레이를 준 것이지만, 그 사이에 응답이 이미 지나간다.

기존 스레드의 경우 SSE가 이미 연결된 상태이므로 이 문제가 없다.

### 참고 파일
- `src/app/api/thread-message/route.ts` — 현재 스레드 생성 + 메시지 전송이 한 요청에 결합됨
- `src/components/chat/ChatBox.tsx:408-503` — handleSendMessage 함수
- `src/lib/a2aOrchestration.ts` — `createThread`, `addAgentToThread`, `sendMessage` 함수

### 태스크

#### `/api/thread-create` 엔드포인트 생성
- [x] `src/app/api/thread-create/route.ts` 파일 생성
- [x] `/api/thread-message`의 스레드 생성 + 에이전트 추가 로직을 분리:
  ```typescript
  // POST body: { agentNames, playerPosition, broadcastRadius?, mentionedAgents?, userId }
  // Response: { success, threadId, agentsAdded, failedAgents? }
  ```
- [x] 기존 `thread-message/route.ts`의 에이전트 조회 로직(`findAgentsInRange`, `convertToA2AAgent`)을 공통 유틸로 추출하거나, `thread-create`에 복사
- [x] `createThread(userId)` → `addAgentToThread()` 수행 후 threadId 반환 (sendMessage는 호출하지 않음)

#### `ChatBox.tsx` handleSendMessage 분기 변경
- [x] 새 스레드 경로(`threadIdToSend === undefined`) 수정:
  ```
  [1] POST /api/thread-create → threadId 확보
  [2] setCurrentThreadId(threadId) + setHasStartedConversation(true) (딜레이 없음)
  [3] SSE 연결 대기 (useThreadStream의 onConnected 또는 짧은 폴링)
  [4] POST /api/thread-message (threadId 포함) → sendMessage만 실행
  ```
- [x] 기존 1초 딜레이 (`const delay = result.isNewThread ? 1000 : 100`) 제거
- [x] 스레드 매핑 저장 로직(addThread, setMessages, setCurrentThreadId 등)은 1단계 응답 후 즉시 실행

#### `thread-message/route.ts`에서 스레드 생성 로직 제거
- [x] `!currentThreadId` 분기(lines 108-125)의 `createThread` 로직 제거
- [x] `isNewThread` 분기(lines 131-153)의 `addAgentToThread` 로직 제거
- [x] threadId가 필수 파라미터가 됨 — 없으면 400 에러 반환
- [x] `sendMessage()`만 수행하는 단순한 엔드포인트로 축소

### 주의사항
- SSE 연결이 확인된 후에 메시지를 전송해야 한다 — `useSSEConnection`의 `onConnected` 콜백 또는 `isConnected` 상태를 활용
- 스레드 생성 실패 시 에러 핸들링은 기존과 동일하게 유지
- 기존 스레드 경로(`threadIdToSend`가 있는 경우)는 변경하지 않음 — 그대로 `/api/thread-message` POST
- `thread-create` 응답 시간이 길 수 있으므로 (createThread + addAgent 여러 개) 로딩 상태 유지 필요

---

## 구현 규칙

### Story 실행 순서
- Story 24.1 → Story 24.3 → Story 24.4 → Story 24.2 → Story 24.5 순서 권장
- 24.1과 24.3은 독립적이므로 병렬 가능
- 24.4는 24.3 이후 권장 (redis.ts의 PlayerPresence 타입이 정리된 상태)
- 24.2는 24.4 이후 (다른 Story들로 useVillagePresence가 단순해진 상태에서 공통 훅 추출이 수월)
- 24.5는 24.2 이후 (useSSEConnection의 onConnected 콜백을 활용)

### 금지사항
- `isLeaving` fade-out 로직을 건드리지 않는다 (정상 작동 중)
- `useThreadStream`의 기존 외부 인터페이스(`reconnect`, `disconnect`, `isConnected` 등)를 변경하지 않는다
- SSE 공통 훅에 도메인 로직(village debounce, chat thread ID 관리 등)을 포함하지 않는다
- `DIRECTION` enum 자체의 값을 변경하지 않는다
- heartbeat hash와 player data hash를 하나로 합치지 않는다 (분리가 핵심)

---

## 완료 조건
- [x] `isNew` 필드가 코드베이스에서 완전히 제거되었다
- [x] `useSSEConnection` 공통 훅이 존재하고, `useVillagePresence`와 `useThreadStream` 모두 이를 사용한다
- [x] `useVillagePresence`와 `useThreadStream`에 `eventSourceRef`, `reconnectTimeoutRef`, `reconnectAttemptsRef`가 직접 존재하지 않는다
- [x] `DIRECTION_MAP`과 `toDirection()` 함수가 제거되었다
- [x] `PlayerPresence.direction`이 `DIRECTION` 타입이다
- [x] 서버 API route에서 `'down'` 문자열 리터럴 대신 `DIRECTION.DOWN`을 사용한다
- [x] heartbeat이 별도 hash(`village:{slug}:heartbeat`)에만 쓰고, player data hash에 read-modify-write를 하지 않는다
- [x] SSE 연결 종료 시 `removePlayerPresence`가 호출된다
- [x] stale 판정이 heartbeat hash 기준 60초이다
- [ ] 멀티유저 프레즌스가 기존과 동일하게 작동한다 (다른 플레이어 표시, 이동, 떠남)
- [ ] 채팅 SSE 스트림이 기존과 동일하게 작동한다
- [ ] 새 스레드 첫 메시지에서 에이전트 응답이 정상적으로 수신된다 (수동 검증 필요)
- [x] `/api/thread-create`로 스레드 생성, `/api/thread-message`로 메시지 전송이 분리되어 있다
- [x] 새 스레드 생성 시 SSE 연결 후에 메시지가 전송된다
- [x] TypeScript 컴파일 에러가 없다
