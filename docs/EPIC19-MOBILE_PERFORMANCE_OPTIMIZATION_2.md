# EPIC19 - MOBILE_PERFORMANCE_OPTIMIZATION_2 (모바일 퍼포먼스 최적화 2차)

> 타일셋 이미지 글로벌 캐시를 도입하여 마을 간 중복 이미지 로드를 제거하고 메모리 사용량을 절감한다.

## 의존성
- EPIC18 (모바일 퍼포먼스 최적화 1차) — CSSSprite 교체, 마을 로딩 stagger 등 완료 전제

## 목표
- 동일 타일셋을 사용하는 마을 간 이미지 메모리 중복 제거
- 마을 재방문 시 타일셋 이미지 즉시 사용 (네트워크 재요청 없음)

---

## Story 19.1: 타일셋 이미지 글로벌 캐시

**수정 파일:** `src/lib/village-map-loader.ts`

### 배경

현재 `loadVillageMap()` 내부에서 각 타일셋 이미지를 `loadImage()`로 로드한다. `loadImage()`는 매번 `new Image()`를 생성하므로, 같은 타일셋 URL을 사용하는 마을이 여러 개 로드되면 동일한 이미지가 메모리에 중복 적재된다.

현재 코드 (`village-map-loader.ts` line 37-47):
```tsx
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => {
      reject(new Error(`Image load timeout: ${src}`));
    }, IMAGE_LOAD_TIMEOUT);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error(`Image load failed: ${src}`)); };
    image.src = src;
  });
}
```

호출 경로:
- TSX 파일 참조 타일셋 (line 89): `const image = await loadImage(imagePath);`
- 인라인 타일셋 (line 111): `const image = await loadImage(imagePath);`

타일셋 이미지는 보통 256KB~2MB 크기이며, 마을 9개가 동시에 로드되고 동일 타일셋을 공유하면 같은 이미지가 9배 메모리를 차지한다.

### 참고 파일
- `src/components/CSSSprite.tsx` — 글로벌 이미지 캐시 패턴 참고 (line 8-37의 `imageCache` + `loadListeners` + `preloadImage`)
- `src/stores/useVillageStore.ts` — `removeLoadedVillage()`로 마을 언로드 시 LoadedVillage 객체가 Map에서 제거됨. 캐시된 이미지는 다른 마을에서 참조 중일 수 있으므로 캐시에서 제거하지 않아야 함
- `src/hooks/useVillageLoader.ts` — `UNLOAD_DISTANCE = 2` 기반 마을 언로드 로직

### 태스크

#### 글로벌 이미지 캐시 구현
- [x] `village-map-loader.ts` 모듈 스코프에 글로벌 캐시 추가:
  ```tsx
  const tilesetImageCache = new Map<string, Promise<HTMLImageElement>>();
  ```
  - `Promise`를 캐싱하여 동시에 같은 URL을 요청하는 race condition을 방지 (Promise deduplication)
- [x] `loadImage` 함수를 캐시 기반으로 수정:
  - 캐시에 해당 URL의 Promise가 있으면 그대로 반환
  - 없으면 기존 로직으로 Promise를 생성하고 캐시에 저장 후 반환
  - 로드 실패 시 캐시에서 해당 URL 제거 (재시도 가능하도록)
  ```tsx
  function loadImage(src: string): Promise<HTMLImageElement> {
    const cached = tilesetImageCache.get(src);
    if (cached) return cached;

    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      const timer = setTimeout(() => {
        reject(new Error(`Image load timeout: ${src}`));
      }, IMAGE_LOAD_TIMEOUT);
      image.onload = () => { clearTimeout(timer); resolve(image); };
      image.onerror = () => { clearTimeout(timer); reject(new Error(`Image load failed: ${src}`)); };
      image.src = src;
    }).catch((err) => {
      tilesetImageCache.delete(src);
      throw err;
    });

    tilesetImageCache.set(src, promise);
    return promise;
  }
  ```

