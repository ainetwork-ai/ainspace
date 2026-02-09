마을별 TMJ 분리 & 멀티 빌리지 렌더링
Context
현재 AINSpace는 단일 map.tmj(60x40 타일)로 전체 맵을 관리하고, 5개 마을 존을 하드코딩된 좌표 범위(MAP_ZONES)로 구분한다. 이를 마을별 독립 TMJ 파일로 분리하여:

각 마을을 20x20 정방형 타일 맵으로 관리
GCP Cloud Storage에서 TMJ/PNG를 동적으로 로드
Redis에 마을 메타데이터 저장 (동적 생성/삭제 가능)
URL 쿼리 파라미터(?village=slug)로 마을 진입
인접 마을 간 워킹으로 자연스러운 이동 + 멀티 빌리지 렌더링
좌표 체계
글로벌 좌표 유지. 마을 격자 오프셋으로 글로벌 위치를 계산한다.


Village at grid (gx, gy):
  World X range: [gx*20 - 10, gx*20 + 9]  (20 tiles)
  World Y range: [gy*20 - 10, gy*20 + 9]  (20 tiles)
  Center (spawn point): (gx*20, gy*20)

예시:
  grid(0,0)  → world (-10,-10) ~ (9,9),     center (0,0)
  grid(1,0)  → world (10,-10)  ~ (29,9),    center (20,0)
  grid(0,1)  → world (-10,10)  ~ (9,29),    center (0,20)
  grid(-1,0) → world (-30,-10) ~ (-11,9),   center (-20,0)

Global → Grid 변환:
  gridX = Math.floor((worldX + 10) / 20)
  gridY = Math.floor((worldY + 10) / 20)

Global → Village Local (TMJ 인덱스) 변환:
  localX = worldX - (gridX * 20 - 10)   // 0~19
  localY = worldY - (gridY * 20 - 10)   // 0~19
  tileIndex = localY * 20 + localX
Phase 1: 데이터 모델 & API
1-1. Redis Village 스키마

# 마을 메타데이터 (Hash)
village:{slug} → {
  slug: string,           // URL-friendly unique ID (e.g., "happy-village")
  name: string,           // 표시 이름 (e.g., "Happy Village")
  gridX: number,          // 격자 X 오프셋
  gridY: number,          // 격자 Y 오프셋
  tmjUrl: string,         // GCS URL for map.tmj
  tilesetBaseUrl: string, // GCS base URL for tilesets
  createdAt: number,
  updatedAt: number,
}

# 격자 위치 → slug 역방향 인덱스
village:grid:{gridX},{gridY} → slug

# 전체 마을 목록
villages:all → Set<slug>
1-2. Village API (src/app/api/villages/)
src/app/api/villages/route.ts (NEW)

GET /api/villages → 전체 마을 목록 반환
GET /api/villages?gridX=0&gridY=0 → 특정 격자 위치의 마을 조회
GET /api/villages?nearby=0,0 → 인접 9칸 마을 목록 (현재+상하좌우+대각)
POST /api/villages → 마을 생성 (slug, name, gridX, gridY + TMJ/PNG 업로드)
src/app/api/villages/[slug]/route.ts (NEW)

GET /api/villages/[slug] → 단일 마을 메타데이터
PUT /api/villages/[slug] → 마을 수정
DELETE /api/villages/[slug] → 마을 삭제
1-3. GCS 통합 (src/lib/gcs.ts) (NEW)
기존 Firebase Admin SDK(src/lib/firebase.ts) 활용 가능. 새 버킷 또는 기존 버킷에 디렉토리 구조:


gs://ainspace-village-maps/
  villages/
    {slug}/
      map.tmj
      tilesets/
        tileset1.png
        tileset2.png
        ...
업로드: API 서버에서 Firebase Admin SDK로 GCS에 업로드
다운로드: 클라이언트에서 공개 URL 또는 서명된 URL로 직접 fetch
수정 파일
src/app/api/villages/route.ts (NEW)
src/app/api/villages/[slug]/route.ts (NEW)
src/lib/gcs.ts (NEW) - GCS 업로드/URL 생성 유틸
src/lib/redis.ts - 기존 Redis 클라이언트 재사용
Phase 2: Village Store & Loader
2-1. useVillageStore.ts (NEW - Zustand)

interface VillageMetadata {
  slug: string;
  name: string;
  gridX: number;
  gridY: number;
  tmjUrl: string;
  tilesetBaseUrl: string;
}

interface LoadedVillage {
  metadata: VillageMetadata;
  mapData: TiledMap;          // 파싱된 TMJ
  tilesets: Tileset[];        // 로드된 타일셋 이미지
  collisionTiles: Set<string>; // "localX,localY" 형태
}

interface VillageState {
  // 현재 마을
  currentVillageSlug: string | null;
  currentVillage: VillageMetadata | null;

  // 로드된 마을 캐시 (slug → LoadedVillage)
  loadedVillages: Map<string, LoadedVillage>;

  // 인접 마을 메타데이터 (slug → metadata)
  nearbyVillages: Map<string, VillageMetadata>;

