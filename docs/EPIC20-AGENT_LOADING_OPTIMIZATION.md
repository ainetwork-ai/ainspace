# EPIC20 - AGENT_LOADING_OPTIMIZATION (에이전트 로딩 최적화)

> 에이전트 스토어 구독 최적화로 불필요한 re-render 체인을 제거하고, 마을 단위 lazy fetch로 초기 로드 시간을 단축한다.

## 의존성
- EPIC18 (모바일 퍼포먼스 최적화 1차) — CSSSprite 교체, 에이전트 store 폴링 최적화 완료 전제

## 목표
- 에이전트 상태 변경 시 불필요한 re-render cascade 제거
- `updateAgents` interval 재생성 루프 차단
- `/api/agents` 중복 fetch 방지 (race condition 수정)
- `/api/agents` 응답 시간 단축 (71개 전체 3.4초 → 마을 단위 ~500ms)
- 초기 렌더 시 스폰되는 에이전트 수 최소화 (71개 → 10~15개)
- 레거시 `initializeDefaultAgents` 코드 제거

## 현재 re-render 체인 (문제)

에이전트 1개 상태 변경 시 발생하는 cascade:

```
useAgentStore.updateAgent()
  → agents 새 배열 생성 (state.agents.map(...))
  → 구독자 전원 re-render:
      ├─ useAgents.ts (line 37: const { agents } = useAgentStore())
      │   → updateAgents 콜백 재생성 (agents가 의존성)
      │   → setInterval clear + re-set (updateAgents가 의존성)
      │   → getVisibleAgents 재생성
      │   └─ useGameState.tsx re-render (useAgents 소비)
      │       → isPositionBlocked 재생성 (agents가 의존성)
      │       → movePlayer 재생성 (isPositionBlocked가 의존성)
      │       └─ page.tsx re-render → MapTab re-render → TileMap re-render
      ├─ useGameState.tsx (line 26: const { agents: a2aAgents } = useAgentStore())
      │   → isPositionBlocked 재생성 (a2aAgents가 의존성)
      │   └─ (위와 동일한 cascade)
      └─ MapTab.tsx (line 55: const { agents } = useAgentStore())
          └─ TileMap re-render (agents prop 변경)
```

**결과**: 100ms 폴링에서 에이전트 1개라도 변경되면, MapTab + TileMap이 **3가지 경로**로 동시에 re-render된다.

---

## Story 20.1: 레거시 `initializeDefaultAgents` 제거

**수정 파일:**
- `src/providers/Providers.tsx`
- `src/lib/initializeAgents.ts`

### 배경

`Providers.tsx` line 39-45에서 `initializeDefaultAgents()`를 호출하지만, 함수 본문이 전체 주석 처리된 dead code이다. `DEFAULT_AGENTS = []` (빈 배열).

```tsx
// Providers.tsx line 39-45
useEffect(() => {
    if (mounted) {
        initializeDefaultAgents().catch((error) => {
            console.error('Failed to initialize default agents:', error);
        });
    }
}, [mounted]);
```

```tsx
// initializeAgents.ts — 함수 본문 전체 주석처리
export async function initializeDefaultAgents(): Promise<void> {
  // NOTE(yoojin): tmp disable default agents
}
```

### 태스크

- [x] `Providers.tsx`에서 `initializeDefaultAgents` import 및 useEffect 제거
- [x] `src/lib/initializeAgents.ts` 파일 삭제
- [x] 다른 파일에서 `initializeAgents`를 import하는 곳이 없는지 확인 (검증 완료: Providers.tsx만 사용)

---

## Story 20.2: `/api/agents` fetch race condition 수정

**수정 파일:** `src/hooks/useAgentLoader.ts`

### 배경

`useAgentLoader`의 첫 번째 useEffect (line 115-155)에서 두 가지 문제:

1. `hasFetchedRef.current = true`가 fetch 응답 후에 설정된다 (line 141). fetch가 진행 중인 동안 useEffect가 재실행되면 중복 fetch 가능.

2. useEffect 의존성에 `spawnReadyAgents`가 포함되어 있다 (line 155). `spawnReadyAgents`는 `isPositionValid`, `findAvailableSpawnPosition`, `spawnAgent`에 의존하므로 (line 112), 이들이 재생성되면 useEffect가 재실행된다.

```tsx
// line 115-155
useEffect(() => {
    if (!isCurrentVillageLoaded || hasFetchedRef.current) return;
    const fetchAndSpawn = async () => {
        // ... fetch 진행 중 (hasFetchedRef.current 아직 false) ...
        hasFetchedRef.current = true;  // ← line 141: fetch 완료 후 설정
        spawnReadyAgents();
    };
    fetchAndSpawn();
}, [isCurrentVillageLoaded, spawnReadyAgents]);  // ← spawnReadyAgents 불안정
```

