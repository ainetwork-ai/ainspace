import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkExhibits } from './exhibition';
import { resetNativeSupport } from './http';
import { AIN_CONTRACT_VERSION, type FileRef } from './types';
import type { VillageMaterial } from './village-materials';
import { fakeFetch, jsonResponse } from './__tests__/helpers';

const AINDRIVE = 'https://aindrive.example';
const file = (driveId: string, id: string): FileRef => ({
  contract: AIN_CONTRACT_VERSION, issuer: AINDRIVE, driveId, fileId: `p1:${id.padEnd(32, '0')}`, revision: 'r', kind: 'file', displayName: `${id}.png`,
  ownerRef: { kind: 'principal', issuer: AINDRIVE, subject: 'a' }, availability: { state: 'online' }, sourceUrl: `${AINDRIVE}/d/${driveId}/${id}.png`,
});
const root = (driveId: string, state: 'online' | 'offline'): FileRef => ({ ...file(driveId, 'root'), kind: 'folder', displayName: driveId, availability: { state }, legacy: { path: '/' } });
const mat = (ref: FileRef): VillageMaterial => ({ ref, audience: 'public', addedBy: 'o', addedAt: '2026-09-30T00:00:00Z', exhibition: true });

test('17.4 checkExhibits: 목록에 없으면 공유 뿌리 탐색 — 드라이브 사라짐(404) → deleted, 뿌리 기기 꺼짐 → offline, 탐색해도 없음 → forbidden', async () => {
  resetNativeSupport();
  const f = fakeFetch({
    '/api/oauth/shared': (url) => jsonResponse({ contract: '1.0', asOf: 'x', nextCursor: null,
      items: url.searchParams.get('scope') === 'shared_with_me' ? [root('drv_gone', 'online'), root('drv_off', 'offline'), root('drv_ok', 'online')].map((r) => ({ ref: r, role: 'viewer', shareOrigin: 'direct' })) : [] }),
    '/mcp/d/drv_gone': () => jsonResponse({}, 404),
    '/mcp/d/drv_ok': () => jsonResponse({ jsonrpc: '2.0', id: 1, result: { structuredContent: { entries: [{ name: 'other.png', path: 'other.png', isDir: false }] } } }),
  });
  const r = await checkExhibits({ aindriveUrl: AINDRIVE, token: 'aind_aat_x', fetch: f }, [mat(file('drv_gone', 'a')), mat(file('drv_off', 'b')), mat(file('drv_ok', 'c')), mat(file('drv_none', 'd'))]);
  assert.deepEqual(r.items.map((i) => i.availability), ['deleted', 'offline', 'forbidden', 'forbidden']);
  assert.equal(r.items[0].ref.sourceUrl, undefined);
  assert.ok(r.items[1].ref.sourceUrl, 'offline 은 여는 위치를 유지한다(기기가 켜지면 열린다)');
  assert.ok(!f.calls.some((c) => c.url.includes('/mcp/d/drv_off')), '꺼진 기기의 뿌리는 탐색하지 않는다');
});

test('17.4 checkExhibits: 토큰 없음 → unknown + authRequired, 원본 장애 → unknown(오류로 끝내지 않는다), 빈 목록은 원본을 부르지 않는다', async () => {
  resetNativeSupport();
  const none = await checkExhibits({ aindriveUrl: AINDRIVE, token: null, connectUrl: 'https://space.example/api/ain/aindrive/connect' }, [mat(file('d', 'a'))]);
  assert.deepEqual(none.items.map((i) => i.availability), ['unknown']);
  assert.equal(none.authRequired?.actionUrl, 'https://space.example/api/ain/aindrive/connect');
  const down = fakeFetch({ '/api/oauth/shared': () => jsonResponse({}, 502) });
  const r = await checkExhibits({ aindriveUrl: AINDRIVE, token: 't', fetch: down }, [mat(file('d', 'a'))]);
  assert.deepEqual(r.items.map((i) => i.availability), ['unknown']);
  const empty = fakeFetch({});
  assert.deepEqual((await checkExhibits({ aindriveUrl: AINDRIVE, token: 't', fetch: empty }, [])).items, []);
  assert.equal(empty.calls.length, 0);
});
