/**
 * Auth & Permission 관리 CLI 스크립트
 *
 * 사용법:
 *   npx tsx scripts/manage-auth.ts <command> [options]
 *
 * === User 관리 ===
 *   npx tsx scripts/manage-auth.ts user:get <userId>
 *   npx tsx scripts/manage-auth.ts user:grant <userId> <auth1,auth2,...>
 *   npx tsx scripts/manage-auth.ts user:revoke <userId> <auth1,auth2,...>
 *   npx tsx scripts/manage-auth.ts user:set <userId> <auth1,auth2,...>
 *   npx tsx scripts/manage-auth.ts user:delete <userId>
 *   npx tsx scripts/manage-auth.ts user:list
 *
 * === Auth Definition 관리 ===
 *   npx tsx scripts/manage-auth.ts auth:list
 *   npx tsx scripts/manage-auth.ts auth:get <name>
 *   npx tsx scripts/manage-auth.ts auth:delete <name>
 *   npx tsx scripts/manage-auth.ts auth:init
 *   npx tsx scripts/manage-auth.ts auth:create <name> --permissions '<json>'
 *
 * 예시:
 *   npx tsx scripts/manage-auth.ts user:grant 0x1234...abcd admin
 *   npx tsx scripts/manage-auth.ts user:grant 0x1234...abcd ain_token_holder,admin
 *   npx tsx scripts/manage-auth.ts user:revoke 0x1234...abcd admin
 *   npx tsx scripts/manage-auth.ts auth:create beta_tester --permissions '{"importAgent":true,"placeAgent":1,"placeAllowedMaps":["happy-village"]}'
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from 'redis';

// 환경변수 로딩
const envLocalResult = config({ path: resolve(process.cwd(), '.env.local') });
const envResult = config({ path: resolve(process.cwd(), '.env') });

if (envLocalResult.error && envResult.error) {
  console.warn('Warning: No .env file found. Using system environment variables.');
}

// Redis 클라이언트
const redis = createClient({
  url: process.env.AINSPACE_STORAGE_REDIS_URL || 'redis://localhost:6379',
});

// Constants (from src/lib/auth/redis.ts)
const AUTH_KEY_PREFIX = 'auth';
const USER_KEY_PREFIX = 'user';
const AUTH_FIELD = 'auth';
const PERMISSIONS_FIELD = 'permissions';

// Types (inline to avoid import path issues)
interface FeaturePermissions {
  importAgent?: boolean;
  placeAgent?: boolean | number;
  placeAllowedMaps?: string[];
  mapBuild?: boolean;
  buildAllowedMaps?: string[];
  adminAccess?: boolean;
}

interface AuthDefinition {
  name: string;
  permissions: FeaturePermissions;
  tokenRequirements: unknown[];
}

const DEFAULT_PERMISSIONS: FeaturePermissions = {
  importAgent: false,
  placeAgent: false,
  placeAllowedMaps: [],
  mapBuild: false,
  buildAllowedMaps: [],
  adminAccess: false,
};

// ─── Permission Merge Logic (from src/lib/auth/merge.ts) ───

function mergePermissions(permissionsList: FeaturePermissions[]): FeaturePermissions {
  const merged: FeaturePermissions = { ...DEFAULT_PERMISSIONS };

  permissionsList.forEach((perms) => {
    if (perms.importAgent) merged.importAgent = true;
    if (perms.mapBuild) merged.mapBuild = true;
    if (perms.adminAccess) merged.adminAccess = true;

    if (perms.placeAgent !== undefined) {
      if (merged.placeAgent === true) {
        // already unlimited
      } else if (perms.placeAgent === true) {
        merged.placeAgent = true;
      } else if (typeof perms.placeAgent === 'number') {
        const currentMax = typeof merged.placeAgent === 'number' ? merged.placeAgent : 0;
        merged.placeAgent = Math.max(currentMax, perms.placeAgent);
      }
    }

    if (perms.placeAllowedMaps && perms.placeAllowedMaps.length > 0) {
      if (merged.placeAllowedMaps?.includes('*')) {
        // already all maps
      } else if (perms.placeAllowedMaps.includes('*')) {
        merged.placeAllowedMaps = ['*'];
      } else {
        const current = merged.placeAllowedMaps || [];
        merged.placeAllowedMaps = [...new Set([...current, ...perms.placeAllowedMaps])];
      }
    }

    if (perms.buildAllowedMaps && perms.buildAllowedMaps.length > 0) {
      if (merged.buildAllowedMaps?.includes('*')) {
        // already all maps
      } else if (perms.buildAllowedMaps.includes('*')) {
        merged.buildAllowedMaps = ['*'];
      } else {
        const current = merged.buildAllowedMaps || [];
        merged.buildAllowedMaps = [...new Set([...current, ...perms.buildAllowedMaps])];
      }
    }
  });

  return merged;
}

// ─── Redis Helpers ───

async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  for await (const batch of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
    keys.push(...batch);
  }
  return keys;
}

async function getAuthDefinition(name: string): Promise<AuthDefinition | null> {
  const data = await redis.hGetAll(`${AUTH_KEY_PREFIX}:${name}`);
  if (!data || Object.keys(data).length === 0) return null;
  return {
    name: data.name,
    permissions: JSON.parse(data.permissions),
    tokenRequirements: JSON.parse(data.tokenRequirements),
  };
}

async function getAllAuthDefinitions(): Promise<AuthDefinition[]> {
  const keys = await scanKeys(`${AUTH_KEY_PREFIX}:*`);
  if (keys.length === 0) return [];

  const definitions = await Promise.all(
    keys.map(async (key) => {
      const data = await redis.hGetAll(key);
      if (!data || Object.keys(data).length === 0) return null;
      return {
        name: data.name,
        permissions: JSON.parse(data.permissions),
        tokenRequirements: JSON.parse(data.tokenRequirements),
      } as AuthDefinition;
    })
  );

  return definitions.filter((d): d is AuthDefinition => d !== null);
}

async function saveUserAuths(userId: string, auths: string[]): Promise<void> {
  const key = `${USER_KEY_PREFIX}:${userId}`;
  const authDefs = await getAllAuthDefinitions();
  const relevantAuths = authDefs.filter((a) => auths.includes(a.name));
  const permissions = mergePermissions(relevantAuths.map((a) => a.permissions));

  await redis.hSet(key, {
    userId,
    [AUTH_FIELD]: JSON.stringify(auths),
    [PERMISSIONS_FIELD]: JSON.stringify(permissions),
    authCheckedAt: new Date().toISOString(),
    authVersion: '1.0',
  });
}

// ─── Formatters ───

function formatPermissions(perms: FeaturePermissions): string {
  const lines = [
    `  importAgent:       ${perms.importAgent ?? false}`,
    `  placeAgent:        ${perms.placeAgent === true ? 'unlimited' : perms.placeAgent ?? false}`,
    `  placeAllowedMaps:  [${(perms.placeAllowedMaps || []).join(', ')}]`,
    `  mapBuild:          ${perms.mapBuild ?? false}`,
    `  buildAllowedMaps:  [${(perms.buildAllowedMaps || []).join(', ')}]`,
    `  adminAccess:       ${perms.adminAccess ?? false}`,
  ];
  return lines.join('\n');
}

// ─── Commands ───

async function cmdUserGet(userId: string) {
  const key = `${USER_KEY_PREFIX}:${userId}`;
  const data = await redis.hGetAll(key);

  if (!data || Object.keys(data).length === 0) {
    console.log(`No permissions found for user: ${userId}`);
    return;
  }

  const auths: string[] = data[AUTH_FIELD] ? JSON.parse(data[AUTH_FIELD]) : [];
  const permissions: FeaturePermissions = data[PERMISSIONS_FIELD]
    ? JSON.parse(data[PERMISSIONS_FIELD])
    : {};

  console.log(`\nUser: ${userId}`);
  console.log(`Auths: [${auths.join(', ')}]`);
  console.log(`Checked At: ${data.authCheckedAt || 'N/A'}`);
  console.log(`\nPermissions:`);
  console.log(formatPermissions(permissions));
  console.log('');
}

async function cmdUserGrant(userId: string, authsToAdd: string[]) {
  // 존재하는 auth인지 확인
  const allDefs = await getAllAuthDefinitions();
  const validNames = new Set(allDefs.map((d) => d.name));
  const invalid = authsToAdd.filter((a) => !validNames.has(a));

  if (invalid.length > 0) {
    console.error(`Error: Unknown auth(s): ${invalid.join(', ')}`);
    console.log(`Available auths: ${[...validNames].join(', ')}`);
    return;
  }

  // 기존 auths 가져오기
  const key = `${USER_KEY_PREFIX}:${userId}`;
  const data = await redis.hGetAll(key);
  const existingAuths: string[] =
    data && data[AUTH_FIELD] ? JSON.parse(data[AUTH_FIELD]) : [];

  // 합치기 (중복 제거)
  const newAuths = [...new Set([...existingAuths, ...authsToAdd])];

  const added = authsToAdd.filter((a) => !existingAuths.includes(a));
  const skipped = authsToAdd.filter((a) => existingAuths.includes(a));

  await saveUserAuths(userId, newAuths);

  console.log(`\nUser: ${userId}`);
  if (added.length > 0) console.log(`  Added:   [${added.join(', ')}]`);
  if (skipped.length > 0) console.log(`  Skipped: [${skipped.join(', ')}] (already granted)`);
  console.log(`  Result:  [${newAuths.join(', ')}]`);

  // 최종 권한 표시
  const finalData = await redis.hGetAll(key);
  const finalPerms = finalData[PERMISSIONS_FIELD]
    ? JSON.parse(finalData[PERMISSIONS_FIELD])
    : {};
  console.log(`\nFinal Permissions:`);
  console.log(formatPermissions(finalPerms));
  console.log('');
}

async function cmdUserRevoke(userId: string, authsToRemove: string[]) {
  const key = `${USER_KEY_PREFIX}:${userId}`;
  const data = await redis.hGetAll(key);

  if (!data || !data[AUTH_FIELD]) {
    console.log(`No permissions found for user: ${userId}`);
    return;
  }

  const existingAuths: string[] = JSON.parse(data[AUTH_FIELD]);
  const newAuths = existingAuths.filter((a) => !authsToRemove.includes(a));

  const removed = authsToRemove.filter((a) => existingAuths.includes(a));
  const notFound = authsToRemove.filter((a) => !existingAuths.includes(a));

  await saveUserAuths(userId, newAuths);

  console.log(`\nUser: ${userId}`);
  if (removed.length > 0) console.log(`  Revoked:   [${removed.join(', ')}]`);
  if (notFound.length > 0) console.log(`  Not found: [${notFound.join(', ')}] (user didn't have)`);
  console.log(`  Result:    [${newAuths.join(', ')}]`);

  // 최종 권한 표시
  const finalData = await redis.hGetAll(key);
  const finalPerms = finalData[PERMISSIONS_FIELD]
    ? JSON.parse(finalData[PERMISSIONS_FIELD])
    : {};
  console.log(`\nFinal Permissions:`);
  console.log(formatPermissions(finalPerms));
  console.log('');
}

async function cmdUserSet(userId: string, auths: string[]) {
  // 존재하는 auth인지 확인
  const allDefs = await getAllAuthDefinitions();
  const validNames = new Set(allDefs.map((d) => d.name));
  const invalid = auths.filter((a) => !validNames.has(a));

  if (invalid.length > 0) {
    console.error(`Error: Unknown auth(s): ${invalid.join(', ')}`);
    console.log(`Available auths: ${[...validNames].join(', ')}`);
    return;
  }

  await saveUserAuths(userId, auths);

  console.log(`\nUser: ${userId}`);
  console.log(`  Set auths: [${auths.join(', ')}]`);

  const key = `${USER_KEY_PREFIX}:${userId}`;
  const finalData = await redis.hGetAll(key);
  const finalPerms = finalData[PERMISSIONS_FIELD]
    ? JSON.parse(finalData[PERMISSIONS_FIELD])
    : {};
  console.log(`\nFinal Permissions:`);
  console.log(formatPermissions(finalPerms));
  console.log('');
}

async function cmdUserDelete(userId: string) {
  const key = `${USER_KEY_PREFIX}:${userId}`;
  const data = await redis.hGetAll(key);

  if (!data || Object.keys(data).length === 0) {
    console.log(`No permissions found for user: ${userId}`);
    return;
  }

  await redis.hDel(key, AUTH_FIELD);
  await redis.hDel(key, PERMISSIONS_FIELD);

  console.log(`Deleted permissions for user: ${userId}`);
}

async function cmdUserList() {
  const keys = await scanKeys(`${USER_KEY_PREFIX}:*`);

  // user:* 중에서 auth 필드가 있는 것만 필터 (threads, agent_combos 등 제외)
  const users: Array<{ userId: string; auths: string[]; checkedAt: string }> = [];

  for (const key of keys) {
    // user:xxx:threads 같은 하위 키는 제외
    if (key.split(':').length > 2) continue;

    const data = await redis.hGetAll(key);
    if (!data || !data[AUTH_FIELD]) continue;

    users.push({
      userId: data.userId || key.replace(`${USER_KEY_PREFIX}:`, ''),
      auths: JSON.parse(data[AUTH_FIELD]),
      checkedAt: data.authCheckedAt || 'N/A',
    });
  }

  if (users.length === 0) {
    console.log('No users with permissions found.');
    return;
  }

  console.log(`\nFound ${users.length} user(s) with permissions:\n`);

  for (const user of users) {
    const authStr = user.auths.length > 0 ? user.auths.join(', ') : '(none)';
    console.log(`  ${user.userId}`);
    console.log(`    auths: [${authStr}]`);
    console.log(`    checked: ${user.checkedAt}`);
    console.log('');
  }
}

async function cmdAuthList() {
  const definitions = await getAllAuthDefinitions();

  if (definitions.length === 0) {
    console.log('No auth definitions found. Run `auth:init` to initialize defaults.');
    return;
  }

  console.log(`\nFound ${definitions.length} auth definition(s):\n`);

  for (const auth of definitions) {
    const tokenCount = auth.tokenRequirements?.length || 0;
    console.log(`[${auth.name}] (${tokenCount} token requirement(s))`);
    console.log(formatPermissions(auth.permissions));
    console.log('');
  }
}

async function cmdAuthGet(name: string) {
  const auth = await getAuthDefinition(name);

  if (!auth) {
    console.log(`Auth definition not found: ${name}`);
    return;
  }

  console.log(`\nAuth Definition: ${auth.name}\n`);
  console.log('Permissions:');
  console.log(formatPermissions(auth.permissions));
  console.log(`\nToken Requirements (${auth.tokenRequirements.length}):`);
  console.log(JSON.stringify(auth.tokenRequirements, null, 2));
  console.log('');
}

async function cmdAuthDelete(name: string) {
  const existing = await getAuthDefinition(name);
  if (!existing) {
    console.log(`Auth definition not found: ${name}`);
    return;
  }

  await redis.del(`${AUTH_KEY_PREFIX}:${name}`);
  console.log(`Deleted auth definition: ${name}`);
}

async function cmdAuthInit() {
  // Default auth definitions (from src/lib/auth/defaultAuths.ts)
  const defaults: AuthDefinition[] = [
    {
      name: 'ain_token_holder',
      permissions: {
        importAgent: true,
        placeAgent: 3,
        placeAllowedMaps: ['happy-village'],
        mapBuild: true,
        buildAllowedMaps: ['happy-village'],
      },
      tokenRequirements: [
        { standard: 'erc20', chain: 'Ethereum', address: '0x3A810ff7211b40c4fA76205a14efe161615d0385', source: 'onchain' },
        { standard: 'erc20', chain: 'Base', address: '0xD4423795fd904D9B87554940a95FB7016f172773', source: 'onchain' },
        { standard: 'erc20', chain: 'Base', address: '0x70e68AF68933D976565B1882D80708244E0C4fe9', source: 'onchain' },
        { standard: 'erc1155', chain: 'Ethereum', address: '0x495f947276749Ce646f68AC8c248420045cb7b5e', source: 'opensea', collection: 'mysterious-minieggs' },
      ],
    },
    {
      name: 'uncommon_member',
      permissions: {
        importAgent: true,
        placeAgent: 3,
        placeAllowedMaps: ['uncommon-village'],
        mapBuild: true,
        buildAllowedMaps: ['uncommon-village'],
      },
      tokenRequirements: [
        { standard: 'erc1155', chain: 'Base', address: '0x04884Fdf78b9F0539ac19EAe41053b5cE2eAEA7f', source: 'onchain', tokenId: '0' },
      ],
    },
    {
      name: 'admin',
      permissions: {
        importAgent: true,
        placeAgent: true,
        placeAllowedMaps: ['*'],
        mapBuild: true,
        buildAllowedMaps: ['*'],
        adminAccess: true,
      },
      tokenRequirements: [],
    },
  ];

  for (const auth of defaults) {
    await redis.hSet(`${AUTH_KEY_PREFIX}:${auth.name}`, {
      name: auth.name,
      permissions: JSON.stringify(auth.permissions),
      tokenRequirements: JSON.stringify(auth.tokenRequirements),
    });
    console.log(`  Initialized: ${auth.name}`);
  }

  console.log(`\nInitialized ${defaults.length} default auth definitions.`);
}

async function cmdAuthCreate(name: string, permissionsJson: string) {
  const existing = await getAuthDefinition(name);
  if (existing) {
    console.error(`Error: Auth definition already exists: ${name}`);
    console.log('Use auth:delete first if you want to replace it.');
    return;
  }

  let permissions: FeaturePermissions;
  try {
    permissions = JSON.parse(permissionsJson);
  } catch {
    console.error('Error: Invalid JSON for --permissions');
    console.log('Example: --permissions \'{"importAgent":true,"placeAgent":1,"placeAllowedMaps":["happy-village"]}\'');
    return;
  }

  await redis.hSet(`${AUTH_KEY_PREFIX}:${name}`, {
    name,
    permissions: JSON.stringify(permissions),
    tokenRequirements: JSON.stringify([]),
  });

  console.log(`\nCreated auth definition: ${name}\n`);
  console.log('Permissions:');
  console.log(formatPermissions(permissions));
  console.log('\nToken Requirements: [] (none - must be manually assigned via user:grant)');
  console.log('');
}

// ─── Usage ───

function printUsage() {
  console.log(`
Auth & Permission Management CLI

Usage: npx tsx scripts/manage-auth.ts <command> [options]

User Commands:
  user:get <userId>                    Get user's permissions
  user:grant <userId> <auths>          Add auth(s) to user (comma-separated)
  user:revoke <userId> <auths>         Remove auth(s) from user (comma-separated)
  user:set <userId> <auths>            Replace all user's auths (comma-separated)
  user:delete <userId>                 Delete user's permission data
  user:list                            List all users with permissions

Auth Definition Commands:
  auth:list                            List all auth definitions
  auth:get <name>                      Get specific auth definition
  auth:delete <name>                   Delete auth definition
  auth:init                            Initialize default auth definitions
  auth:create <name> --permissions '<json>'
                                       Create new auth definition

Examples:
  npx tsx scripts/manage-auth.ts user:get 0x1234...abcd
  npx tsx scripts/manage-auth.ts user:grant 0x1234...abcd admin
  npx tsx scripts/manage-auth.ts user:grant 0x1234...abcd ain_token_holder,admin
  npx tsx scripts/manage-auth.ts user:revoke 0x1234...abcd admin
  npx tsx scripts/manage-auth.ts user:set 0x1234...abcd ain_token_holder
  npx tsx scripts/manage-auth.ts auth:create beta_tester --permissions '{"importAgent":true,"placeAgent":1,"placeAllowedMaps":["happy-village"]}'
`);
}

// ─── Main ───

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  console.log('Connecting to Redis...');
  await redis.connect();
  console.log('Connected.');

  try {
    switch (command) {
      // User commands
      case 'user:get': {
        const userId = args[1];
        if (!userId) { console.error('Error: userId is required'); break; }
        await cmdUserGet(userId);
        break;
      }
      case 'user:grant': {
        const userId = args[1];
        const auths = args[2]?.split(',').map((s) => s.trim()).filter(Boolean);
        if (!userId || !auths?.length) {
          console.error('Error: userId and auths are required');
          console.log('Usage: user:grant <userId> <auth1,auth2,...>');
          break;
        }
        await cmdUserGrant(userId, auths);
        break;
      }
      case 'user:revoke': {
        const userId = args[1];
        const auths = args[2]?.split(',').map((s) => s.trim()).filter(Boolean);
        if (!userId || !auths?.length) {
          console.error('Error: userId and auths are required');
          console.log('Usage: user:revoke <userId> <auth1,auth2,...>');
          break;
        }
        await cmdUserRevoke(userId, auths);
        break;
      }
      case 'user:set': {
        const userId = args[1];
        const auths = args[2]?.split(',').map((s) => s.trim()).filter(Boolean);
        if (!userId || !auths) {
          console.error('Error: userId and auths are required');
          console.log('Usage: user:set <userId> <auth1,auth2,...>');
          break;
        }
        await cmdUserSet(userId, auths);
        break;
      }
      case 'user:delete': {
        const userId = args[1];
        if (!userId) { console.error('Error: userId is required'); break; }
        await cmdUserDelete(userId);
        break;
      }
      case 'user:list': {
        await cmdUserList();
        break;
      }

      // Auth definition commands
      case 'auth:list': {
        await cmdAuthList();
        break;
      }
      case 'auth:get': {
        const name = args[1];
        if (!name) { console.error('Error: auth name is required'); break; }
        await cmdAuthGet(name);
        break;
      }
      case 'auth:delete': {
        const name = args[1];
        if (!name) { console.error('Error: auth name is required'); break; }
        await cmdAuthDelete(name);
        break;
      }
      case 'auth:init': {
        await cmdAuthInit();
        break;
      }
      case 'auth:create': {
        const name = args[1];
        const permIdx = args.indexOf('--permissions');
        const permJson = permIdx >= 0 ? args[permIdx + 1] : undefined;
        if (!name || !permJson) {
          console.error('Error: name and --permissions are required');
          console.log("Usage: auth:create <name> --permissions '<json>'");
          break;
        }
        await cmdAuthCreate(name, permJson);
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
    }
  } finally {
    await redis.quit();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