### 태스크

- [x] `hasFetchedRef.current = true`를 fetch 시작 전(비동기 호출 전)으로 이동하여 중복 fetch 방지
- [x] useEffect 의존성에서 `spawnReadyAgents` 제거 — fetch는 `isCurrentVillageLoaded` 변경 시에만 1회 실행되어야 함. fetch 완료 후 `spawnReadyAgents`를 ref를 통해 호출
  ```tsx
  const spawnReadyAgentsRef = useRef(spawnReadyAgents);
  spawnReadyAgentsRef.current = spawnReadyAgents;

  useEffect(() => {
      if (!isCurrentVillageLoaded || hasFetchedRef.current) return;
      hasFetchedRef.current = true;  // ← fetch 전에 설정
      const fetchAndSpawn = async () => {
          // ... fetch ...
          spawnReadyAgentsRef.current();  // ← ref로 최신 함수 호출
      };
      fetchAndSpawn();
  }, [isCurrentVillageLoaded]);  // ← spawnReadyAgents 제거
  ```

---

## Story 20.3: `updateAgents` interval 재생성 방지

**수정 파일:** `src/hooks/useAgents.ts`

### 배경

`updateAgents` 콜백의 의존성 배열에 `agents`가 포함되어 있다 (line 214):
```tsx
const updateAgents = useCallback(() => {
    agents.forEach((agent) => {  // ← 클로저로 agents 참조
        // ...
        const isLoading = isAgentLoading(agent.id);  // ← 클로저로 isAgentLoading 참조
        // ...
        updateStoredAgent(agent.agentUrl, updates);
    });
}, [canAgentMoveTo, isWalkable, isAgentLoading, agents, updateStoredAgent]);
```

이로 인한 연쇄 반응:

1. 에이전트 상태 변경 → `agents` 새 배열 → `updateAgents` 재생성
2. `updateAgents` 재생성 → `useEffect` (line 231-234) 재실행 → `clearInterval` + `setInterval`
3. 100ms 폴링마다 이 사이클 반복 → interval이 매번 재설정됨

추가로 `isAgentLoading`도 `useChatStore()`에서 selector 없이 가져오므로 (line 34), chat store 변경 시에도 불필요하게 `updateAgents`가 재생성된다.

### 태스크

- [x] `updateAgents` 내부에서 `agents`를 클로저 대신 `useAgentStore.getState().agents`로 읽도록 변경
- [x] `isAgentLoading`도 `useChatStore.getState().isAgentLoading`으로 읽도록 변경
- [x] 의존성 배열에서 `agents`와 `isAgentLoading` 제거
  ```tsx
  const updateAgents = useCallback(() => {
      const currentAgents = useAgentStore.getState().agents;
      const { isAgentLoading: checkLoading } = useChatStore.getState();
      const currentTime = Date.now();

      currentAgents.forEach((agent) => {
          const isLoading = checkLoading(agent.id);
          // ... 기존 로직 동일 ...
          if (isWalkable(testX, testY, currentAgents, agent.id) &&
              canAgentMoveTo(agent, testX, testY)) {
              // ...
          }
      });
  }, [canAgentMoveTo, isWalkable, updateStoredAgent]);
  ```
- [x] `useAgents` hook의 store 구독도 selector 기반으로 변경:
  ```tsx
  // Before
  const { agents, setAgents, updateAgent: updateStoredAgent } = useAgentStore();

  // After
  const agents = useAgentStore((s) => s.agents);
  const setAgents = useAgentStore((s) => s.setAgents);
  const updateStoredAgent = useAgentStore((s) => s.updateAgent);
  ```
  - action 함수(`setAgents`, `updateAgent`)는 Zustand에서 참조가 안정적이므로 selector로 가져와도 re-render를 유발하지 않음
  - `agents`는 여전히 배열 참조 변경 시 re-render되지만, `updateAgents` 의존성에서 제거되었으므로 interval 재생성은 방지됨

### 주의사항
- `useAgentStore.getState()`는 호출 시점의 최신 상태를 반환하므로 폴링 콜백에서 항상 최신 에이전트 목록을 사용
- `canAgentMoveTo`, `isWalkable`, `updateStoredAgent`는 안정적인 참조이므로 의존성 유지
- `isWalkable`의 `playerWorldPosition` 의존성은 기존과 동일하게 유지 (플레이어 이동 시에만 재생성)