  // 격자 위치 → slug 매핑 캐시
  gridIndex: Map<string, string>; // "gridX,gridY" → slug

  // 로딩 상태
  isLoading: boolean;

  // Actions
  setCurrentVillage(slug: string): void;
  loadVillage(metadata: VillageMetadata): Promise<void>;
  unloadVillage(slug: string): void;
  fetchNearbyVillages(gridX: number, gridY: number): Promise<void>;
  getVillageAtGrid(gridX: number, gridY: number): VillageMetadata | null;
  isCollisionAt(worldX: number, worldY: number): boolean;
}
2-2. useVillageLoader.ts (NEW - Hook)
현재 마을 + 인접 마을 로딩/언로딩 관리:


1. currentVillageSlug 변경 시:
   a. /api/villages?nearby={gridX},{gridY} 호출 → 9칸 마을 메타 수신
   b. 현재 마을 TMJ/tilesets 우선 로드 (await)
   c. 상하좌우 마을 병렬 로드 (background)
   d. 대각 마을 병렬 로드 (background)
   e. 더 이상 인접하지 않는 마을 unload
로딩 우선순위: 현재 → NSEW → 대각선

2-3. TMJ/Tileset 로딩 로직
기존 useTiledMap.ts의 loadMap() 함수(lines 59-176)에서 TMJ 파싱 + 타일셋 로드 로직을 추출하여 재사용:


// src/lib/village-map-loader.ts (NEW)
async function loadVillageMap(tmjUrl: string, tilesetBaseUrl: string): Promise<{
  mapData: TiledMap;
  tilesets: Tileset[];
  collisionTiles: Set<string>;
}>
기존 useTiledMap.ts의 XMLParser 기반 TSX 파싱 로직 재사용
기존 flip flag 처리 (getActualGid) 재사용
기존 Layer1* 충돌 타일 수집 로직 재사용
차이점: tmjUrl이 GCS URL, tilesetBaseUrl도 GCS 경로
수정 파일
src/stores/useVillageStore.ts (NEW)
src/hooks/useVillageLoader.ts (NEW)
src/lib/village-map-loader.ts (NEW) - 기존 useTiledMap의 로딩 로직 추출
Phase 3: 멀티 빌리지 렌더링
3-1. useTiledMap.ts 리팩토링
기존: 단일 TMJ + 단일 타일셋으로 렌더링
변경: 다수의 LoadedVillage를 받아 멀티 빌리지 렌더링

렌더링 파이프라인:


1. worldPosition으로 카메라 뷰포트 계산 (기존과 동일)
2. 뷰포트의 글로벌 타일 범위 산출 (renderStartX~renderEndX, renderStartY~renderEndY)
3. 각 글로벌 타일 좌표에 대해:
   a. gridX, gridY 계산 → 어느 마을에 속하는지 판별
   b. 해당 마을이 loadedVillages에 있는지 확인
   c. 없으면 skip (빈 타일로 표시)
   d. 있으면: 글로벌 → 로컬 좌표 변환 → TMJ 타일 데이터 조회
   e. 기존 렌더링 로직 적용 (tileset lookup, flip transform, drawImage)
카메라 경계 처리 변경:

기존: 맵 경계에서 카메라 클램프 (Math.max(minCameraX, ...))
변경: 경계 클램프 제거 또는 로드된 마을 범위 기준으로 클램프. 마을이 없는 영역으로는 이동 불가하므로 실질적으로 마을 경계가 월드 경계.
기존 코드 재사용:

Flip flag 처리 (lines 282-324) → 그대로 재사용
Tileset lookup 로직 (lines 257-267) → village별 tilesets 대상으로 적용
Screen coordinate 계산 (lines 277-280) → 그대로 재사용
TILE_SIZE, BUFFER_TILES 상수 → 그대로 유지
3-2. 충돌 시스템 업데이트

// useVillageStore.isCollisionAt(worldX, worldY)
function isCollisionAt(worldX: number, worldY: number): boolean {
  const gridX = Math.floor((worldX + 10) / 20);
  const gridY = Math.floor((worldY + 10) / 20);
  const slug = gridIndex.get(`${gridX},${gridY}`);
  if (!slug) return true; // 마을 없는 곳은 이동 불가

  const village = loadedVillages.get(slug);
  if (!village) return true; // 아직 로드 안 된 마을은 이동 불가

  const localX = worldX - (gridX * 20 - 10);
  const localY = worldY - (gridY * 20 - 10);
  return village.collisionTiles.has(`${localX},${localY}`);
}
기존 useMapStore.isCollisionTile() 대체
useBuildStore 의 layer1 충돌도 통합 필요
수정 파일
src/hooks/useTiledMap.ts (MAJOR REFACTOR) - 멀티 빌리지 렌더링
src/stores/useMapStore.ts (DEPRECATED → useVillageStore로 대체)
Phase 4: URL & 마을 전환
4-1. URL 파라미터 처리
src/app/page.tsx 수정:


