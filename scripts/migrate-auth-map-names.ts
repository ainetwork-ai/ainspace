/**
 * Auth 데이터의 map name을 slug로 마이그레이션하는 스크립트
 *
 * 기존 ZONE_NAME (HAPPY, HAHOE 등) → slug (happy-village, hahoe-village 등)
 *
 * 실행 방법:
 *   npx tsx scripts/migrate-auth-map-names.ts           # 미리보기 (dry-run)
 *   npx tsx scripts/migrate-auth-map-names.ts --apply   # 실제 적용
 */

// 환경변수 로딩
import { config } from 'dotenv';
import { resolve } from 'path';
import { storageClient } from '../src/lib/storage-client';

const envLocalResult = config({ path: resolve(process.cwd(), '.env.local') });
const envResult = config({ path: resolve(process.cwd(), '.env') });

if (envLocalResult.error && envResult.error) {
  console.warn('환경변수 파일을 찾을 수 없습니다. 시스템 환경변수를 사용합니다.');
} else {
  console.log('환경변수 파일 로드 완료');
}

// AIN storage 클라이언트 생성
const storage = storageClient;

// Map name → slug 매핑 테이블
const MAP_NAME_TO_SLUG: Record<string, string> = {
  // Display names (현재 형식)
  'Happy Village': 'happy-village',
  'Hahoe Village': 'hahoe-village',
  'Uncommon Village': 'uncommon-village',
  'Walkerhill Village': 'walkerhill-village',
  'Unblock Village': 'unblock-village',
  'DAOLab Village': 'daolab-village',
  // Legacy ZONE_NAME 형식 (이전 데이터 호환)
  'HAPPY': 'happy-village',
  'HAHOE': 'hahoe-village',
  'UNCOMMON': 'uncommon-village',
  'WALKERHILL': 'walkerhill-village',
  'UNBLOCK': 'unblock-village',
  'DAOLAB': 'daolab-village',
};

interface MigrationStats {
  authDefinitions: {
    total: number;
    migrated: number;
    unchanged: number;
  };
  userPermissions: {
    total: number;
    migrated: number;
    unchanged: number;
  };
  changes: Array<{
    type: 'auth' | 'user';
    key: string;
    field: string;
    oldValue: string[];
    newValue: string[];
  }>;
}

/**
 * 배열 내의 map name을 slug로 변환
 */
function convertMapNamesToSlugs(mapNames: string[]): string[] {
  return mapNames.map(name => {
    // 이미 slug 형식이면 그대로 반환
    if (name.includes('-village') || name === '*') {
      return name;
    }
    // 매핑 테이블에 있으면 변환 (display name 우선, legacy ZONE_NAME도 지원)
    return MAP_NAME_TO_SLUG[name] || MAP_NAME_TO_SLUG[name.toUpperCase()] || name;
  });
}

/**
 * 두 배열이 다른지 확인
 */
function hasChanged(oldArray: string[], newArray: string[]): boolean {
  if (oldArray.length !== newArray.length) return true;
  return oldArray.some((val, idx) => val !== newArray[idx]);
}

/**
 * Auth Definition 마이그레이션
 */
async function migrateAuthDefinitions(
  dryRun: boolean,
  stats: MigrationStats
): Promise<void> {
  console.log('\n🔍 Scanning auth definitions...\n');

  // auth:* 패턴으로 모든 키 스캔
  const keys: string[] = [];

  for await (const batch of storage.scanIterator({
    MATCH: 'auth:*',
    COUNT: 100
  })) {
    keys.push(...batch);
  }

  stats.authDefinitions.total = keys.length;

  if (keys.length === 0) {
    console.log('ℹ️  No auth definitions found\n');
    return;
  }

  console.log(`Found ${keys.length} auth definitions\n`);

  for (const key of keys) {
    const data = await storage.hGetAll(key);

    if (!data || !data.permissions) continue;

    const permissions = JSON.parse(data.permissions);
    let changed = false;

    // placeAllowedMaps 변환
    if (permissions.placeAllowedMaps && Array.isArray(permissions.placeAllowedMaps)) {
      const oldMaps = permissions.placeAllowedMaps;
      const newMaps = convertMapNamesToSlugs(oldMaps);

      if (hasChanged(oldMaps, newMaps)) {
        changed = true;
        stats.changes.push({
          type: 'auth',
          key,
          field: 'placeAllowedMaps',
          oldValue: oldMaps,
          newValue: newMaps,
        });
        permissions.placeAllowedMaps = newMaps;
      }
    }

    // buildAllowedMaps 변환
    if (permissions.buildAllowedMaps && Array.isArray(permissions.buildAllowedMaps)) {
      const oldMaps = permissions.buildAllowedMaps;
      const newMaps = convertMapNamesToSlugs(oldMaps);

      if (hasChanged(oldMaps, newMaps)) {
        changed = true;
        stats.changes.push({
          type: 'auth',
          key,
          field: 'buildAllowedMaps',
          oldValue: oldMaps,
          newValue: newMaps,
        });
        permissions.buildAllowedMaps = newMaps;
      }
    }

    if (changed) {
      stats.authDefinitions.migrated++;

      if (!dryRun) {
        await storage.hSet(key, 'permissions', JSON.stringify(permissions));
      }

      console.log(`${dryRun ? '📋' : '✅'} ${key}`);
    } else {
      stats.authDefinitions.unchanged++;
    }
  }
}