### 사이드이펙트
- **`useChatStore()` selector-less 구독이 useAgents에 잔존**: line 34 `const { isAgentLoading } = useChatStore()`은 채팅 store 전체를 구독하므로, 채팅 메시지 수신 등 chat store 변경 시 useAgents hook이 re-render된다. `isAgentLoading`을 `updateAgents` 의존성에서 제거하더라도 hook 자체의 re-render는 남는다. 이 Story 범위에서는 `updateAgents` interval 안정화만 목표로 하고, useChatStore 구독 최적화는 별도로 검토한다.
- **`getVisibleAgents` 재생성**: `useAgents`가 `agents`를 selector로 구독해도, agents 배열 변경 시 hook re-render → `getVisibleAgents` useCallback 재생성 → `useGameState`에서 `visibleAgents` 새 배열 반환. 이는 `page.tsx`의 `isPositionValid` (line 475-479)가 `visibleAgents`를 의존성으로 갖고 있어 연쇄 재생성을 유발한다. 단, interval 재설정 문제에 비하면 비용이 낮으므로 이 Story에서는 다루지 않는다.

---

## Story 20.4: useGameState의 에이전트 store 이중 구독 제거

**수정 파일:** `src/hooks/useGameState.tsx`

### 배경

`useGameState`에서 에이전트를 **두 경로로 중복 구독**한다:

```tsx
// line 26 — 직접 구독
const { agents: a2aAgents } = useAgentStore();

// line 57-60 — useAgents를 통한 간접 구독
const { agents, visibleAgents, resetAgents } = useAgents({
    playerWorldPosition: worldPosition,
    viewRadius: VIEW_RADIUS
});
```

`a2aAgents`는 `isPositionBlocked` (line 116-119)에서만 사용:
```tsx
const occupiedByA2AAgent = Object.values(a2aAgents).some(
    (agent) => agent.x === x && agent.y === y
);
```

그런데 `agents` (useAgents에서 반환)와 `a2aAgents` (직접 구독)는 **동일한 `useAgentStore.agents`**이다. `isPositionBlocked`의 line 111-114에서 이미 `agents`로 충돌 체크를 하고 있으므로 `a2aAgents` 체크는 중복이다:
```tsx
const occupiedByWorldAgent = agents.some(
    (agent) => agent.x === x && agent.y === y
);
```

### 태스크

- [x] `useGameState.tsx`에서 `const { agents: a2aAgents } = useAgentStore()` 제거 (line 26)
- [x] `isPositionBlocked`에서 `a2aAgents` 충돌 체크 제거 (line 116-119) — `agents` 체크 (line 111-114)와 중복
- [x] `isPositionBlocked` 의존성 배열에서 `a2aAgents` 제거 (line 123)
- [x] `useAgentStore` import가 다른 곳에서 사용되지 않으면 import 제거

### 영향
- `useGameState`가 `useAgentStore`를 직접 구독하지 않게 되므로, 에이전트 변경 → useGameState re-render → page.tsx re-render 경로 **1개 차단**
- `useAgents`를 통한 간접 경로는 유지되지만, Story 20.3에서 `updateAgents`의 interval 재생성을 차단하므로 re-render 빈도 대폭 감소

### 주의사항
- `agents` (useAgents 반환값)와 `a2aAgents` (직접 구독)가 동일 소스인지 재확인 필요 — 둘 다 `useAgentStore.agents`임을 코드에서 확인 완료
- `Object.values(a2aAgents)` 패턴은 agents가 배열인데 Object.values를 쓰고 있어 불필요한 변환이지만, 결과는 동일 (배열의 Object.values는 자기 자신)

### 사이드이펙트
- **`page.tsx`의 `isPositionValid`에도 동일 중복이 존재** (line 474-478): `visibleAgents`(useAgents 경유)와 `useAgentStore.getState().agents`를 `[...visibleAgents, ...currentA2AAgents]`로 합쳐서 체크하고 있다. `visibleAgents`는 `useAgents`에서 `agents`를 가공한 것이므로 같은 에이전트가 두 번 체크된다. 이 함수는 에이전트 배치(`useAgentLoader`)에서 스폰 위치 유효성 검사에 사용되므로, 중복 제거 시 동작은 동일하되 `visibleAgents`만으로 충분한지 확인 필요. 단, 이 Story 범위는 `useGameState.tsx`로 한정하고 `page.tsx`는 별도 검토.
- **`isPositionBlocked` 의존성 축소에 따른 `movePlayer` 재생성 빈도 감소**: `isPositionBlocked`에서 `a2aAgents` 제거 → 의존성 감소 → `movePlayer`도 덜 재생성됨. 이는 긍정적 효과이나, 충돌 감지 정확성은 반드시 테스트로 검증해야 함.

