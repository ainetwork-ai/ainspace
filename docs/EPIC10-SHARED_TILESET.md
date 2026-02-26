# EPIC10 - SHARED_TILESET (공유 타일셋 시스템)

> 마을 간 타일셋 공유를 지원하여 GCS 중복 저장을 제거하고, 타일셋 관리를 독립 API로 분리

## 의존성
- 없음 (기존 마을 등록 시스템에 대한 리팩토링)

## 목표
- 공유 타일셋을 `common/tilesets/`에 한 번만 업로드하고, 여러 마을이 참조할 수 있도록 한다.
- `tilesetBaseUrl`을 마을별 경로(`villages/{slug}/tilesets`)에서 루트 경로(`villages/`)로 변경한다.
- TMJ 내 tileset source 경로에 실제 GCS 경로를 포함시켜 공유/개별을 구분한다.
- 기존 마을과의 하위 호환을 유지한다.

---

## 변경 후 GCS 구조

```
villages/                              ← tilesetBaseUrl (루트)
├── common/
│   └── tilesets/                      ← 공유 타일셋
│       ├── AINSpace village asset.tsx
│       └── AINSpace village asset.png
├── village-a/
│   ├── map.tmj                        ← source: "common/tilesets/AINSpace village asset.tsx"
│   └── tilesets/                      ← 개별 타일셋 (선택)
│       └── custom-deco.png
└── village-b/
    └── map.tmj                        ← source: "common/tilesets/AINSpace village asset.tsx"
```

### 로더 해석 방식 (변경 전 → 후)

```
변경 전: tilesetBaseUrl/filename
  https://.../villages/{slug}/tilesets/AINSpace village asset.tsx

변경 후: tilesetBaseUrl/path
  https://.../villages/common/tilesets/AINSpace village asset.tsx
```

---

## Story 10.1: 공유 타일셋 API 생성

**신규 파일:**
- `src/app/api/tilesets/route.ts`
- `src/app/api/tilesets/[name]/route.ts`

### 태스크

#### POST /api/tilesets — 공유 타일셋 업로드
- [x] FormData 수신: `name` (string, 타일셋 식별자), `files` (File[], TSX + 이미지)
- [x] `name` 형식 검증: `/^[a-zA-Z0-9 _-]+$/`
- [x] GCS 업로드: `villages/common/tilesets/{originalFileName}`
  - `.tsx` → `application/xml`
  - `.png` → `image/png`
  - `.webp` → `image/webp`
- [x] 동일 파일명 존재 시 덮어쓰기 (업데이트)
- [x] 응답: `{ success: true, files: [{ fileName, url }] }`

#### GET /api/tilesets — 공유 타일셋 목록 조회
- [x] GCS에서 `villages/common/tilesets/` prefix로 파일 목록 조회
- [x] TSX 파일 기준으로 그룹핑 (TSX 1개 + 연관 이미지들)
- [x] 응답: `{ success: true, tilesets: [{ name, files: [{ fileName, url }] }] }`

#### DELETE /api/tilesets/[name] — 공유 타일셋 삭제
- [x] 해당 name과 관련된 파일 전체 삭제 (TSX + 이미지)
- [x] 현재 참조 중인 마을이 있는지 경고 (삭제 차단은 하지 않음, 경고만)
- [x] 응답: `{ success: true, deletedFiles: number }`

### 주의사항
- Redis 별도 저장 없이 GCS 파일 목록 기반으로 관리 (관리 API로 호출 빈도 낮음)
- 공유 타일셋은 한 번 올리면 거의 변경되지 않는 에셋

---

## Story 10.2: GCS 모듈 확장

**수정 파일:** `src/lib/gcs.ts`

### 태스크
- [x] `uploadSharedTileset(buffer, fileName)` 함수 추가
  - 경로: `villages/common/tilesets/{fileName}`
  - 기존 `uploadVillageMapFile` 재사용, slug 대신 `common` 고정
- [x] `deleteSharedTilesetFiles(fileNames)` 함수 추가
  - `villages/common/tilesets/` 하위 특정 파일 삭제
- [x] `listSharedTilesets()` 함수 추가
  - `villages/common/tilesets/` prefix로 GCS 파일 목록 반환
- [x] `getRootTilesetBaseUrl(bucketName)` 함수 추가
  - 반환: `https://storage.googleapis.com/{bucketName}/villages`