### 주의사항
- `loadImage` 함수 시그니처(`(src: string) => Promise<HTMLImageElement>`)는 변경하지 않는다
- 캐시에 `Promise`를 저장하여 동일 URL에 대한 동시 요청이 하나의 네트워크 요청만 발생하도록 한다
- 캐시된 이미지는 마을 언로드 시에도 제거하지 않는다 (재방문 시 즉시 사용)
- 타일셋 종류가 제한적(10~20종)이므로 LRU나 크기 제한 없이 단순 Map으로 충분하다
- `TODAY_CACHE_KEY`가 URL에 포함되어 하루 단위로 캐시가 자연 갱신된다

---

## Story 19.2: TileMap 미사용 이미지 로딩 코드 제거

**수정 파일:** `src/components/TileMap.tsx`

### 배경

TileMap.tsx에 커스텀 타일 이미지를 `new Image()`로 프리로드하는 useEffect와 관련 state가 있으나, **로드된 이미지가 렌더링에 전혀 사용되지 않는 dead code**이다.

제거 대상 코드:

1. **`loadedImages` state** (line 59):
   ```tsx
   const [loadedImages, setLoadedImages] = useState<{ [key: string]: HTMLImageElement }>({});
   ```

2. **이미지 로딩 useEffect** (line 145-199): `customTiles`의 모든 이미지 URL을 추출하여 `new Image()`로 로드하고 `setLoadedImages`에 저장. `loadedImages`는 이 useEffect 내부의 중복 로드 방지(`if (loadedImages[imageUrl]) return;`)에만 사용되고, 렌더링에서는 참조되지 않음.

3. **`isLayeredTiles` 타입 가드** (line 141-143): 위 useEffect에서만 사용됨.

4. **`Sentry` import** (line 8): 위 useEffect의 onerror 핸들러에서만 사용됨. 이 useEffect 제거 시 Sentry import도 미사용.

### 영향 분석
- 커스텀 타일 렌더링은 `useTiledMap.ts`의 canvas 렌더링에서 처리됨 (TileMap.tsx의 loadedImages와 무관)
- 이 코드를 제거해도 커스텀 타일이 화면에 표시되는 데 영향 없음
- 제거 시 초기 렌더링에서 불필요한 `new Image()` 생성 + setState 호출이 제거되어 성능 개선

### 태스크

- [x] `loadedImages` state 선언 제거 (line 59)
- [x] 이미지 로딩 useEffect 전체 제거 (line 145-199)
- [x] `isLayeredTiles` 함수 제거 (line 141-143)
- [x] `import * as Sentry from '@sentry/nextjs'` 제거 (line 8) — 다른 곳에서 미사용 확인 완료
- [x] `npx tsc --noEmit`으로 타입 에러 없음 확인

### 주의사항
- Sentry import 제거 전 TileMap.tsx 내에서 다른 곳에서 사용하지 않는지 반드시 확인
- `customTiles` prop 자체는 제거하지 않음 (useTiledMap 렌더링에서 사용될 수 있음)

---

## Story 19.3: nearby village 로드를 순차 + yield로 변경

**수정 파일:** `src/hooks/useVillageLoader.ts`

### 배경

모바일 퍼포먼스 프로파일링 결과, nearby village 로딩 중 조이스틱 input→frame 지연이 **210~255ms**까지 발생하는 것이 확인됨. canvas render 자체는 3~6ms로 빠르지만, 마을의 동기 작업이 메인 스레드를 연속 점유하여 input 처리를 블로킹함.

**근본 원인:** 마을 1개의 동기 작업(TMJ파싱+collision)은 ~27ms로 짧지만, `Promise.all`로 4개 마을의 fetch가 병렬 실행되면 네트워크 응답이 비슷한 시점에 도착하여 동기 작업이 **연속으로 쌓여** 실행됨 (4 × 27ms ≈ 108ms + 오버헤드 = 150~210ms 연속 블로킹).