---

## Story 20.5: Agent store mutation 최적화

**수정 파일:** `src/stores/useAgentStore.ts`

### 배경

`useAgentStore`의 mutation 함수 중 `updateAgent`만 `hasChanges` 체크가 있고 (line 68-71), 다른 함수들은 변경 여부와 무관하게 새 배열을 생성한다:

```tsx
// updateAgentPosition (line 44-51) — 동일 좌표여도 새 배열 생성
updateAgentPosition: (agentUrl, x, y) =>
    set((state) => {
        const agent = state.agents.find((a) => a.agentUrl === agentUrl);
        if (!agent) return state;
        // ← agent.x === x && agent.y === y 체크 없음
        return { agents: state.agents.map(...) };
    }),

// updateAgentCharacterImage (line 53-60) — 동일 이미지여도 새 배열 생성
updateAgentCharacterImage: (agentUrl, imageUrl) =>
    set((state) => {
        const agent = state.agents.find((a) => a.agentUrl === agentUrl);
        if (!agent) return state;
        // ← agent.characterImage === imageUrl 체크 없음
        return { agents: state.agents.map(...) };
    }),
```

### 태스크

- [x] `updateAgentPosition`에 동일 좌표 early return 추가:
  ```tsx
  if (agent.x === x && agent.y === y) return state;
  ```
- [x] `updateAgentCharacterImage`에 동일 이미지 early return 추가:
  ```tsx
  if (agent.characterImage === imageUrl) return state;
  ```

### 주의사항
- `updateAgent` (범용 업데이트 함수)의 `hasChanges` 체크는 이미 동작 중이므로 수정 불필요
- early return 시 Zustand가 `state`를 그대로 반환하면 구독자에게 알림이 가지 않음 (re-render 방지)

### 사이드이펙트
- **`updateAgentPosition`의 `lastMoved` 갱신 동작 변경**: 현재는 동일 좌표로 호출해도 `lastMoved: Date.now()`가 갱신된다. early return 추가 후에는 동일 좌표 시 `lastMoved`가 갱신되지 않는다. `lastMoved`는 `useAgents.ts`에서 이동 간격(`moveInterval`)과 애니메이션 상태(`isCurrentlyAnimating`) 판단에 사용되므로, `updateAgentPosition`이 동일 좌표로 호출되면서 `lastMoved` 갱신에 의존하는 코드가 없는지 확인 필요. 현재 코드 분석 결과: `updateAgentPosition`은 외부에서 직접 호출되는 곳이 없으며 (useAgents에서는 `updateAgent` 범용 함수를 사용), store 인터페이스에만 존재. 따라서 실질적 영향 없음.

---

## Story 20.6: MapTab의 agents 구독 방식 변경

**수정 파일:** `src/components/tabs/MapTab.tsx`

### 배경

MapTab에서 에이전트 스토어를 selector 없이 구독한다 (line 55):
```tsx
const { agents } = useAgentStore();
```

이 패턴은 store의 어떤 상태든 변경되면 MapTab이 re-render된다. selector 기반으로 변경하면 `agents` 참조가 실제로 바뀔 때만 re-render된다.

### 태스크

- [x] MapTab의 agents 구독을 selector 기반으로 변경:
  ```tsx
  // Before
  const { agents } = useAgentStore();

  // After
  const agents = useAgentStore((s) => s.agents);
  ```

### 주의사항
- Story 20.3~20.5에서 불필요한 배열 생성과 구독 경로를 줄이므로, 이 변경은 나머지 Story와 결합했을 때 효과가 극대화됨
- 이 변경 단독으로는 `agents` 배열 참조가 바뀌는 한 re-render 빈도에 큰 차이 없음

---

## Story 20.7: 마을 단위 에이전트 lazy fetch

**수정 파일:**
- `src/app/api/agents/route.ts` (API에 village 필터 추가)
- `src/hooks/useAgentLoader.ts` (마을 단위 fetch로 변경)

### 배경

현재 `/api/agents` GET은 Redis에서 전체 에이전트를 로드한다 (71개, 3.4초).
초기 렌더 시에는 현재 마을 + 인접 마을의 에이전트만 필요하다 (10~15개).

API는 현재 `?address=` 파라미터만 지원하며, 마을 기반 필터는 없다.
`StoredAgent.state.mapName`에 마을 slug가 저장되어 있으므로 서버사이드 필터링 가능.

