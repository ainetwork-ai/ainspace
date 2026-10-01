import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fileListFixture from './__fixtures__/file-list-response.json';
import { aindriveFileId, aindriveNormalizePath, driveToFolderItem, listFolderEntries, listFolderItems, listSharedFiles } from './files';
import { findSecretKey, resetNativeSupport } from './http';
import { AinContractError, isFileListResponse } from './types';
import { fakeFetch, jsonResponse } from './__tests__/helpers';

const ISSUER = 'https://aindrive.example';
const opts = (fetch: ReturnType<typeof fakeFetch>, token: string | null = 'aind_aat_secret') =>
  ({ aindriveUrl: ISSUER, token, connectUrl: `${ISSUER}/oauth/authorize`, fetch, now: () => new Date('2026-09-29T06:00:00Z') });

beforeEach(() => resetNativeSupport());

test('fixture: 계약 file-list-response 를 파싱해 그대로 전달한다', async () => {
  assert.ok(isFileListResponse(fileListFixture));
  const f = fakeFetch({ '/api/oauth/shared': () => jsonResponse(fileListFixture) });
  const res = await listSharedFiles(opts(f), { scope: 'shared_with_me', limit: 50 });
  assert.deepEqual(res, fileListFixture);
  assert.equal(f.calls.length, 1);
  assert.equal(new URL(f.calls[0].url).searchParams.get('scope'), 'shared_with_me');
  // 토큰은 Authorization 헤더로만 나간다 — URL 에는 없다.
  assert.ok(!f.calls[0].url.includes('aind_aat_'));
  assert.equal((f.calls[0].init?.headers as Record<string, string>).authorization, 'Bearer aind_aat_secret');
  assert.equal(findSecretKey(res), null);
});

test('fallback: /api/oauth/shared 404 → /api/oauth/drives 를 드라이브 루트 폴더 ref 로 변환한다', async () => {
  const f = fakeFetch({
    '/api/oauth/drives': () => jsonResponse({ drives: [
      { id: 'drv_mine', name: 'My Drive', online: true, role: 'owner' },
      { id: 'drv_shared', name: 'Team Drive', online: false, role: 'viewer' },
    ] }),
  });
  const res = await listSharedFiles(opts(f), { scope: 'shared_with_me', limit: 50 });
  assert.ok(isFileListResponse(res));
  assert.equal(res.items.length, 1);
  const item = res.items[0];
  assert.equal(item.ref.driveId, 'drv_shared');
  assert.equal(item.ref.fileId, aindriveFileId('drv_shared', '/'));
  assert.match(item.ref.fileId, /^p1:[0-9a-f]{32}$/);
  assert.equal(item.ref.revision, 'm0-s0');
  assert.equal(item.ref.kind, 'folder');
  assert.equal(item.ref.availability.state, 'offline');
  assert.deepEqual(item.ref.legacy, { path: '/' });
  assert.equal(item.role, 'viewer');
  assert.equal(item.shareOrigin, 'direct');
  assert.equal(item.ref.issuer, ISSUER);
  assert.equal(res.asOf, '2026-09-29T06:00:00.000Z');

  const mine = await listSharedFiles(opts(f), { scope: 'mine', limit: 50 });
  assert.equal(mine.items.length, 1);
  assert.equal(mine.items[0].shareOrigin, 'own');
  assert.equal(mine.items[0].ref.availability.state, 'online');
  // 네이티브 없음이 기억되어 두 번째 호출은 /api/oauth/shared 를 다시 두드리지 않는다.
  assert.equal(f.calls.filter((c) => c.url.includes('/api/oauth/shared')).length, 1);
});

test('fallback: fileId 는 driveId + 정규화 경로의 sha256 앞 32자', () => {
  assert.equal(aindriveNormalizePath('a\\b/./c/'), '/a/b/c');
  assert.equal(aindriveFileId('d1', '/'), aindriveFileId('d1', '//'));
  assert.notEqual(aindriveFileId('d1', '/'), aindriveFileId('d2', '/'));
  const item = driveToFolderItem(ISSUER, { id: 'd1', name: 'D', online: true, role: 'editor' });
  assert.equal(item.role, 'editor');
  assert.equal(item.ref.sourceUrl, `${ISSUER}/d/d1/`);
});

test('fallback: q 필터와 offset 커서로 페이지를 나눈다', async () => {
  const f = fakeFetch({
    '/api/oauth/drives': () => jsonResponse({ drives: [
      { id: 'a', name: 'Alpha', online: true, role: 'viewer' },
      { id: 'b', name: 'Beta', online: true, role: 'viewer' },
      { id: 'c', name: 'Gamma', online: true, role: 'viewer' },
    ] }),
  });
  const p1 = await listSharedFiles(opts(f), { scope: 'shared_with_me', limit: 2 });
  assert.equal(p1.items.length, 2);
  assert.ok(p1.nextCursor);
  const p2 = await listSharedFiles(opts(f), { scope: 'shared_with_me', limit: 2, cursor: p1.nextCursor! });
  assert.equal(p2.items.length, 1);
  assert.equal(p2.nextCursor, null);
  const q = await listSharedFiles(opts(f), { scope: 'shared_with_me', limit: 50, q: 'ALPHA' });
  assert.deepEqual(q.items.map((i) => i.ref.displayName), ['Alpha']);
  const org = await listSharedFiles(opts(f), { scope: 'shared_with_org', limit: 50 });
  assert.deepEqual(org.items, []);
});