- [x] 기존 `getVillageTilesetBaseUrl` 함수는 유지 (하위 호환)

### 참고 파일
- `src/lib/gcs.ts` — 기존 `uploadVillageMapFile` 패턴 재사용

---

## Story 10.3: 맵 로더 수정 — TSX 이미지 경로 상대 해석

**수정 파일:** `src/lib/village-map-loader.ts`

### 태스크
- [x] TSX 참조 형태에서 이미지 경로 해석을 `tilesetBaseUrl` 기준 → **TSX 파일 위치 기준**으로 변경
  ```typescript
  // 변경 전 (line 81)
  const imagePath = `${tilesetBaseUrl}/${tileset.image.source.replace('./', '')}`;

  // 변경 후
  const tsxDir = ts.source.substring(0, ts.source.lastIndexOf('/') + 1);
  const imagePath = `${tilesetBaseUrl}/${tsxDir}${tileset.image.source.replace('./', '')}`;
  ```
- [x] 하위 호환 확인: 기존 마을 (`ts.source`에 디렉토리 없는 경우)
  - `ts.source = "AINSpace village asset.tsx"` → `tsxDir = ""` → 기존과 동일하게 동작
- [x] 신규 마을 (`ts.source`에 디렉토리 포함) 동작 확인
  - `ts.source = "common/tilesets/AINSpace village asset.tsx"` → `tsxDir = "common/tilesets/"` → 정상 해석
- [x] `loadDefaultVillageMap()` 동작 확인 (로컬 `/map` 경로, 변경 영향 없음)

### 주의사항
- 인라인 타일셋은 TMJ 리라이트에서 `image` 경로를 직접 변경하므로 로더 수정 불필요
- TSX 파일 자체는 수정하지 않음 (원본 유지)

---

## Story 10.4: TMJ 리라이트 유틸리티

**신규 파일:** `src/lib/tmj-rewriter.ts`

### 태스크
- [x] `rewriteTmjTilesetPaths(tmjJson, uploadedFileNames, slug)` 함수 구현
  - `tmjJson`: 파싱된 TMJ 객체
  - `uploadedFileNames`: 이번 요청에서 함께 업로드된 타일셋 파일명 배열
  - `slug`: 마을 slug
- [x] 리라이트 판별 로직:
  - TMJ의 각 tileset entry에 대해:
    - TSX 참조 (`source` 필드): 파일명 추출
    - 인라인 (`image` 필드): 파일명 추출
  - 해당 파일명이 `uploadedFileNames`에 **포함** → 개별: `{slug}/tilesets/{fileName}`
  - 해당 파일명이 `uploadedFileNames`에 **미포함** → 공유: `common/tilesets/{fileName}`
- [x] TSX 참조의 경우 `source` 필드 치환
- [x] 인라인의 경우 `image` 필드 치환
- [x] 리라이트된 TMJ JSON 문자열 반환
- [x] 공유 타일셋 존재 여부 검증 (GCS에 해당 파일이 있는지 확인) — 없으면 에러

### 예시

```
입력 TMJ:
  { "tilesets": [{ "firstgid": 1, "source": "AINSpace village asset.tsx" }] }
  uploadedFileNames: []  (타일셋 파일 미업로드)

출력 TMJ:
  { "tilesets": [{ "firstgid": 1, "source": "common/tilesets/AINSpace village asset.tsx" }] }
```

```
입력 TMJ:
  { "tilesets": [
    { "firstgid": 1, "source": "AINSpace village asset.tsx" },
    { "firstgid": 5441, "source": "custom-deco.tsx" }
  ] }
  uploadedFileNames: ["custom-deco.tsx", "custom-deco.png"]

출력 TMJ:
  { "tilesets": [
    { "firstgid": 1, "source": "common/tilesets/AINSpace village asset.tsx" },
    { "firstgid": 5441, "source": "village-a/tilesets/custom-deco.tsx" }
  ] }
```

### 주의사항
- Tiled Editor가 생성하는 `source` 경로에 `../` 같은 상대 경로가 포함될 수 있음 → 파일명만 추출하여 비교
- TMJ 원본 구조(layers, properties 등)는 절대 변경하지 않음 — tilesets 배열의 경로만 치환

---

