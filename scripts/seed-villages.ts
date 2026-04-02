/**
 * 기본 마을 데이터를 Redis에 등록하는 스크립트
 *
 * 실행 방법: 
 *   npx tsx scripts/seed-villages.ts           # 기존 데이터 유지하고 추가
 *   npx tsx scripts/seed-villages.ts --clear   # 기존 데이터 삭제 후 재등록
 */

// 환경변수 로딩 (가장 먼저 실행되어야 함)
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from 'redis';

// .env.local 파일 우선, 없으면 .env 파일 로드
const envLocalResult = config({ path: resolve(process.cwd(), '.env.local') });
const envResult = config({ path: resolve(process.cwd(), '.env') });

if (envLocalResult.error && envResult.error) {
  console.warn('환경변수 파일을 찾을 수 없습니다. 시스템 환경변수를 사용합니다.');
} else {
  console.log('환경변수 파일 로드 완료');
}

interface VillageMetadata {
  slug: string;
  name: string;
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
  tmjUrl: string;
  tilesetBaseUrl: string;
  createdAt: number;
  updatedAt: number;
}

const VILLAGE_KEY_PREFIX = 'village:';
const VILLAGE_GRID_PREFIX = 'village:grid:';
const VILLAGES_ALL_KEY = 'villages:all';

function gridKey(gridX: number, gridY: number): string {
  return `${gridX},${gridY}`;
}

// Redis 클라이언트 생성
const redis = createClient({
  url: process.env.AINSPACE_STORAGE_REDIS_URL || 'redis://localhost:6379'
});

// Firebase Storage bucket name
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET;
if (!STORAGE_BUCKET) {
  throw new Error('FIREBASE_STORAGE_BUCKET environment variable is not set');
}

// GCS URL 생성 헬퍼 함수
function getVillageTmjUrl(slug: string): string {
  return `https://storage.googleapis.com/${STORAGE_BUCKET}/villages/${slug}/map.tmj`;
}

function getVillageTilesetBaseUrl(): string {
  return `https://storage.googleapis.com/${STORAGE_BUCKET}/villages`;
}

// Redis 작업 함수들
async function saveVillage(village: VillageMetadata): Promise<void> {
  const gw = village.gridWidth || 1;
  const gh = village.gridHeight || 1;

  // 마을 메타데이터 저장 (Hash)
  await redis.hSet(`${VILLAGE_KEY_PREFIX}${village.slug}`, {
    slug: village.slug,
    name: village.name,
    gridX: village.gridX.toString(),
    gridY: village.gridY.toString(),
    gridWidth: gw.toString(),
    gridHeight: gh.toString(),
    tmjUrl: village.tmjUrl,
    tilesetBaseUrl: village.tilesetBaseUrl,
    createdAt: village.createdAt.toString(),
    updatedAt: village.updatedAt.toString(),
  });

  // 점유하는 모든 격자 셀에 역방향 인덱스 등록
  for (let dy = 0; dy < gh; dy++) {
    for (let dx = 0; dx < gw; dx++) {
      await redis.set(
        `${VILLAGE_GRID_PREFIX}${gridKey(village.gridX + dx, village.gridY + dy)}`,
        village.slug,
      );
    }
  }

  // 전체 목록에 추가
  await redis.sAdd(VILLAGES_ALL_KEY, village.slug);
}

async function deleteVillage(slug: string): Promise<void> {
  const data = await redis.hGetAll(`${VILLAGE_KEY_PREFIX}${slug}`);
  if (!data || Object.keys(data).length === 0) return;

  const gridX = parseInt(data.gridX) || 0;
  const gridY = parseInt(data.gridY) || 0;
  const gw = parseInt(data.gridWidth) || 1;
  const gh = parseInt(data.gridHeight) || 1;

  await redis.del(`${VILLAGE_KEY_PREFIX}${slug}`);

  // 점유하는 모든 격자 셀의 역방향 인덱스 제거
  for (let dy = 0; dy < gh; dy++) {
    for (let dx = 0; dx < gw; dx++) {
      await redis.del(`${VILLAGE_GRID_PREFIX}${gridKey(gridX + dx, gridY + dy)}`);
    }
  }

  await redis.sRem(VILLAGES_ALL_KEY, slug);
}

