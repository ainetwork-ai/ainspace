/**
 * 17.7 기존 자산 연결 도구 — 가짜 KV·마을 디렉터리·aindrive 로: 분명한 소유자만(나머지는 거절), dry-run 은 쓰지 않음,
 * --apply 는 소유자 드라이브로 복사 + 레코드 옆 fileKey(원래 URL 유지) + 자산별 롤백 항목, 재실행 안전, 덮어쓰기 없음,
 * 롤백은 링크를 되돌리고 복사본은 (요청 시) 바뀌지 않은 것만 지운다. 플래그 off 면 스크립트가 아무것도 하지 않는다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  applyAssetLinks, assetLinksKey, listRollbackEntries, planAssetLinks, rollbackAssetLinks, rollbackKey, targetPathOf,
  type AssetLink, type AssetLinkApplyDeps, type RollbackEntry, type SourceAsset,
} from './asset-linking';
import { classifyRedisKey } from './asset-inventory';
import { aindriveFileId } from './files';
import { findSecretKey, resetNativeSupport } from './http';
import { memoryKv } from './kv';
import { memoryVillageDirectory } from './village-membership';
import { AIN_CONTRACT_VERSION, fileKey, type FileRef } from './types';
import { fakeFetch, jsonResponse } from './__tests__/helpers';

beforeEach(() => resetNativeSupport());

const AINDRIVE = 'https://aindrive.example';
const TOKEN = 'aind_aat_secret_alice';
const DRIVE = 'drvA';
const GCS = 'https://storage.googleapis.com/space-bucket';
const MAP = new TextEncoder().encode('{"width":10,"height":10,"layers":[]}');
const TILESET = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const bucket = (path: string, size: number): SourceAsset => ({ store: 'bucket', path, url: `${GCS}/${path}`, size });
const ASSETS: SourceAsset[] = [
  bucket('villages/alpha/map.tmj', MAP.byteLength),
  bucket('villages/alpha/tilesets/ground.png', TILESET.byteLength),
  bucket('villages/beta/map.tmj', 10), // 소유자 기록 없음
  bucket('villages/gone/map.tmj', 10), // 마을 레코드 없음(삭제된 마을의 남은 객체)
  bucket('villages/gamma/map.tmj', 10), // 소유자 bob — 연결 없음
  bucket('villages/shared.png', 5), // 공용 타일셋
  bucket('production/sprites/agentsaGVsbG8-1.png', 7), // 스프라이트: creator 는 지갑 주소
  { store: 'blob', path: 'tiles/t1.png', url: 'https://blob.example/tiles/t1.png', size: 3 },
  { store: 'blob', path: 'chat/x.png', url: 'https://blob.example/chat/x.png', size: 3 },
];
const BYTES: Record<string, Uint8Array> = { 'villages/alpha/map.tmj': MAP, 'villages/alpha/tilesets/ground.png': TILESET };

function world() {
  const kv = memoryKv();
  const villages = memoryVillageDirectory({ villages: ['alpha', 'beta', 'gamma'] });
  villages.owners.set('alpha', 'user-alice');
  villages.owners.set('gamma', 'user-bob');
  // 원래 레코드: 링크 도구는 이것을 바꾸지 않는다.
  void kv.hSet('village:alpha', 'tmjUrl', `${GCS}/villages/alpha/map.tmj`);
  const connected = new Set(['user-alice']);
  return { kv, villages, connected, hasConnection: async (u: string) => connected.has(u) };
}

const owner = { kind: 'account' as const, issuer: 'https://sso.example', subject: 'acc_alice' };
const root = (driveId: string, name: string): FileRef => ({
  contract: AIN_CONTRACT_VERSION, issuer: AINDRIVE, driveId, fileId: aindriveFileId(driveId, '/'), revision: 'm0-s0', kind: 'folder',
  displayName: name, ownerRef: owner, availability: { state: 'online' }, sourceUrl: `${AINDRIVE}/d/${driveId}/`, legacy: { path: '/' },
});
const sse = (v: unknown) => new Response(`event: message\ndata: ${JSON.stringify(v)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });

/** 가짜 aindrive: alice 의 드라이브 drvA(+drvZ), fs/write 는 계정 토큰 401 → MCP write_file, stat·delete_path 지원. */
function drive(files: Record<string, { size: number; mtimeMs: number }> = {}, over: { statError?: string } = {}) {
  const writes: { path: string; content: string; encoding: string }[] = [];
  const deletes: string[] = [];
  const f = fakeFetch({
    '/api/oauth/shared': (url) => jsonResponse({ contract: '1.0', asOf: '2026-09-30T00:00:00Z', nextCursor: null,
      items: url.searchParams.get('scope') === 'mine' ? [{ ref: root('drvZ', 'zeta'), role: 'owner', shareOrigin: 'own' }, { ref: root(DRIVE, 'alpha-drive'), role: 'owner', shareOrigin: 'own' }] : [] }),
    [`/api/drives/${DRIVE}/fs/write`]: () => jsonResponse({ error: 'unauthorized' }, 401),
    [`/mcp/d/${DRIVE}`]: (_u, init) => {
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${TOKEN}`);
      const body = JSON.parse(String(init?.body));
      const { path } = body.params.arguments as { path: string };
      const err = (text: string) => sse({ jsonrpc: '2.0', id: body.id, result: { isError: true, content: [{ type: 'text', text }] } });
      if (body.params.name === 'stat') {
        if (over.statError) return err(over.statError);
        const e = files[path];
        return e ? sse({ jsonrpc: '2.0', id: body.id, result: { content: [], structuredContent: { name: path.split('/').pop(), path, isDir: false, ...e } } }) : err(`[not_found] no entry at ${path}`);
      }
      if (body.params.name === 'delete_path') { deletes.push(path); delete files[path]; return sse({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: `deleted ${path}` }], structuredContent: { ok: true } } }); }
      if (body.params.name === 'write_file') {
        const { content, encoding } = body.params.arguments;
        writes.push({ path, content, encoding });
        const size = Buffer.from(content, encoding === 'base64' ? 'base64' : 'utf8').byteLength;
        files[path] = { size, mtimeMs: 1790700000000 + writes.length };
        return sse({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'ok' }], structuredContent: { ok: true, ...files[path] } } });
      }
      return err('[invalid_params] unknown');
    },
  });
  return { f, writes, deletes, files };
}

const applyDeps = (w: ReturnType<typeof world>, d: ReturnType<typeof drive>, over: Partial<AssetLinkApplyDeps> = {}): AssetLinkApplyDeps & { logged: RollbackEntry[] } => {
  const logged: RollbackEntry[] = [];
  return {
    kv: w.kv, villages: w.villages, hasConnection: w.hasConnection, aindriveUrl: AINDRIVE, fetch: d.f, runId: 'run-1',
    now: () => new Date('2026-09-30T00:00:00Z'),
    getToken: async (u) => (u === 'user-alice' ? TOKEN : null),
    readSource: async (a) => { const b = BYTES[a.path]; if (!b) throw new Error('no bytes'); return b; },
    onRollbackEntry: (e) => { logged.push(e); },
    logged,
    ...over,
  };
};

const byId = <T extends { assetId: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.assetId, x]));
const noSecret = (v: unknown) => { const s = JSON.stringify(v); assert.ok(!s.includes(TOKEN), '토큰이 실리면 안 된다'); assert.equal(findSecretKey(v), null); };

// ------------------------------------------------------------------------------- plan

test('plan(dry-run): 분명한 소유자 + 연결 있음만 link, 소유자 불분명은 refuse, 연결 없음은 skip — 쓰지 않는다', async () => {
  const w = world();
  const before = JSON.stringify([...w.kv.hashes].map(([k, v]) => [k, [...v]]));
  const plan = byId(await planAssetLinks(ASSETS, w));
  assert.equal(plan['bucket:villages/alpha/map.tmj'].action, 'link');
  assert.equal(plan['bucket:villages/alpha/map.tmj'].ownerUserId, 'user-alice');
  assert.equal(plan['bucket:villages/alpha/map.tmj'].targetPath, '/Space assets/villages/alpha/map.tmj');
  assert.equal(plan['bucket:villages/alpha/map.tmj'].recordKey, 'village:alpha:ain_asset_links');
  assert.equal(plan['bucket:villages/alpha/tilesets/ground.png'].targetPath, '/Space assets/villages/alpha/tilesets/ground.png');
  assert.deepEqual([plan['bucket:villages/beta/map.tmj'].action, plan['bucket:villages/beta/map.tmj'].reason], ['refuse', 'no_owner']);
  assert.deepEqual([plan['bucket:villages/gone/map.tmj'].action, plan['bucket:villages/gone/map.tmj'].reason], ['refuse', 'no_record']);
  assert.deepEqual([plan['bucket:villages/gamma/map.tmj'].action, plan['bucket:villages/gamma/map.tmj'].reason], ['skip', 'owner_not_connected']);
  assert.equal(plan['bucket:villages/shared.png'].reason, 'no_owner');
  assert.equal(plan['bucket:production/sprites/agentsaGVsbG8-1.png'].reason, 'owner_not_account');
  assert.equal(plan['blob:tiles/t1.png'].reason, 'no_owner');
  assert.equal(plan['blob:chat/x.png'].reason, 'no_owner');
  for (const p of Object.values(plan)) if (p.action === 'refuse') assert.equal(p.ownerUserId, undefined, '거절 항목에 추측한 소유자가 없다');
  assert.equal(JSON.stringify([...w.kv.hashes].map(([k, v]) => [k, [...v]])), before, 'dry-run 은 KV 를 바꾸지 않는다');
});

test('plan: 크기 초과 거절, 필터(소유자·마을), 대상 경로 조각 정리', async () => {
  const w = world();
  const big = bucket('villages/alpha/tilesets/huge.png', 11 * 1024 * 1024);
  assert.equal((await planAssetLinks([big], w))[0].reason, 'too_large');
  const onlyAlice = await planAssetLinks(ASSETS, w, { ownerUserId: 'user-alice' });
  assert.deepEqual(onlyAlice.map((p) => p.assetId).sort(), ['bucket:villages/alpha/map.tmj', 'bucket:villages/alpha/tilesets/ground.png']);
  const onlyGamma = await planAssetLinks(ASSETS, w, { village: 'gamma' });
  assert.deepEqual(onlyGamma.map((p) => p.assetId), ['bucket:villages/gamma/map.tmj']);
  assert.equal(targetPathOf({ store: 'blob', path: 'a/../b\u0001c.png', url: 'x' }), '/Space assets/blob/a/b_c.png');
});

// ------------------------------------------------------------------------------- apply

test('apply: 소유자 드라이브로 base64 복사, 레코드 옆에 fileKey(원래 URL 유지), 자산별 롤백 항목 — 재실행은 건너뛴다', async () => {
  const w = world(); const d = drive();
  const deps = applyDeps(w, d);
  const plan = await planAssetLinks(ASSETS, w);
  const res = byId(await applyAssetLinks(plan, deps));
  assert.equal(res['bucket:villages/alpha/map.tmj'].outcome, 'linked');
  assert.equal(res['bucket:villages/alpha/tilesets/ground.png'].outcome, 'linked');
  assert.equal(res['bucket:villages/gamma/map.tmj'].outcome, 'skipped');
  assert.equal(res['blob:tiles/t1.png'].outcome, 'refused');
  assert.deepEqual(d.writes.map((x) => [x.path, x.encoding]), [['Space assets/villages/alpha/map.tmj', 'base64'], ['Space assets/villages/alpha/tilesets/ground.png', 'base64']]);
  assert.deepEqual(new Uint8Array(Buffer.from(d.writes[0].content, 'base64')), MAP);

  const links = await w.kv.hGetAll(assetLinksKey('alpha'));
  const link = JSON.parse(links['bucket:villages/alpha/map.tmj']) as AssetLink;
  assert.equal(link.originalUrl, `${GCS}/villages/alpha/map.tmj`);
  assert.equal(link.driveId, DRIVE, '이름순 첫 내 드라이브(alpha-drive < zeta)');
  assert.equal(link.fileKey, `${AINDRIVE}#${DRIVE}#${aindriveFileId(DRIVE, '/Space assets/villages/alpha/map.tmj')}`);
  assert.equal(link.fileKey, res['bucket:villages/alpha/map.tmj'].fileKey);
  assert.equal(link.sourceUrl, `${AINDRIVE}/d/${DRIVE}/Space%20assets/villages/alpha/map.tmj`);
  assert.equal(link.ownerUserId, 'user-alice');
  assert.deepEqual(await w.kv.hGetAll('village:alpha'), { tmjUrl: `${GCS}/villages/alpha/map.tmj` }, '원래 레코드는 그대로');
  assert.deepEqual(Object.keys(await w.kv.hGetAll(assetLinksKey('gamma'))), [], '연결 없는 소유자의 자산은 링크 없음');

  const entries = await listRollbackEntries(w.kv, 'run-1');
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => [e.assetId, e.createdCopy, e.previous]), [['bucket:villages/alpha/map.tmj', true, null], ['bucket:villages/alpha/tilesets/ground.png', true, null]]);
  assert.deepEqual(deps.logged.map((e) => e.assetId).sort(), entries.map((e) => e.assetId));
  noSecret({ res, links, entries, logged: deps.logged, kv: [...w.kv.hashes].map(([k, v]) => [k, [...v]]) });

  // 재실행: plan 이 already_linked 로 건너뛰고 두 번째 파일을 만들지 않는다.
  const again = await planAssetLinks(ASSETS, w);
  assert.equal(byId(again)['bucket:villages/alpha/map.tmj'].reason, 'already_linked');
  await applyAssetLinks(again, applyDeps(w, d, { runId: 'run-2' }));
  assert.equal(d.writes.length, 2);
  assert.deepEqual(await listRollbackEntries(w.kv, 'run-2'), []);
});

