import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PICKER_SCOPES, back, canOpen, currentFolder, initialNav, openFolder, pickerListUrl, trailLabel, withScope } from './picker-nav';
import type { FileListItem, FileRef } from './types';

const ref = (over: Partial<FileRef>): FileRef => ({
  contract: '1.0', issuer: 'https://aindrive.example', driveId: 'drv_g', fileId: 'p1:root', revision: 'm0-s0', kind: 'folder', displayName: 'rehearsal-gallery',
  ownerRef: { kind: 'principal', issuer: 'https://aindrive.example', subject: 'me' }, availability: { state: 'online' }, sourceUrl: 'https://aindrive.example/d/drv_g/', legacy: { path: '/' }, ...over,
} as FileRef);
const ROOT = ref({});
const SUB = ref({ fileId: 'p1:sub', displayName: '전시 일정', legacy: { path: '/전시 일정' } });
const FILE = ref({ fileId: 'p1:f', kind: 'file', displayName: '전시 일정.md', legacy: { path: '/전시 일정/전시 일정.md' } });
const item = (r: FileRef, over: Partial<FileListItem> = {}): FileListItem => ({ ref: r, role: 'owner', shareOrigin: 'own', ...over });

test('범위 탭: 나에게 공유됨 · 내 파일 (19.5 — 마을 소유자가 자기 드라이브 자료를 고를 수 있어야 한다)', () => {
  assert.deepEqual(PICKER_SCOPES.map((s) => s.scope), ['shared_with_me', 'mine']);
});

test('처음 목록 → 폴더 열기 → 하위 폴더 열기 → 뒤로: 목록 주소와 빵부스러기', () => {
  let nav = withScope(initialNav(), 'mine');
  assert.equal(pickerListUrl(nav), '/api/ain/shared-files?scope=mine');
  assert.equal(trailLabel(nav), null);
  nav = openFolder(nav, ROOT);
  let u = new URL(pickerListUrl(nav), 'http://x');
  assert.equal(u.pathname, '/api/ain/shared-files/folder');
  assert.equal(u.searchParams.get('folder'), 'https://aindrive.example#drv_g#p1:root');
  assert.equal(u.searchParams.get('path'), '/');
  assert.equal(trailLabel(nav), 'rehearsal-gallery');
  nav = openFolder(nav, SUB);
  u = new URL(pickerListUrl(nav), 'http://x');
  assert.equal(u.searchParams.get('path'), '/전시 일정');
  assert.equal(trailLabel(nav), '/전시 일정');
  assert.equal(openFolder(nav, FILE), nav, '파일은 열지 않는다');
  nav = back(nav);
  assert.equal(currentFolder(nav), ROOT);
  assert.deepEqual(withScope(nav, 'shared_with_me'), { scope: 'shared_with_me', trail: [] }, '범위를 바꾸면 처음 목록');
});

test('열 수 있는 행: 온라인 폴더만(파일·오프라인·구매 전 유료는 아니다)', () => {
  assert.equal(canOpen(item(ROOT)), true);
  assert.equal(canOpen(item(FILE)), false);
  assert.equal(canOpen(item(ref({ availability: { state: 'offline' } }))), false);
  assert.equal(canOpen(item(ROOT, { paid: { entitled: false } })), false);
});
