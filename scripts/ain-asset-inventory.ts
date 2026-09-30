/**
 * 17.7 자산 인벤토리 — Redis 키·Vercel Blob·Firebase Storage(GCS) 객체를 **종류별로 센다**. 읽기 전용.
 *
 *   npx tsx scripts/ain-asset-inventory.ts [--redis] [--blob] [--bucket] [--json] [--max N]
 *   (아무 것도 안 주면 셋 다. 설정이 없는 저장소는 "skipped" 로 보고한다.)
 *
 * 비밀을 읽지 않는다:
 *   - Redis: SCAN 으로 **키 이름만**. GET/HGET 등 값을 읽는 명령은 쓰지 않는다. 비밀 종류(봉인된 aindrive 토큰 등)는
 *     샘플 이름도 접두어까지만 찍는다.
 *   - Blob/Bucket: 목록 API 의 이름·크기만. 바이트는 받지 않는다.
 *   - env 의 URL·토큰·서비스 계정은 출력하지 않는다(설정 여부만).
 * 분류 규칙과 이관 계획은 src/lib/ain-integration/asset-inventory.ts, 설명은 docs/ain-asset-migration.md.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { EXTERNAL_ASSETS, classifyBlobPath, classifyBucketPath, classifyRedisKey, summarize, type AssetKind, type InventoryRow } from '../src/lib/ain-integration/asset-inventory';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const pick = ['--redis', '--blob', '--bucket'].filter(has);
const want = (f: string) => pick.length === 0 || pick.includes(f);
const maxIdx = args.indexOf('--max');
const MAX = maxIdx >= 0 ? Number(args[maxIdx + 1]) || 100_000 : 100_000;

type Item = { name: string; size?: number | null; kind: AssetKind };
const status: Record<string, string> = {};

async function redisItems(): Promise<Item[]> {
  if (!process.env.AINSPACE_STORAGE_REDIS_URL) { status.redis = 'skipped (AINSPACE_STORAGE_REDIS_URL not set)'; return []; }
  const { createClient } = await import('redis');
  const client = createClient({ url: process.env.AINSPACE_STORAGE_REDIS_URL, socket: { connectTimeout: 5000, reconnectStrategy: false } });
  client.on('error', () => { /* 연결 오류 문장에 URL 이 실릴 수 있어 찍지 않는다 */ });
  await client.connect();
  const out: Item[] = [];
  try {
    for await (const batch of client.scanIterator({ MATCH: '*', COUNT: 500 })) {
      for (const key of (Array.isArray(batch) ? batch : [batch]) as string[]) {
        out.push({ name: key, kind: classifyRedisKey(key) });
        if (out.length >= MAX) break;
      }
      if (out.length >= MAX) break;
    }
  } finally { await client.quit(); }
  status.redis = `ok (${out.length} keys${out.length >= MAX ? ', truncated' : ''})`;
  return out;
}

async function blobItems(): Promise<Item[]> {
  const token = process.env.AINSPACE_BLOB_READ_WRITE_TOKEN;
  if (!token) { status.blob = 'skipped (AINSPACE_BLOB_READ_WRITE_TOKEN not set)'; return []; }
  const { list } = await import('@vercel/blob');
  const out: Item[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ token, cursor, limit: 1000 });
    for (const b of page.blobs) out.push({ name: b.pathname, size: b.size, kind: classifyBlobPath(b.pathname) });
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && out.length < MAX);
  status.blob = `ok (${out.length} blobs)`;
  return out;
}

async function bucketItems(): Promise<Item[]> {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY || !process.env.FIREBASE_STORAGE_BUCKET) { status.bucket = 'skipped (FIREBASE_* not set)'; return []; }
  const { getFirebaseStorage } = await import('../src/lib/firebase');
  const bucket = getFirebaseStorage().bucket();
  const [files] = await bucket.getFiles({ maxResults: MAX, autoPaginate: true });
  const out = files.map((f) => ({ name: f.name, size: Number(f.metadata?.size ?? 0) || 0, kind: classifyBucketPath(f.name) }));
  status.bucket = `ok (${out.length} objects)`;
  return out;
}

function print(rows: InventoryRow[]) {
  const fmt = (n: number | null) => (n === null ? '-' : n < 1024 ? `${n}B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)}K` : `${(n / (1 << 20)).toFixed(1)}M`);
  console.log('store   kind                       count     bytes  disposition    note');
  for (const r of rows) {
    console.log(`${r.store.padEnd(7)} ${r.kind.padEnd(26)} ${String(r.count).padStart(6)} ${fmt(r.bytes).padStart(9)}  ${r.disposition.padEnd(13)}  ${r.note}`);
    for (const s of r.samples) console.log(`        · ${s}`);
  }
  for (const e of EXTERNAL_ASSETS) console.log(`${e.store.padEnd(7)} ${e.kind.padEnd(26)} ${'?'.padStart(6)} ${'?'.padStart(9)}  ${e.disposition.padEnd(13)}  ${e.note}`);
  console.log('\nsources:', status);
}

async function main() {
  const items: Item[] = [];
  for (const [flag, fn] of [['--redis', redisItems], ['--blob', blobItems], ['--bucket', bucketItems]] as const) {
    if (!want(flag)) continue;
    try { items.push(...(await fn())); } catch (e) {
      status[flag.slice(2)] = `failed (${e instanceof Error ? e.name : 'error'})`;
    }
  }
  const rows = summarize(items);
  if (has('--json')) console.log(JSON.stringify({ rows, external: EXTERNAL_ASSETS, sources: status }, null, 2));
  else print(rows);
}

main().catch((e) => { console.error('inventory failed:', e instanceof Error ? e.name : 'error'); process.exit(1); });