test('apply: 대상에 같은 크기 파일이 있으면 이어 쓰고(reused), 다르면 덮어쓰지 않는다(target_conflict)', async () => {
  const w = world();
  const d = drive({
    'Space assets/villages/alpha/map.tmj': { size: MAP.byteLength, mtimeMs: 5 },
    'Space assets/villages/alpha/tilesets/ground.png': { size: 999, mtimeMs: 6 },
  });
  const plan = (await planAssetLinks(ASSETS, w)).filter((p) => p.action === 'link');
  const res = byId(await applyAssetLinks(plan, applyDeps(w, d)));
  assert.equal(res['bucket:villages/alpha/map.tmj'].outcome, 'reused');
  assert.deepEqual([res['bucket:villages/alpha/tilesets/ground.png'].outcome, res['bucket:villages/alpha/tilesets/ground.png'].reason], ['refused', 'target_conflict']);
  assert.equal(d.writes.length, 0, '아무것도 쓰지 않는다');
  const links = await w.kv.hGetAll(assetLinksKey('alpha'));
  assert.deepEqual(Object.keys(links), ['bucket:villages/alpha/map.tmj']);
  assert.equal((await listRollbackEntries(w.kv, 'run-1'))[0].createdCopy, false);
});

test('apply: 연결이 사라진 소유자는 skip, 대상 확인 실패는 failed(링크·롤백 없음), 한 자산 실패가 다른 자산을 막지 않는다', async () => {
  const w = world();
  const plan = (await planAssetLinks(ASSETS, w)).filter((p) => p.action === 'link');
  // 계획 뒤에 연결 해제
  const gone = await applyAssetLinks(plan, applyDeps(w, drive(), { getToken: async () => null }));
  assert.ok(gone.every((r) => r.outcome === 'skipped' && r.reason === 'owner_not_connected'));

  const bad = drive({}, { statError: '[internal] agent exploded' });
  const failed = await applyAssetLinks(plan, applyDeps(w, bad));
  assert.ok(failed.every((r) => r.outcome === 'failed'));
  assert.equal(bad.writes.length, 0);
  assert.deepEqual(await w.kv.hGetAll(assetLinksKey('alpha')), {});
  assert.deepEqual(await listRollbackEntries(w.kv, 'run-1'), []);

  const d = drive();
  const partial = byId(await applyAssetLinks(plan, applyDeps(w, d, { readSource: async (a) => { if (a.path.endsWith('.png')) throw new Error('gone'); return MAP; } })));
  assert.equal(partial['bucket:villages/alpha/tilesets/ground.png'].outcome, 'failed');
  assert.equal(partial['bucket:villages/alpha/map.tmj'].outcome, 'linked');
  noSecret(partial);
});

