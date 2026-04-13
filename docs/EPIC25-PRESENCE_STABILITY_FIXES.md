# EPIC25 - PRESENCE STABILITY FIXES (프레즌스 안정성 버그 수정)

> PR #113 코드 리뷰에서 발견된 버그 3건 + 성능/안정성 이슈 3건을 수정한다.

## 의존성
- EPIC24 (프레즌스 코드 정리 완료 상태)

## 목표
- stale 플레이어 제거 시 PLAYER_LEFT 이벤트 발행하여 유령 플레이어 방지
- ChatBox SSE 타임아웃 시 상태 롤백 및 unmount cleanup 추가
- heartbeat hash TTL 설정하여 Redis 영구 누적 방지
- handleReconnect의 setTimeout(0) 해킹 제거
- 미사용 GET /api/position 엔드포인트 정리

---

## Story 25.1: stale 플레이어 제거 시 PLAYER_LEFT 발행

**수정 파일:** `src/lib/redis.ts`

### 배경
`getVillagePlayers`에서 heartbeat 기준 60초 초과된 stale 플레이어를 Redis에서 삭제할 때, `PLAYER_LEFT` 이벤트를 발행하지 않는다. 이로 인해 다른 클라이언트의 `useVillagePresence`가 해당 플레이어의 퇴장을 감지하지 못하고, 화면에 유령 플레이어가 남는다.

현재 코드 (`redis.ts:185-188`):
```typescript
if (staleIds.length > 0) {
    redis.hDel(`village:${villageSlug}:players`, staleIds).catch(() => {});
    redis.hDel(`village:${villageSlug}:heartbeat`, staleIds).catch(() => {});
    // ← PLAYER_LEFT 이벤트 미발행
}
```

### 참고 파일
- `src/lib/redis.ts:120-130` — `removePlayerPresence` 함수 (PLAYER_LEFT 발행 포함)

### 태스크

#### stale 삭제 시 이벤트 발행
- [ ] `src/lib/redis.ts:185-188` — staleIds가 있을 때, hDel 전에 각 stale userId에 대해 `publishVillageEvent(villageSlug, { type: 'PLAYER_LEFT', userId: uid })` 호출
- [ ] `Promise.all`로 병렬 발행 후 hDel 실행 (이벤트 발행이 실패해도 삭제는 진행)

### 주의사항
- `publishVillageEvent`는 이미 내부에서 에러를 catch하므로 개별 try/catch 불필요
- 이벤트 발행과 hDel 순서: 이벤트 먼저 → 삭제 (삭제 후 이벤트를 보내면 이미 데이터가 없어 의미 없음)

---

## Story 25.2: ChatBox timeout ref unmount cleanup

**수정 파일:** `src/components/chat/ChatBox.tsx`

### 배경
`responseTimeoutRef`(60초 응답 타임아웃)에 대한 unmount 클린업 useEffect가 없어, 컴포넌트 unmount 후 타임아웃이 만료되면 unmounted state 업데이트를 시도한다.

```typescript
// ChatBox.tsx:49
const responseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
// ← 대응하는 useEffect cleanup 없음
```

참고: SSE 연결 10초 타임아웃 시 `hasStartedConversation` 롤백은 불필요하다. 타임아웃 후에도 스레드는 이미 생성되어 있고, `useThreadStream`이 계속 재연결을 시도하므로 사용자 재시도 시 기존 스레드 경로로 정상 동작한다. 오히려 롤백하면 SSE가 끊기고 이미 존재하는 스레드를 재생성하려는 문제가 발생한다.

### 참고 파일
- `src/components/chat/ChatBox.tsx:49-50` — ref 선언

### 태스크

#### unmount cleanup useEffect 추가
- [ ] `ChatBox.tsx` — 컴포넌트 최상위에 unmount cleanup useEffect 추가:
  ```typescript
  useEffect(() => {
    return () => {
      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current);
      }
      sseConnectedResolverRef.current = null;
    };
  }, []);
  ```

### 주의사항
- `sseConnectedResolverRef`도 unmount 시 null 처리하여 dangling resolve 방지

---

## Story 25.3: heartbeat hash TTL 설정

**수정 파일:** `src/app/api/village-sse/route.ts`, `src/lib/redis.ts`

### 배경
`village:{slug}:heartbeat` hash에 TTL이 없어, 서버 크래시/배포 등으로 SSE cleanup이 실행되지 못하면 항목이 Redis에 영구 남는다. `getVillagePlayers`의 lazy cleanup이 60초 기준으로 정리하지만, 해당 빌리지에 이후 방문자가 없으면 영원히 잔류한다.

`village:{slug}:players` hash도 동일한 문제가 있다.

### 참고 파일
- `src/app/api/village-sse/route.ts:116` — heartbeat 초기 설정
- `src/app/api/village-sse/route.ts:138-142` — heartbeat interval
- `src/lib/redis.ts:110` — `savePlayerPresence` hSet