async function getAllVillages(): Promise<VillageMetadata[]> {
  const slugs = await redis.sMembers(VILLAGES_ALL_KEY);
  if (slugs.length === 0) return [];

  const villages: VillageMetadata[] = [];
  for (const slug of slugs) {
    const data = await redis.hGetAll(`${VILLAGE_KEY_PREFIX}${slug}`);
    if (data && Object.keys(data).length > 0) {
      villages.push({
        slug: data.slug,
        name: data.name,
        gridX: parseInt(data.gridX) || 0,
        gridY: parseInt(data.gridY) || 0,
        gridWidth: parseInt(data.gridWidth) || 1,
        gridHeight: parseInt(data.gridHeight) || 1,
        tmjUrl: data.tmjUrl || '',
        tilesetBaseUrl: data.tilesetBaseUrl || '',
        createdAt: parseInt(data.createdAt) || 0,
        updatedAt: parseInt(data.updatedAt) || 0,
      });
    }
  }
  return villages;
}

// 등록할 마을 데이터 배열 (slug만 정의, URL은 자동 생성)
const villageConfigs: Array<Omit<VillageMetadata, 'createdAt' | 'updatedAt' | 'tmjUrl' | 'tilesetBaseUrl'>> = [
  {
    slug: 'happy-village',
    name: 'Happy Village',
    gridX: 0,
    gridY: 0,
    gridWidth: 1,
    gridHeight: 1,
  },
  {
    slug: 'hahoe-village',
    name: 'Hahoe Village',
    gridX: -1,
    gridY: 0,
    gridWidth: 1,
    gridHeight: 1,
  },
  {
    slug: 'uncommon-village',
    name: 'Uncommon Village',
    gridX: -1,
    gridY: 1,
    gridWidth: 2,
    gridHeight: 1,
  },
  {
    slug: 'walkerhill-village',
    name: 'Walkerhill Village',
    gridX: 1,
    gridY: 1,
    gridWidth: 1,
    gridHeight: 1,
  },
  {
    slug: 'daolab-village',
    name: 'DAOLab Village',
    gridX: 1,
    gridY: 0,
    gridWidth: 1,
    gridHeight: 1,
  },
  {
    slug: 'unblock-village',
    name: 'Unblock Village',
    gridX: 1,
    gridY: -1,
    gridWidth: 1,
    gridHeight: 1,
  },
  {
    slug: 'peshka',
    name: 'Peshka',
    gridX: -2,
    gridY: 1,
    gridWidth: 1,
    gridHeight: 1,
  }
];

// URL이 포함된 완전한 마을 데이터 생성
const villages: Omit<VillageMetadata, 'createdAt' | 'updatedAt'>[] = villageConfigs.map(config => ({
  ...config,
  tmjUrl: getVillageTmjUrl(config.slug),
  tilesetBaseUrl: getVillageTilesetBaseUrl(),
}));

async function clearAllVillages() {
  console.log('🧹 Clearing existing villages...\n');

  const existingVillages = await getAllVillages();
  let deleteCount = 0;

  for (const village of existingVillages) {
    try {
      await deleteVillage(village.slug);
      console.log(`✓ Deleted: ${village.name} (${village.slug})`);
      deleteCount++;
    } catch (err) {
      console.error(`✗ Failed to delete ${village.slug}:`, err instanceof Error ? err.message : err);
    }
  }

  // villages:all SET 완전히 초기화 (orphan entries 방지)
  await redis.del(VILLAGES_ALL_KEY);
  console.log('✓ Cleared villages:all SET\n');

  console.log(`📊 Cleared ${deleteCount} villages\n`);
}

async function seedVillages() {
  console.log('🌱 Starting village seeding...\n');

  const now = Date.now();
  let successCount = 0;
  let failCount = 0;

  for (const villageData of villages) {
    const village: VillageMetadata = {
      ...villageData,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await saveVillage(village);
      console.log(`✓ Registered: ${village.name} (${village.slug}) at grid (${village.gridX}, ${village.gridY})`);
      successCount++;
    } catch (err) {
      console.error(`✗ Failed to register ${village.slug}:`, err instanceof Error ? err.message : err);
      failCount++;
    }
  }

  console.log(`\n📊 Summary: ${successCount} succeeded, ${failCount} failed`);
}

// 실행
async function main() {
  console.log('Connecting to Redis...');
  await redis.connect();
  console.log('Connected to Redis\n');

  try {
    const shouldClear = process.argv.includes('--clear');

    if (shouldClear) {
      await clearAllVillages();
    }

    await seedVillages();
  } finally {
    await redis.quit();
    console.log('\nDisconnected from Redis');
  }
}

main()
  .then(() => {
    console.log('✅ Village seeding completed!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error during seeding:', err);
    process.exit(1);
  });