// ------------------------------------------------------------------------------- rollback

test('rollback: 링크를 지우고 복사본은 기본으로 남긴다; deleteCopies 는 바뀌지 않은 새 복사본만 지운다', async () => {
  const w = world(); const d = drive();
  await applyAssetLinks(await planAssetLinks(ASSETS, w), applyDeps(w, d));
  // 소유자가 타일셋 복사본을 고쳤다
  d.files['Space assets/villages/alpha/tilesets/ground.png'] = { size: 42, mtimeMs: 9 };

  const rb = byId(await rollbackAssetLinks('run-1', { kv: w.kv, aindriveUrl: AINDRIVE, fetch: d.f, getToken: async () => TOKEN, deleteCopies: true }));
  assert.deepEqual([rb['bucket:villages/alpha/map.tmj'].link, rb['bucket:villages/alpha/map.tmj'].copy], ['removed', 'deleted']);
  assert.deepEqual([rb['bucket:villages/alpha/tilesets/ground.png'].link, rb['bucket:villages/alpha/tilesets/ground.png'].copy], ['removed', 'kept_modified']);
  assert.deepEqual(d.deletes, ['Space assets/villages/alpha/map.tmj']);
  assert.deepEqual(await w.kv.hGetAll(assetLinksKey('alpha')), {});
  assert.deepEqual(await w.kv.hGetAll(rollbackKey('run-1')), {}, '처리한 롤백 항목은 지운다');
  assert.deepEqual(await w.kv.hGetAll('village:alpha'), { tmjUrl: `${GCS}/villages/alpha/map.tmj` });
});

