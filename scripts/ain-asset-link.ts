/**
 * 17.7 기존 자산 → 소유자 Aindrive 연결 도구(배포 운영자가 돌린다). **기본은 dry-run** — 아무것도 쓰지 않는다.
 *
 *   npx tsx scripts/ain-asset-link.ts [--blob] [--bucket] [--owner <userId>] [--village <slug>] [--json] [--max N]
 *   npx tsx scripts/ain-asset-link.ts --apply [--run-id <id>] [--rollback-file <path>] [...위 필터]
 *   npx tsx scripts/ain-asset-link.ts --rollback <runId> [--apply] [--delete-copies]
 *
 * - AIN_INTEGRATION_ENABLED(또는 NEXT_PUBLIC_…)가 켜져 있어야 돈다.
 * - dry-run: Blob·버킷 객체를 나열하고(이름·크기만), 분명한 소유자(마을 맵·타일셋 = `village:<slug>:owner`)가 있고
 *   그 소유자의 aindrive 연결이 있는 자산만 `link` 로, 대상 경로 `/Space assets/<객체 경로>` 를 보여준다.
 *   소유자가 없거나 불분명한 자산(타일 업로드·공용 타일셋·스프라이트·채팅 첨부)은 `refuse`.
 * - --apply: 소유자의 연결로 소유자의 첫 드라이브에 복사하고, `village:<slug>:ain_asset_links` 에 fileKey 를 적는다.
 *   원래 URL·객체·레코드는 그대로다. 자산마다 롤백 항목을 Redis(`ain:asset_link_rollback:<runId>`)와 로컬 JSONL 에 남긴다.
 * - --rollback <runId>: 롤백 항목을 보여준다. --apply 를 함께 주면 링크를 되돌린다. 복사본은 남긴다 —
 *   --delete-copies 면 이 실행이 새로 만든, 그 뒤로 바뀌지 않은 복사본만 지운다.
 *
 * 비밀: 토큰·봉인 값·env 의 URL/키는 출력하지 않는다(토큰은 aindrive 호출 헤더로만 간다). 오류는 코드·이름만 찍는다.
 */
import { config } from 'dotenv';
import { appendFileSync } from 'fs';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined; };
const pick = ['--blob', '--bucket'].filter(has);
const want = (f: string) => pick.length === 0 || pick.includes(f);
const MAX = Number(val('--max')) || 100_000;
const APPLY = has('--apply');
const JSON_OUT = has('--json');

type Asset = import('../src/lib/ain-integration/asset-linking').SourceAsset;
const status: Record<string, string> = {};
const readers = new Map<string, (a: Asset) => Promise<Uint8Array>>();