// Next.js에서 searchParams 읽기
const searchParams = useSearchParams();
const villageSlug = searchParams.get('village') ?? DEFAULT_VILLAGE_SLUG;

// 마을 진입 시:
// 1. village 메타데이터 fetch
// 2. 플레이어를 마을 중심 좌표에 배치
// 3. 마을 + 인접 마을 로딩 시작
4-2. 워킹 마을 전환

플레이어 이동 시:
1. 새 위치의 gridX, gridY 계산
2. 현재 마을의 grid와 다르면:
   a. currentVillageSlug 업데이트
   b. URL 쿼리 파라미터 업데이트 (history.replaceState, 페이지 리로드 없이)
   c. 새 인접 마을 메타데이터 fetch
   d. 새로 인접하게 된 마을 로드, 멀어진 마을 언로드
4-3. 이동 유효성 검사 변경
기존 useGameState.tsx의 이동 검증:

MAP_ZONES 기반 경계 체크 → 마을 존재 여부로 대체
mapStartPosition/mapEndPosition → 제거
충돌 체크: useVillageStore.isCollisionAt() 사용
에이전트/빌드 충돌: 기존 로직 유지
수정 파일
src/app/page.tsx (MODIFY) - URL param 읽기, 마을 전환 로직
src/hooks/useGameState.tsx (MODIFY) - 이동 유효성 검사 변경
src/components/tabs/MapTab.tsx (MODIFY) - 현재 마을 표시 업데이트
Phase 5: 상수 & 설정 정리
5-1. src/constants/game.ts 변경

// 추가
export const VILLAGE_SIZE = 20;  // 마을 한 변 타일 수

// 제거/deprecated
// MAP_SIZE_PIXELS, MAP_TILES → 더 이상 단일 맵 크기 불필요
// MAP_ZONES (하드코딩) → Redis 동적 관리로 대체
// MAP_NAMES enum → Redis에서 동적으로
// MIN_WORLD_X/MAX_WORLD_X/MIN_WORLD_Y/MAX_WORLD_Y → 월드 경계 없음 (마을 존재 여부로 판단)
// getMapNameFromCoordinates() → useVillageStore.getVillageAtGrid()로 대체

// 유지
// TILE_SIZE = 40
// MAP_WIDTH = 16, MAP_HEIGHT = 12 (뷰포트)
// VIEW_RADIUS, BROADCAST_RADIUS
// MOVEMENT_MODE, SPAWN_RADIUS
// INITIAL_PLAYER_POSITION → 기본 마을 중심으로 변경
5-2. 에이전트 시스템 업데이트
AgentWorldState.mapName 타입: MAP_NAMES | null → string | null (village slug)
에이전트 이동 제약: MAP_ZONES[mapName] → useVillageStore에서 해당 마을 범위 조회
에이전트 배치 시 마을 slug 할당
수정 파일
src/constants/game.ts (MODIFY)
src/lib/map-utils.ts (DEPRECATED → village-utils.ts로 대체)
src/lib/agent.ts (MODIFY) - mapName 타입 변경
src/app/page.tsx (MODIFY) - 에이전트 이동 로직
Phase 6: 커스텀 타일(빌드) 시스템 적응
6-1. 커스텀 타일 Redis 키 변경

기존: global-tiles → { tiles: { layer0: {...}, layer1: {...}, layer2: {...} } }
변경: village-tiles:{slug} → { tiles: { layer0: {...}, layer1: {...}, layer2: {...} } }
마을별로 커스텀 타일 분리
/api/custom-tiles API에 village slug 파라미터 추가
수정 파일
src/app/api/custom-tiles/route.ts (MODIFY) - village slug 기반
src/stores/useBuildStore.ts (MODIFY) - 현재 마을 기준으로 타일 로드/저장
Phase 7: 마이그레이션
기존 map.tmj와 데이터를 새 구조로 변환하는 일회성 스크립트:

기존 map.tmj (60x40)를 5개 마을 TMJ(각 20x20)로 분할
각 TMJ + 타일셋 PNG를 GCS에 업로드
Redis에 마을 메타데이터 생성
기존 글로벌 커스텀 타일을 마을별로 분리
에이전트 mapName을 새 slug로 매핑

scripts/migrate-to-villages.ts (NEW)
구현 순서 요약
Phase	내용	핵심 파일
1	Redis 스키마 + Village CRUD API + GCS 연동	api/villages/, lib/gcs.ts
2	VillageStore + VillageLoader + TMJ 로더 추출	stores/useVillageStore.ts, hooks/useVillageLoader.ts, lib/village-map-loader.ts
3	멀티 빌리지 렌더링 리팩토링	hooks/useTiledMap.ts
4	URL 파라미터 + 마을 전환 + 이동 검증	app/page.tsx, hooks/useGameState.tsx
5	상수 정리 + 에이전트 시스템	constants/game.ts, lib/agent.ts
6	빌드 시스템 마을별 분리	api/custom-tiles/, stores/useBuildStore.ts
7	데이터 마이그레이션 스크립트	scripts/migrate-to-villages.ts