### 태스크

#### heartbeat hash TTL
- [ ] `village-sse/route.ts:116` — 초기 heartbeat hSet 후 `redis.expire('village:${village}:heartbeat', 3600)` 추가 (1시간)
- [ ] `village-sse/route.ts:138-142` — heartbeat interval 내에서도 `redis.expire` 갱신 (heartbeat 쓰기와 함께)

#### players hash TTL
- [ ] `src/lib/redis.ts` — `savePlayerPresence` hSet 후 `redis.expire('village:${villageSlug}:players', 3600)` 추가
- [ ] expire는 hash 전체에 적용되므로, 플레이어가 있는 한 계속 갱신됨 (position POST마다 savePlayerPresence 호출)

### 주의사항
- `expire`는 hash 전체 키에 적용됨 — 개별 필드가 아닌 전체 hash의 TTL
- 활성 빌리지는 position POST마다 expire가 갱신되므로 실질적으로 만료되지 않음
- 비활성 빌리지만 1시간 후 자동 정리됨

---

## Story 25.4: handleReconnect setTimeout(0) 제거

**수정 파일:** `src/hooks/useVillagePresence.ts`, `src/hooks/useSSEConnection.ts`

### 배경
`useVillagePresence`의 `handleReconnect`가 `setSseUrl(null)` → `setTimeout(() => setSseUrl(newUrl), 0)` 패턴으로 강제 재연결한다. 이 방식은 React 배치 업데이트 타이밍에 의존하여 불안정하다.

현재 코드 (`useVillagePresence.ts:143-164`):
```typescript
const handleReconnect = useCallback(() => {
    if (villageSlug && userId) {
      setSseUrl(null);
      setTimeout(() => {
        // ... URL 재구성
        setSseUrl(`/api/village-sse?${params.toString()}`);
      }, 0);
    }
}, [villageSlug, userId]);
```

`useSSEConnection`이 이미 `reconnect()` 함수를 반환하지만, 이 경우 URL도 함께 갱신해야 해서 단순 호출이 불가능하다. URL에 `_t` 타임스탬프를 추가하면 항상 새 URL이 되어 `useSSEConnection`의 useEffect가 자동 재연결한다.

### 참고 파일
- `src/hooks/useSSEConnection.ts:102-109` — url 변경 시 자동 reconnect useEffect
- `src/hooks/useVillagePresence.ts:143-164` — 현재 handleReconnect

### 태스크

#### URL 타임스탬프로 강제 재연결
- [ ] `useVillagePresence.ts:143-164` — `handleReconnect` 수정: `setTimeout` 제거, URL에 `_t=${Date.now()}` 파라미터를 추가하여 항상 새 URL이 되도록:
  ```typescript
  const handleReconnect = useCallback(() => {
    if (villageSlug && userId) {
      const { worldPosition, playerDirection } = useGameStateStore.getState();
      const { address, sessionId } = useUserStore.getState();
      const displayName = getDisplayName(address, sessionId, userId);
      const params = new URLSearchParams({
        village: villageSlug, userId,
        x: String(worldPosition.x), y: String(worldPosition.y),
        direction: playerDirection, spriteKey: 'sprite_user.png',
        displayName, _t: String(Date.now()),
      });
      setSseUrl(`/api/village-sse?${params.toString()}`);
    }
  }, [villageSlug, userId]);
  ```

### 주의사항
- `_t` 파라미터는 서버에서 무시됨 (searchParams에서 읽지 않음)
- URL이 변경되면 `useSSEConnection`의 useEffect가 자동으로 cleanup → connect 수행

---

## 구현 규칙

### Story 실행 순서
- Story 25.1 → 25.2 → 25.3 → 25.4 순서 권장 (버그 우선)
- 25.3과 25.4는 독립적이므로 병렬 가능

### 금지사항
- `useSSEConnection`의 공통 인터페이스를 변경하지 않는다
- `useThreadStream`의 외부 인터페이스를 변경하지 않는다
- heartbeat/player hash 구조를 변경하지 않는다 (TTL만 추가)
- SSE 타임아웃 시 `hasStartedConversation`을 롤백하지 않는다 (기존 스레드 재활용 흐름을 깨뜨림)

---

## 완료 조건
- [ ] stale 플레이어 제거 시 다른 클라이언트 화면에서 해당 플레이어가 사라진다
- [ ] ChatBox unmount 시 60초 타임아웃과 SSE resolver가 정리된다
- [ ] `village:{slug}:heartbeat`와 `village:{slug}:players` hash에 TTL이 설정되어 있다
- [ ] handleReconnect에 `setTimeout(0)` 패턴이 없다
- [ ] 기존 프레즌스 및 채팅 기능이 정상 작동한다
- [ ] TypeScript 컴파일 에러가 없다