async function blobAssets(): Promise<Asset[]> {
  const token = process.env.AINSPACE_BLOB_READ_WRITE_TOKEN;
  if (!token) { status.blob = 'skipped (AINSPACE_BLOB_READ_WRITE_TOKEN not set)'; return []; }
  const { list } = await import('@vercel/blob');
  const out: Asset[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ token, cursor, limit: 1000 });
    for (const b of page.blobs) out.push({ store: 'blob', path: b.pathname, url: b.url, size: b.size });
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && out.length < MAX);
  readers.set('blob', async (a) => {
    const res = await fetch(a.url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`blob_read_${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  });
  status.blob = `ok (${out.length} blobs)`;
  return out;
}

async function bucketAssets(): Promise<Asset[]> {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY || !process.env.FIREBASE_STORAGE_BUCKET) { status.bucket = 'skipped (FIREBASE_* not set)'; return []; }
  const { getFirebaseStorage } = await import('../src/lib/firebase');
  const bucket = getFirebaseStorage().bucket();
  const [files] = await bucket.getFiles({ maxResults: MAX, autoPaginate: true });
  const out: Asset[] = files.map((f) => ({ store: 'bucket', path: f.name, url: `https://storage.googleapis.com/${bucket.name}/${f.name}`, size: Number(f.metadata?.size ?? 0) || 0 }));
  readers.set('bucket', async (a) => { const [buf] = await bucket.file(a.path).download(); return new Uint8Array(buf); });
  status.bucket = `ok (${out.length} objects)`;
  return out;
}

async function main(): Promise<number> {
  const { isAinIntegrationEnabled, getAindriveUrl, getAindriveOAuthClientId } = await import('../src/lib/ain-integration/config');
  if (!isAinIntegrationEnabled()) { console.error('AIN_INTEGRATION_ENABLED 가 꺼져 있습니다 — 아무것도 하지 않습니다.'); return 2; }

  const linking = await import('../src/lib/ain-integration/asset-linking');
  const { readConnection, getAindriveAccountTokenFrom } = await import('../src/lib/ain-integration/aindrive-token');
  const { ownerKey } = await import('../src/lib/ain-integration/village-membership');
  type KvStore = import('../src/lib/ain-integration/kv').KvStore;

  // 앱의 Redis 클라이언트(lib/redis.ts)는 끊기면 계속 다시 붙는다 — 도구는 자기 클라이언트를 쓰고, 한 번 실패하면 멈춘다.
  // 연결은 처음 쓸 때 연다(플래그 off·자산 없음이면 Redis 를 건드리지 않는다). 오류 문장에 URL 이 실릴 수 있어 찍지 않는다.
  const { createClient } = await import('redis');
  const client = createClient({ url: process.env.AINSPACE_STORAGE_REDIS_URL || 'redis://localhost:6379', socket: { connectTimeout: 5000, reconnectStrategy: false } });
  client.on('error', () => { /* 위와 같은 이유로 찍지 않는다 */ });
  let opening: Promise<unknown> | null = null;
  const r = async () => { if (!client.isOpen) { opening ??= client.connect(); await opening; } return client; };
  const redisKv: KvStore = {
    async get(k) { return (await r()).get(k); },
    async set(k, v, o) { if (o?.ttlSec) await (await r()).set(k, v, { EX: o.ttlSec }); else await (await r()).set(k, v); },
    async del(k) { await (await r()).del(k); },
    async getDel(k) { return (await r()).getDel(k); },
    async hGetAll(k) { return (await r()).hGetAll(k) as Promise<Record<string, string>>; },
    async hSet(k, f, v) { await (await r()).hSet(k, f, v); },
    async hDel(k, f) { await (await r()).hDel(k, f); },
  };
  const redisVillageDirectory = {
    async villageExists(slug: string) { const c = await r(); return Boolean(await c.sIsMember('villages:all', slug)) || (await c.exists(`village:${slug}`)) > 0; },
    async getOwner(slug: string) { return (await r()).get(ownerKey(slug)); },
  };

  const aindriveUrl = getAindriveUrl();
  const hasConnection = async (userId: string) => (await readConnection(userId, { kv: redisKv })) !== null;
  // 연결 레코드가 있을 때만 토큰을 구한다 — 개발용 배포 공용 토큰으로 물러서지 않게.
  const getToken = async (userId: string) => ((await hasConnection(userId))
    ? getAindriveAccountTokenFrom(userId, { kv: redisKv, aindriveUrl, clientId: getAindriveOAuthClientId() })
    : null);

  try {
    const rollbackRun = val('--rollback');
    if (has('--rollback')) {
      if (!rollbackRun) { console.error('--rollback <runId> 가 필요합니다.'); return 2; }
      const entries = await linking.listRollbackEntries(redisKv, rollbackRun);
      if (!APPLY) {
        const view = entries.map((e) => ({ assetId: e.assetId, recordKey: e.recordKey, fileKey: e.fileKey, path: e.path, createdCopy: e.createdCopy, hadPrevious: e.previous !== null, at: e.at }));
        if (JSON_OUT) console.log(JSON.stringify({ runId: rollbackRun, dryRun: true, entries: view }, null, 2));
        else {
          console.log(`rollback ${rollbackRun}: ${entries.length} entries (dry-run — --apply 로 실행)`);
          for (const v of view) console.log(`  ${v.assetId}  ${v.path}  copy=${v.createdCopy ? 'created' : 'existing'}${v.hadPrevious ? ' (previous link restored)' : ''}`);
        }
        return 0;
      }
      const results = await linking.rollbackAssetLinks(rollbackRun, { kv: redisKv, aindriveUrl, getToken, deleteCopies: has('--delete-copies') });
      if (JSON_OUT) console.log(JSON.stringify({ runId: rollbackRun, results }, null, 2));
      else for (const r of results) console.log(`  ${r.assetId}  link=${r.link}  copy=${r.copy}`);
      return results.some((r) => r.copy === 'kept_error') ? 1 : 0;
    }

    const assets: Asset[] = [];
    for (const [flag, fn] of [['--blob', blobAssets], ['--bucket', bucketAssets]] as const) {
      if (!want(flag)) continue;
      try { assets.push(...(await fn())); } catch (e) { status[flag.slice(2)] = `failed (${e instanceof Error ? e.name : 'error'})`; }
    }
    const plan = await linking.planAssetLinks(assets, { kv: redisKv, villages: redisVillageDirectory, hasConnection }, { ownerUserId: val('--owner'), village: val('--village') });

    if (!APPLY) {
      const count = (a: string, r?: string) => plan.filter((p) => p.action === a && (!r || p.reason === r)).length;
      if (JSON_OUT) { console.log(JSON.stringify({ dryRun: true, sources: status, plan: plan.map(({ asset, ...p }) => ({ ...p, url: asset.url, size: asset.size ?? null })) }, null, 2)); return 0; }
      console.log('DRY-RUN — 아무것도 쓰지 않았습니다. --apply 로 실행합니다.\n');
      for (const p of plan.filter((x) => x.action === 'link')) console.log(`link    ${p.assetId}\n        owner=${p.ownerUserId}  → ${p.targetPath}  (record ${p.recordKey})`);
      for (const p of plan.filter((x) => x.action === 'skip')) console.log(`skip    ${p.assetId}  (${p.reason}, owner=${p.ownerUserId})`);
      const refused = new Map<string, string[]>();
      for (const p of plan.filter((x) => x.action === 'refuse')) {
        const k = `${p.reason} / ${p.kind}`; if (!refused.has(k)) refused.set(k, []); refused.get(k)!.push(p.assetId);
      }
      for (const [k, ids] of refused) console.log(`refuse  ${k}: ${ids.length}${ids.length ? `  e.g. ${ids.slice(0, 3).join(', ')}` : ''}`);
      console.log(`\nlink ${count('link')} · skip ${count('skip')} · refuse ${count('refuse')}`);
      console.log('sources:', status);
      return 0;
    }

    const runId = val('--run-id') ?? `link-${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}`;
    const logPath = resolve(process.cwd(), val('--rollback-file') ?? `ain-asset-link-rollback-${runId}.jsonl`);
    const results = await linking.applyAssetLinks(plan, {
      kv: redisKv, villages: redisVillageDirectory, hasConnection, getToken, aindriveUrl, runId,
      readSource: (a) => { const r = readers.get(a.store); if (!r) throw new Error('no_reader'); return r(a); },
      onRollbackEntry: (e) => appendFileSync(logPath, JSON.stringify(e) + '\n', { mode: 0o600 }),
    });
    const tally: Record<string, number> = {};
    for (const r of results) tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
    if (JSON_OUT) console.log(JSON.stringify({ runId, rollbackFile: logPath, tally, results, sources: status }, null, 2));
    else {
      for (const r of results.filter((x) => x.outcome !== 'refused')) console.log(`${r.outcome.padEnd(8)}${r.assetId}${r.reason ? `  (${r.reason})` : ''}${r.targetPath && r.fileKey ? `  → ${r.targetPath}` : ''}`);
      console.log(`\nrun ${runId}:`, tally);
      console.log(`rollback: npx tsx scripts/ain-asset-link.ts --rollback ${runId} [--apply] [--delete-copies]   (local log ${logPath})`);
    }
    return results.some((r) => r.outcome === 'failed') ? 1 : 0;
  } finally {
    if (client.isOpen) await client.quit().catch(() => undefined);
  }
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('asset link failed:', e instanceof Error ? e.name : 'error', e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '');
  process.exit(1);
});