EPIC18 Story 18.3의 stagger(마을 간 50ms 시작 분산)는 fetch 시작만 분산할 뿐, 응답 도착 후 동기 처리의 pile-up은 막지 못함.

**해결:** `Promise.all` 병렬 → 순차(for loop) + 각 마을 완료 후 `yield`로 변경. 네트워크 병렬 이점은 잃지만, 마을당 27ms + yield라 총 시간도 크게 안 늘어남 (4 × 27ms = 108ms + yield 4회). 무엇보다 동기 작업 pile-up이 원천 차단됨.

현재 코드 (`useVillageLoader.ts` loadNearbyVillages 내부):
```tsx
// NSEW 병렬 + stagger
await Promise.all(nsew.map(async (v, i) => {
    await new Promise(r => setTimeout(r, i * 50));
    return loadVillage(v);
}));
// 대각 병렬 + stagger
await Promise.all(diagonal.map(async (v, i) => {
    await new Promise(r => setTimeout(r, i * 50));
    return loadVillage(v);
}));
```

### 태스크

#### yield 헬퍼 함수 추가
- [x] `useVillageLoader.ts` 내에 yield 유틸 추가:
  ```tsx
  const yieldToMain = () => new Promise<void>(r => setTimeout(r, 0));
  ```

#### NSEW 마을 로드를 순차 + yield로 변경
- [x] `Promise.all(nsew.map(...))` → `for...of` 순차 루프로 변경:
  ```tsx
  for (const v of nsew) {
      await loadVillage(v);
      await yieldToMain();
  }
  ```

#### 대각 마을 로드도 동일하게 변경
- [x] `Promise.all(diagonal.map(...))` → `for...of` 순차 루프로 변경:
  ```tsx
  for (const v of diagonal) {
      await loadVillage(v);
      await yieldToMain();
  }
  ```

### 주의사항
- `loadVillage` 내부의 중복 로드 방지 로직(`loadingRef`, `loadedVillages.has`)은 그대로 유지
- `village-map-loader.ts`는 수정하지 않음
- 마을 전환 감지 useEffect는 수정하지 않음
- 순차 실행으로 총 로딩 시간이 소폭 늘어날 수 있으나 (병렬 fetch 이점 상실), 각 마을의 network fetch가 대부분의 시간을 차지하므로 체감 차이는 크지 않음

---

## 구현 규칙

### 최소 변경 원칙
- Story 19.1: `loadImage` 함수 내부만 수정. 함수 시그니처 유지
- Story 19.2: dead code 제거만 수행. 새 기능 추가 금지
- Story 19.3: `useVillageLoader.ts`의 Promise.all → 순차 + yield 변경만 수행. `loadVillage` 내부 로직 변경 금지

### 금지사항
- 마을 언로드 시 캐시를 비우는 로직 추가 금지
- WeakRef/FinalizationRegistry 등 복잡한 메모리 관리 패턴 금지
- `loadVillageMap` 호출부나 `useVillageStore` 수정 금지
- `customTiles` prop이나 TileMapProps 인터페이스 변경 금지
- `village-map-loader.ts` 수정 금지

---

## 완료 조건
- [x] 동일 타일셋 URL의 이미지가 캐시에서 반환되어 `new Image()` 호출이 URL당 1회로 제한됨
- [x] 동시에 같은 URL을 요청해도 네트워크 요청이 1회만 발생함 (Promise deduplication)
- [x] 이미지 로드 실패 시 캐시에서 제거되어 재시도가 가능함
- [x] TileMap.tsx에서 미사용 `loadedImages` state, useEffect, `isLayeredTiles`, Sentry import가 제거됨
- [x] nearby village 로드 중 조이스틱 input→frame 지연이 100ms 이하로 개선됨
- [x] 커스텀 타일이 기존과 동일하게 화면에 표시됨
- [x] 마을 렌더링이 기존과 동일하게 작동함
- [x] `yarn build` 성공, 기존 기능 회귀 없음