### 태스크

#### API 변경
- [ ] `GET /api/agents`에 `?villages=happy,hahoe` 쿼리 파라미터 지원 추가
  - `villages` 파라미터가 있으면 해당 마을의 에이전트만 필터링하여 반환
  - 파라미터가 없으면 기존처럼 전체 반환 (하위 호환)
- [ ] 필터링은 서버에서 수행 (`agent.state.mapName` 기반)

#### useAgentLoader 변경
- [ ] 초기 fetch: 현재 마을 slug로 `GET /api/agents?villages={currentVillage}` 호출
- [ ] `loadedVillages` 변경 감지 시: 새로 로드된 마을의 에이전트만 추가 fetch
  - 이미 fetch한 마을은 스킵 (fetched villages Set 관리)
- [ ] `allAgentsRef`를 점진적으로 누적 (기존: 전체 교체 → 변경: 마을별 append)

### 주의사항
- AgentTab에서 `GET /api/agents?address=` 호출은 별도 경로이므로 변경하지 않음
- 에이전트가 마을 간 이동할 수 있으므로 `mapName` 기반 필터링이 정확한지 확인 필요
- 마을 전환 시 이전 마을 에이전트를 언로드할지 여부는 이 EPIC 범위에서 결정하지 않음

### 사이드이펙트
- **`mapName`이 null인 에이전트 누락 위험**: `StoredAgent.state.mapName`이 optional (`string | null | undefined`)이다. 오래된 데이터나 수동 배치된 에이전트에 `mapName`이 없을 수 있다. villages 필터 사용 시 이런 에이전트가 영원히 로드되지 않는다. API에서 `mapName`이 null인 에이전트는 항상 포함하는 fallback 로직이 필요하거나, `useAgentLoader`의 `spawnReadyAgents`에서 좌표 기반 마을 판별(`worldToGrid`)로 보완해야 한다.
- **에이전트가 마을 경계를 넘어 이동한 경우**: 클라이언트에서 에이전트가 이동하여 원래 `mapName`과 다른 마을에 위치할 수 있다. 서버의 `state.mapName`은 배치 시점 기준이므로, 마을 B에 있는 에이전트를 마을 A 필터로 fetch하면 마을 B 화면에서 에이전트가 누락될 수 있다. 다만 현재 에이전트 이동은 `VILLAGE_WIDE` 모드에서도 마을 범위 내로 제한되므로 (`canAgentMoveTo` line 96-109), 실제 발생 가능성은 낮다.

---

## 구현 규칙

### 우선순위
| Story | 난이도 | 영향 | 우선순위 |
|-------|--------|------|----------|
| 20.1 | 매우 낮음 | 낮음 (dead code 제거) | 1 |
| 20.2 | 낮음 | 중간 (중복 fetch 방지) | 2 |
| 20.3 | 낮음 | **높음** (interval 재설정 제거 + re-render 체인 차단) | 3 |
| 20.4 | 낮음 | 중간 (이중 구독 제거 — re-render 경로 1개 차단) | 4 |
| 20.5 | 매우 낮음 | 중간 (불필요한 배열 생성 방지) | 5 |
| 20.6 | 매우 낮음 | 낮음 (selector 변경 — 다른 Story와 결합 시 효과) | 6 |
| 20.7 | 중간 | 높음 (초기 로드 시간 단축) | 7 |

### 금지사항
- 에이전트 이동/애니메이션 로직의 동작 결과 변경 금지 (내부 구현 최적화는 허용)
- 에이전트 store의 외부 인터페이스 변경 금지 (내부 최적화는 허용)
- 100ms 폴링 주기 변경 금지

---

## 완료 조건
- [ ] `initializeDefaultAgents` 레거시 코드가 완전히 제거됨
- [ ] `/api/agents` fetch가 초기 로드 시 1회만 실행됨 (중복 없음)
- [ ] `updateAgents` 콜백이 agents 배열 변경으로 재생성되지 않음 (interval 안정)
- [ ] `useGameState`가 `useAgentStore`를 직접 구독하지 않음 (이중 구독 제거)
- [ ] 에이전트 상태 미변경 시 store 업데이트가 발생하지 않음 (불필요한 re-render 제거)
- [ ] 마을 단위 에이전트 fetch로 초기 응답 시간이 1초 이내
- [ ] 마을 전환 시 새 마을의 에이전트가 정상적으로 스폰됨
- [ ] 기존 에이전트 기능(이동, 대화, 배치 등)에 회귀 없음
- [ ] `yarn build` 성공
