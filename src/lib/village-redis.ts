import { getRedisClient } from './redis';
import { gridKey } from './village-utils';

export interface VillageMetadata {
  slug: string;
  name: string;
  gridX: number;
  gridY: number;
  gridWidth: number;   // 격자 가로 크기 (기본 1)
  gridHeight: number;  // 격자 세로 크기 (기본 1)
  tmjUrl: string;
  tilesetBaseUrl: string;
  createdAt: number;
  updatedAt: number;
}

const VILLAGE_KEY_PREFIX = 'village:';
const VILLAGE_GRID_PREFIX = 'village:grid:';
const VILLAGES_ALL_KEY = 'villages:all';

/**
 * 마을 메타데이터를 Redis에 저장한다.
 * 점유하는 격자 위치가 이미 다른 마을에 사용 중이면 에러를 던진다.
 */
export async function saveVillage(village: VillageMetadata): Promise<void> {
  const redis = await getRedisClient();
  const gw = village.gridWidth || 1;
  const gh = village.gridHeight || 1;

  // 점유할 모든 격자 셀의 중복 체크
  for (let dy = 0; dy < gh; dy++) {
    for (let dx = 0; dx < gw; dx++) {
      const key = gridKey(village.gridX + dx, village.gridY + dy);
      const existingSlug = await redis.get(`${VILLAGE_GRID_PREFIX}${key}`);
      if (existingSlug && existingSlug !== village.slug) {
        throw new Error(`Grid position (${village.gridX + dx}, ${village.gridY + dy}) is already occupied by village "${existingSlug}"`);
      }
    }
  }

  // slug 중복 체크 (새로 생성 시)
  const originKey = gridKey(village.gridX, village.gridY);
  const originSlug = await redis.get(`${VILLAGE_GRID_PREFIX}${originKey}`);
  if (!originSlug) {
    const existingVillage = await redis.hGetAll(`${VILLAGE_KEY_PREFIX}${village.slug}`);
    if (existingVillage && Object.keys(existingVillage).length > 0) {
      throw new Error(`Village slug "${village.slug}" already exists`);
    }
  }

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

/**
 * slug로 마을 메타데이터를 조회한다.
 */
export async function getVillage(slug: string): Promise<VillageMetadata | null> {
  const redis = await getRedisClient();
  const data = await redis.hGetAll(`${VILLAGE_KEY_PREFIX}${slug}`);

  if (!data || Object.keys(data).length === 0) {
    return null;
  }

  return parseVillageData(data);
}

/**
 * 격자 좌표로 마을을 조회한다.
 */
export async function getVillageByGrid(gridX: number, gridY: number): Promise<VillageMetadata | null> {
  const redis = await getRedisClient();
  const slug = await redis.get(`${VILLAGE_GRID_PREFIX}${gridKey(gridX, gridY)}`);

  if (!slug) return null;
  return getVillage(slug);
}

/**
 * 인접 9칸(자기 자신 포함)의 마을 목록을 반환한다.
 */
export async function getNearbyVillages(
  gridX: number,
  gridY: number,
): Promise<VillageMetadata[]> {
  const redis = await getRedisClient();
  const offsets = [
    [0, 0], [0, -1], [0, 1], [-1, 0], [1, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ];

  const gridKeys = offsets.map(([dx, dy]) =>
    `${VILLAGE_GRID_PREFIX}${gridKey(gridX + dx, gridY + dy)}`
  );

  // 한번에 모든 격자 키 조회
  const slugs = await redis.mGet(gridKeys);

  // null이 아닌 slug들의 메타데이터를 병렬로 조회 (NxM 마을 중복 제거)
  const uniqueSlugs = [...new Set(slugs.filter((s): s is string => s !== null))];
  if (uniqueSlugs.length === 0) return [];

  const villages: VillageMetadata[] = [];
  for (const slug of uniqueSlugs) {
    const data = await redis.hGetAll(`${VILLAGE_KEY_PREFIX}${slug}`);
    if (data && Object.keys(data).length > 0) {
      villages.push(parseVillageData(data));
    }
  }

  return villages;
}

/**
 * 전체 마을 목록을 반환한다.
 */
export async function getAllVillages(): Promise<VillageMetadata[]> {
  const redis = await getRedisClient();
  const slugs = await redis.sMembers(VILLAGES_ALL_KEY);

  if (slugs.length === 0) return [];

  const villages: VillageMetadata[] = [];
  for (const slug of slugs) {
    const data = await redis.hGetAll(`${VILLAGE_KEY_PREFIX}${slug}`);
    if (data && Object.keys(data).length > 0) {
      villages.push(parseVillageData(data));
    }
  }

  return villages;
}

/**
 * 마을 메타데이터를 업데이트한다.
 */
export async function updateVillage(
  slug: string,
  updates: Partial<Pick<VillageMetadata, 'name' | 'tmjUrl' | 'tilesetBaseUrl'>>,
): Promise<VillageMetadata | null> {
  const redis = await getRedisClient();
  const existing = await getVillage(slug);
  if (!existing) return null;

  const fields: Record<string, string> = {
    updatedAt: Date.now().toString(),
  };
  if (updates.name !== undefined) fields.name = updates.name;
  if (updates.tmjUrl !== undefined) fields.tmjUrl = updates.tmjUrl;
  if (updates.tilesetBaseUrl !== undefined) fields.tilesetBaseUrl = updates.tilesetBaseUrl;

  await redis.hSet(`${VILLAGE_KEY_PREFIX}${slug}`, fields);

  return getVillage(slug);
}

/**
 * 마을을 삭제한다.
 */
export async function deleteVillage(slug: string): Promise<boolean> {
  const redis = await getRedisClient();
  const existing = await getVillage(slug);
  if (!existing) return false;

  await redis.del(`${VILLAGE_KEY_PREFIX}${slug}`);

  // 점유하는 모든 격자 셀의 역방향 인덱스 제거
  const gw = existing.gridWidth || 1;
  const gh = existing.gridHeight || 1;
  for (let dy = 0; dy < gh; dy++) {
    for (let dx = 0; dx < gw; dx++) {
      await redis.del(`${VILLAGE_GRID_PREFIX}${gridKey(existing.gridX + dx, existing.gridY + dy)}`);
    }
  }

  await redis.sRem(VILLAGES_ALL_KEY, slug);

  return true;
}

function parseVillageData(data: Record<string, string>): VillageMetadata {
  return {
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
  };
}