## Story 10.5: 마을 등록 API 수정

**수정 파일:** `src/app/api/villages/route.ts`

### 태스크
- [x] TMJ 파일 업로드 시 TMJ 리라이트 적용:
  1. TMJ 파싱
  2. `formData.getAll('tilesets')`에서 파일명 목록 추출
  3. `rewriteTmjTilesetPaths(tmjJson, uploadedFileNames, slug)` 호출
  4. 리라이트된 TMJ를 GCS에 업로드
- [x] 개별 타일셋 파일 업로드 경로 유지: `villages/{slug}/tilesets/{fileName}`
  - 기존 `uploadVillageTileset`, `uploadVillageTsx` 그대로 사용
- [x] `tilesetBaseUrl`을 루트 경로로 변경:
  ```typescript
  // 변경 전
  tilesetBaseUrl = getVillageTilesetBaseUrl(bucketName, slug);
  // 변경 후
  tilesetBaseUrl = getRootTilesetBaseUrl(bucketName);
  ```
- [x] TMJ 없이 등록하는 경우 기존 동작 유지 (빈 문자열)
- [x] 타일셋 파일 업로드 병렬화: `for...of` → `Promise.all`

### 주의사항
- 공유 타일셋은 이 API에서 업로드하지 않음 (Story 10.1의 `/api/tilesets`로 사전 등록)
- `tilesets` FormData에 포함된 파일만 개별 타일셋으로 취급

---

## Story 10.6: 기존 마을 하위 호환

### 태스크
- [x] 로더 하위 호환 확인:
  - 기존 마을: `tilesetBaseUrl` = `.../villages/{slug}/tilesets`, `source` = `filename` → 정상 동작
  - 신규 마을: `tilesetBaseUrl` = `.../villages`, `source` = `common/tilesets/filename` → 정상 동작
- [x] `VillageMetadata` 인터페이스 변경 없음 (`tilesetBaseUrl` 필드 의미만 변경)
- [x] 기존 마을 마이그레이션은 선택사항으로 남겨둠 (운영 스크립트로 별도 처리 가능)
  - TMJ 다운로드 → 리라이트 → 재업로드
  - `tilesetBaseUrl` 업데이트
  - 기존 `villages/{slug}/tilesets/` 파일을 `common/tilesets/`로 이동

### 주의사항
- 기존 마을은 수정 없이 그대로 동작해야 함 (하위 호환 필수)
- 마이그레이션은 이 EPIC 범위 밖 — 별도 운영 작업으로 수행

---

## 구현 규칙

### GCS 경로 규칙
- 공유 타일셋: `villages/common/tilesets/{fileName}`
- 개별 타일셋: `villages/{slug}/tilesets/{fileName}`
- TMJ: `villages/{slug}/map.tmj` (변경 없음)
- 루트 baseUrl: `https://storage.googleapis.com/{bucket}/villages`

### 판별 규칙
- TMJ의 tileset 파일명이 FormData `tilesets`에 **있으면** → 개별
- TMJ의 tileset 파일명이 FormData `tilesets`에 **없으면** → 공유

### 코드 스타일
- 기존 프로젝트 패턴 준수 (Next.js App Router, TypeScript)
- 새 유틸리티는 `src/lib/` 하위에 배치
- import 순서: 외부 라이브러리 → 내부 모듈 → 타입

### 금지사항
- TSX 파일 원본을 수정하지 않는다 (경로 해석은 로더에서 처리)
- TMJ의 tileset 경로 외 다른 데이터(layers, properties 등)를 변경하지 않는다
- 기존 마을의 동작을 깨뜨리지 않는다
- 불필요한 Redis 스키마를 추가하지 않는다

---

## 완료 조건
- [x] `POST /api/tilesets`로 공유 타일셋 업로드 가능
- [x] `GET /api/tilesets`로 공유 타일셋 목록 조회 가능
- [x] 마을 등록 시 TMJ 내 tileset source가 공유/개별 경로로 자동 리라이트
- [x] 동일 타일셋을 사용하는 마을 N개 등록 시 GCS에 1벌만 저장됨
- [x] 기존 마을이 수정 없이 정상 로딩됨
- [x] 신규 마을이 공유 타일셋을 참조하여 정상 로딩됨
- [x] 로컬 default_map.tmj 로딩이 정상 동작
