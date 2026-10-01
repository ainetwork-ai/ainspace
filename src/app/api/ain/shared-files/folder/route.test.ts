import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSecretKey } from '@/lib/ain-integration/http';
import { SESSION_ENV, makeRequest, signedJwt, withEnv } from '@/lib/ain-integration/__tests__/helpers';
import { sharedFilesDeps as deps } from '@/lib/ain-integration/deps';
import { GET } from './route';

const ON = { ...SESSION_ENV, AIN_INTEGRATION_ENABLED: 'true', NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined, AINDRIVE_URL: 'https://aindrive.example' };
const KEY = 'https://aindrive.example#drv_g#p1:x';

test('플래그 off → 404', withEnv({ AIN_INTEGRATION_ENABLED: undefined, NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined }, async () => {
  assert.equal((await GET(makeRequest(`/api/ain/shared-files/folder?folder=${encodeURIComponent(KEY)}`, signedJwt('u1')))).status, 404);
}));

test('세션 없음 → 401, folder 없음 → unsupported_input', withEnv(ON, async () => {
  let called = false; const orig = deps.listFolderItems;
  deps.listFolderItems = async () => { called = true; throw new Error('no'); };
  try {
    assert.equal((await GET(makeRequest(`/api/ain/shared-files/folder?folder=${encodeURIComponent(KEY)}`))).status, 401);
    const r = await GET(makeRequest('/api/ain/shared-files/folder', signedJwt('u1')));
    assert.equal((await r.json()).error.code, 'unsupported_input');
    assert.equal(called, false);
  } finally { deps.listFolderItems = orig; }
}));

test('폴더 항목을 계약 목록 모양(+folder)으로, 토큰 없이', withEnv(ON, async () => {
  const origList = deps.listFolderItems; const origTok = deps.getAindriveAccountToken;
  let got: unknown[] = [];
  deps.getAindriveAccountToken = async () => 'aind_aat_secret';
  deps.listFolderItems = async (o, folder, path) => { got = [o.token, folder, path]; return { folder: { displayName: '전시 일정' } as never, items: [{ ref: { displayName: '전시 일정.md' } as never, role: 'owner', shareOrigin: 'own' }] }; };
  try {
    const res = await GET(makeRequest(`/api/ain/shared-files/folder?folder=${encodeURIComponent(KEY)}&path=${encodeURIComponent('/전시 일정')}`, signedJwt('u1')));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(got, ['aind_aat_secret', KEY, '/전시 일정']);
    assert.equal(body.contract, '1.0');
    assert.equal(body.items[0].ref.displayName, '전시 일정.md');
    assert.equal(findSecretKey(body), null);
    assert.ok(!JSON.stringify(body).includes('aind_aat_secret'));
  } finally { deps.listFolderItems = origList; deps.getAindriveAccountToken = origTok; }
}));