test('rollback: 기본은 복사본을 남긴다, 이전 링크는 복원, 이후에 바뀐 링크는 건드리지 않는다', async () => {
  const w = world(); const d = drive();
  const prevLink = JSON.stringify({ assetId: 'bucket:villages/alpha/map.tmj', fileKey: 'old#key#1' });
  // 이전 링크가 있던 자산을 새로 연결하는 경우를 흉내: 롤백 항목을 직접 둔다
  const entry = (assetId: string, previous: string | null, fk: string): RollbackEntry => ({
    runId: 'run-9', assetId, recordKey: assetLinksKey('alpha'), previous, fileKey: fk, ownerUserId: 'user-alice', driveId: DRIVE,
    path: `/Space assets/${assetId.slice(7)}`, createdCopy: true, size: 1, mtimeMs: 1, at: '2026-09-30T00:00:00Z',
  });
  await w.kv.hSet(rollbackKey('run-9'), 'bucket:villages/alpha/map.tmj', JSON.stringify(entry('bucket:villages/alpha/map.tmj', prevLink, 'new#key#1')));
  await w.kv.hSet(assetLinksKey('alpha'), 'bucket:villages/alpha/map.tmj', JSON.stringify({ fileKey: 'new#key#1' }));
  await w.kv.hSet(rollbackKey('run-9'), 'bucket:villages/alpha/tilesets/ground.png', JSON.stringify(entry('bucket:villages/alpha/tilesets/ground.png', null, 'new#key#2')));
  await w.kv.hSet(assetLinksKey('alpha'), 'bucket:villages/alpha/tilesets/ground.png', JSON.stringify({ fileKey: 'later#run#3' }));

  const rb = byId(await rollbackAssetLinks('run-9', { kv: w.kv, aindriveUrl: AINDRIVE, fetch: d.f, getToken: async () => TOKEN }));
  assert.deepEqual([rb['bucket:villages/alpha/map.tmj'].link, rb['bucket:villages/alpha/map.tmj'].copy], ['restored', 'kept']);
  assert.equal(rb['bucket:villages/alpha/tilesets/ground.png'].link, 'changed_since');
  const links = await w.kv.hGetAll(assetLinksKey('alpha'));
  assert.equal(links['bucket:villages/alpha/map.tmj'], prevLink);
  assert.equal(JSON.parse(links['bucket:villages/alpha/tilesets/ground.png']).fileKey, 'later#run#3');
  assert.equal(d.deletes.length, 0);
});