/**
 * User Permissions 마이그레이션
 */
async function migrateUserPermissions(
  dryRun: boolean,
  stats: MigrationStats
): Promise<void> {
  console.log('\n🔍 Scanning user permissions...\n');

  // user:* 패턴으로 모든 키 스캔
  const keys: string[] = [];

  for await (const batch of storage.scanIterator({
    MATCH: 'user:*',
    COUNT: 100
  })) {
    keys.push(...batch);
  }

  stats.userPermissions.total = keys.length;

  if (keys.length === 0) {
    console.log('ℹ️  No user permissions found\n');
    return;
  }

  console.log(`Found ${keys.length} user permissions\n`);

  for (const key of keys) {
    const data = await storage.hGetAll(key);

    if (!data || !data.permissions) continue;

    const permissions = JSON.parse(data.permissions);
    let changed = false;

    // placeAllowedMaps 변환
    if (permissions.placeAllowedMaps && Array.isArray(permissions.placeAllowedMaps)) {
      const oldMaps = permissions.placeAllowedMaps;
      const newMaps = convertMapNamesToSlugs(oldMaps);

      if (hasChanged(oldMaps, newMaps)) {
        changed = true;
        stats.changes.push({
          type: 'user',
          key,
          field: 'placeAllowedMaps',
          oldValue: oldMaps,
          newValue: newMaps,
        });
        permissions.placeAllowedMaps = newMaps;
      }
    }

    // buildAllowedMaps 변환
    if (permissions.buildAllowedMaps && Array.isArray(permissions.buildAllowedMaps)) {
      const oldMaps = permissions.buildAllowedMaps;
      const newMaps = convertMapNamesToSlugs(oldMaps);

      if (hasChanged(oldMaps, newMaps)) {
        changed = true;
        stats.changes.push({
          type: 'user',
          key,
          field: 'buildAllowedMaps',
          oldValue: oldMaps,
          newValue: newMaps,
        });
        permissions.buildAllowedMaps = newMaps;
      }
    }

    if (changed) {
      stats.userPermissions.migrated++;

      if (!dryRun) {
        await storage.hSet(key, 'permissions', JSON.stringify(permissions));
      }

      console.log(`${dryRun ? '📋' : '✅'} ${key}`);
    } else {
      stats.userPermissions.unchanged++;
    }
  }
}

/**
 * 변경 사항 요약 출력
 */
function printSummary(stats: MigrationStats, dryRun: boolean): void {
  console.log('\n' + '='.repeat(60));
  console.log(`\n📊 Migration Summary ${dryRun ? '(DRY RUN)' : ''}\n`);

  console.log('Auth Definitions:');
  console.log(`  Total:     ${stats.authDefinitions.total}`);
  console.log(`  Migrated:  ${stats.authDefinitions.migrated}`);
  console.log(`  Unchanged: ${stats.authDefinitions.unchanged}`);

  console.log('\nUser Permissions:');
  console.log(`  Total:     ${stats.userPermissions.total}`);
  console.log(`  Migrated:  ${stats.userPermissions.migrated}`);
  console.log(`  Unchanged: ${stats.userPermissions.unchanged}`);

  console.log(`\nTotal Changes: ${stats.changes.length}`);

  if (stats.changes.length > 0) {
    console.log('\n📝 Detailed Changes:\n');

    for (const change of stats.changes) {
      console.log(`${change.type === 'auth' ? '🔐' : '👤'} ${change.key}`);
      console.log(`   ${change.field}:`);
      console.log(`     OLD: [${change.oldValue.join(', ')}]`);
      console.log(`     NEW: [${change.newValue.join(', ')}]`);
      console.log('');
    }
  }

  if (dryRun && stats.changes.length > 0) {
    console.log('\n⚠️  This was a dry run. No changes were applied.');
    console.log('💡 Run with --apply flag to apply changes:\n');
    console.log('   npx tsx scripts/migrate-auth-map-names.ts --apply\n');
  } else if (!dryRun && stats.changes.length > 0) {
    console.log('\n✅ Migration completed successfully!\n');
  } else {
    console.log('\nℹ️  No migration needed. All data is already using slugs.\n');
  }
}

/**
 * 메인 실행 함수
 */
async function main() {
  const dryRun = !process.argv.includes('--apply');

  console.log('Connecting to AIN storage...');
  await storage.connect();
  console.log('Connected to AIN storage\n');

  const stats: MigrationStats = {
    authDefinitions: {
      total: 0,
      migrated: 0,
      unchanged: 0,
    },
    userPermissions: {
      total: 0,
      migrated: 0,
      unchanged: 0,
    },
    changes: [],
  };

  try {
    if (dryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be applied\n');
    } else {
      console.log('⚠️  APPLY MODE - Changes will be written to AIN storage\n');
    }

    // Auth definitions 마이그레이션
    await migrateAuthDefinitions(dryRun, stats);

    // User permissions 마이그레이션
    await migrateUserPermissions(dryRun, stats);

    // 요약 출력
    printSummary(stats, dryRun);

  } finally {
    await storage.close();
    console.log('Disconnected from AIN storage');
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error during migration:', err);
    process.exit(1);
  });