test('토큰이 없으면 auth_required + 연결 안내(actionUrl)', async () => {
  const f = fakeFetch({});
  await assert.rejects(
    () => listSharedFiles(opts(f, null), { scope: 'shared_with_me', limit: 50 }),
    (e: unknown) => e instanceof AinContractError && e.code === 'auth_required' && e.actionUrl === `${ISSUER}/oauth/authorize`,
  );
  assert.equal(f.calls.length, 0);
});

test('원본의 계약 오류 바디는 같은 code 로 전달된다', async () => {
  const f = fakeFetch({ '/api/oauth/shared': () => jsonResponse({ error: { code: 'forbidden', message: 'no', retryable: false } }, 403) });
  await assert.rejects(() => listSharedFiles(opts(f), { scope: 'mine', limit: 50 }), (e: unknown) => e instanceof AinContractError && e.code === 'forbidden');
});

test('네이티브 응답의 sourceUrl 에 자격증명이 실려 있으면 그 URL 만 뗀다', async () => {
  const leaky = JSON.parse(JSON.stringify(fileListFixture));
  leaky.items[0].ref.sourceUrl = 'https://aindrive.ainetwork.ai/d/x?token=abc';
  const f = fakeFetch({ '/api/oauth/shared': () => jsonResponse(leaky) });
  const res = await listSharedFiles(opts(f), { scope: 'shared_with_me', limit: 50 });
  assert.equal(res.items[0].ref.sourceUrl, undefined);
  assert.equal(res.items[0].ref.fileId, fileListFixture.items[0].ref.fileId);
});

test('폴더 탐색(MCP) 오류: 원본의 error.message 는 응답 바디(detail)에 싣지 않는다 — 계정 토큰이 섞여 와도', async () => {
  const f = fakeFetch({ '/mcp/d/drv_1': () => jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'bad token aind_aat_secret rejected' } }) });
  await assert.rejects(() => listFolderEntries(opts(f), 'drv_1', '/'), (e: AinContractError) => {
    const body = JSON.stringify(e.toBody());
    return e.code === 'temporary_failure' && e.detail === 'aindrive_mcp_error' && !body.includes('aind_aat_secret') && !body.includes('rejected');
  });
});

test('listFolderItems: 공유 뿌리(드라이브 루트) 아래 하위 폴더의 직계 항목을 뿌리의 역할로 (19.5 선택기 폴더 열기)', async () => {
  const root = { contract: '1.0', issuer: ISSUER, driveId: 'drv_g', fileId: aindriveFileId('drv_g', '/'), revision: 'm0-s0', kind: 'folder', displayName: 'rehearsal-gallery', ownerRef: { kind: 'principal', issuer: ISSUER, subject: 'me' }, availability: { state: 'online' }, sourceUrl: `${ISSUER}/d/drv_g/`, legacy: { path: '/' } };
  const f = fakeFetch({
    '/api/oauth/shared': (u) => jsonResponse({ contract: '1.0', asOf: 'x', nextCursor: null, items: u.searchParams.get('scope') === 'mine' ? [{ ref: root, role: 'owner', shareOrigin: 'own' }] : [] }),
    '/mcp/d/drv_g': () => jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { entries: [{ name: '전시 일정.md', path: '전시 일정/전시 일정.md', isDir: false, size: 500, mtimeMs: 1 }, { name: '.aindrive', path: '전시 일정/.aindrive', isDir: true }] } } }),
  });
  const key = `${ISSUER}#drv_g#${aindriveFileId('drv_g', '/전시 일정')}`;
  const out = await listFolderItems(opts(f), key, '/전시 일정');
  assert.equal(out.folder.legacy?.path, '/전시 일정');
  assert.deepEqual(out.items.map((i) => [i.ref.displayName, i.ref.legacy?.path, i.role, i.shareOrigin]), [['전시 일정.md', '/전시 일정/전시 일정.md', 'owner', 'own']]);
  assert.equal(out.items[0].ref.fileId, aindriveFileId('drv_g', '/전시 일정/전시 일정.md'));
  const mcp = f.calls.find((c) => c.url.includes('/mcp/d/drv_g'))!;
  assert.equal(JSON.parse(String(mcp.init?.body)).params.arguments.path, '전시 일정');
  assert.equal(findSecretKey(out), null);
});

test('listFolderItems: 경로-키 불일치 → unsupported_input, 공유 뿌리 밖 → forbidden (폴더 목록은 부르지 않는다)', async () => {
  const shared = { contract: '1.0', issuer: ISSUER, driveId: 'drv_g', fileId: aindriveFileId('drv_g', '/작품 설명'), revision: 'm0-s0', kind: 'folder', displayName: '작품 설명', ownerRef: { kind: 'principal', issuer: ISSUER, subject: 'o' }, availability: { state: 'online' }, sourceUrl: `${ISSUER}/d/drv_g/`, legacy: { path: '/작품 설명' } };
  const f = fakeFetch({ '/api/oauth/shared': () => jsonResponse({ contract: '1.0', asOf: 'x', nextCursor: null, items: [{ ref: shared, role: 'editor', shareOrigin: 'direct' }] }) });
  const key = `${ISSUER}#drv_g#${aindriveFileId('drv_g', '/전시 일정')}`;
  await assert.rejects(listFolderItems(opts(f), key, '/다른 곳'), (e: unknown) => e instanceof AinContractError && e.code === 'unsupported_input');
  await assert.rejects(listFolderItems(opts(f), key, '/전시 일정'), (e: unknown) => e instanceof AinContractError && e.code === 'forbidden');
  await assert.rejects(listFolderItems(opts(f), `https://other.example#drv_g#${aindriveFileId('drv_g', '/전시 일정')}`, '/전시 일정'), (e: unknown) => e instanceof AinContractError && e.code === 'unsupported_input');
  assert.equal(f.calls.some((c) => c.url.includes('/mcp/')), false);
});