// ------------------------------------------------------------------------------- inventory · flag

test('인벤토리: 링크 hash 는 reference, 롤백 항목은 stays 로 분류된다', () => {
  assert.deepEqual([classifyRedisKey('village:alpha:ain_asset_links').kind, classifyRedisKey('village:alpha:ain_asset_links').disposition], ['village-asset-links', 'reference']);
  assert.equal(classifyRedisKey('ain:asset_link_rollback:run-1').kind, 'asset-link-rollback');
  assert.equal(fileKey(root(DRIVE, 'x')).startsWith(AINDRIVE), true);
});

test('스크립트: AIN_INTEGRATION_ENABLED 가 꺼져 있으면 아무것도 하지 않고 종료 코드 2', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ain-asset-link-')); // .env 가 없는 곳
  const repo = resolve(__dirname, '../../..');
  const env = { ...process.env, AIN_INTEGRATION_ENABLED: '', NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: '', AINSPACE_STORAGE_REDIS_URL: 'redis://127.0.0.1:1', TSX_TSCONFIG_PATH: join(repo, 'tsconfig.json') };
  const loader = pathToFileURL(join(repo, 'node_modules/tsx/dist/loader.mjs')).href;
  const r = spawnSync(process.execPath, ['--import', loader, join(repo, 'scripts/ain-asset-link.ts'), '--apply'], { cwd, env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /AIN_INTEGRATION_ENABLED/);
});
