/**
 * 17.4 작품·전시 자료: 마을 소유자가 Aindrive 공유 파일을 전시 자료로 붙이고(materials `exhibition: true`), 마을 화면은
 * `GET /api/ain/villages/:slug/exhibition` 으로 **보는 사람의** aindrive 계정 기준 가용성과 함께 본다.
 * 라우트 → 실제 checkExhibits → 가짜 aindrive(사용자별 공유 목록).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { villageDeps, villageMaterialsDeps } from '@/lib/ain-integration/deps';
import { checkExhibits } from '@/lib/ain-integration/exhibition';
import { findSecretKey, resetNativeSupport } from '@/lib/ain-integration/http';
import { memoryKv } from '@/lib/ain-integration/kv';
import { AIN_CONTRACT_VERSION, fileKey, type FileRef } from '@/lib/ain-integration/types';
import { memoryVillageDirectory } from '@/lib/ain-integration/village-membership';
import { SESSION_ENV, fakeFetch, jsonResponse, signedJwt, withEnv } from '@/lib/ain-integration/__tests__/helpers';
import { DELETE as MATERIALS_DELETE, GET as MATERIALS_GET, PUT as MATERIALS_PUT } from './[slug]/materials/route';
import { GET as EXHIBITION_GET } from './[slug]/exhibition/route';

const AINDRIVE = 'https://aindrive.example';
const ENV = { ...SESSION_ENV, AIN_INTEGRATION_ENABLED: 'true', NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined, AINDRIVE_URL: AINDRIVE, AINDRIVE_CONNECT_URL: undefined, NEXT_PUBLIC_URL: undefined };

const ref = (id: string, state: FileRef['availability']['state'] = 'online'): FileRef => ({
  contract: AIN_CONTRACT_VERSION, issuer: AINDRIVE, driveId: 'drv_1', fileId: `p1:${id.padEnd(32, '0')}`, revision: 'm1-s1', kind: 'file',
  displayName: `${id}.png`, ownerRef: { kind: 'principal', issuer: AINDRIVE, subject: 'artist' }, availability: { state }, sourceUrl: `${AINDRIVE}/d/drv_1/${id}.png`,
});
const ART = ref('art'); const GONE = ref('gone'); const REVOKED = ref('revoked'); const OFF = ref('off'); const MEMBERS_ONLY = ref('members'); const NOTE = ref('note');

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const req = (method: string, path: string, user: string | null, body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${signedJwt(user)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
});

type ExhibitionBody = { viewer: string; isOwner: boolean; actionUrl?: string; items: { ref: FileRef; audience: string; availability: string }[] };

function wire() {
  const kv = memoryKv();
  const dir = memoryVillageDirectory({ villages: ['alpha'] });
  // 보는 사람마다 aindrive 공유 목록이 다르다. 소유자(붙이는 사람)는 모두 온라인으로 본다.
  const lists: Record<string, FileRef[]> = {
    'aind_aat_owner-1': [ART, GONE, REVOKED, OFF, MEMBERS_ONLY, NOTE],
    'aind_aat_visitor-9': [ART, ref('gone', 'deleted'), ref('off', 'offline')],
  };
  const f = fakeFetch({
    '/api/oauth/shared': (url, init) => {
      const token = /^Bearer (.+)$/.exec(new Headers(init?.headers).get('authorization') ?? '')?.[1] ?? '';
      const items = url.searchParams.get('scope') === 'shared_with_me' ? (lists[token] ?? []) : [];
      return jsonResponse({ contract: '1.0', asOf: '2026-09-30T00:00:00Z', nextCursor: null, items: items.map((r) => ({ ref: r, role: 'viewer', shareOrigin: 'direct' })) });
    },
  });
  const prev = { mat: { ...villageMaterialsDeps }, vil: { ...villageDeps } };
  villageDeps.directory = dir;
  villageMaterialsDeps.store = { kv, isMember: (s, u) => dir.isMember(s, u) };
  villageMaterialsDeps.getAindriveAccountToken = async (u) => (u === 'no-aindrive' ? null : `aind_aat_${u}`);
  villageMaterialsDeps.resolveFiles = async (_o, keys) => keys.map((k) => [ART, GONE, REVOKED, OFF, MEMBERS_ONLY, NOTE].find((r) => fileKey(r) === k)!);
  villageMaterialsDeps.checkExhibits = (o, items) => checkExhibits({ ...o, fetch: f }, items);
  resetNativeSupport();
  return { dir, f, restore: () => { Object.assign(villageMaterialsDeps, prev.mat); Object.assign(villageDeps, prev.vil); resetNativeSupport(); } };
}

const put = (user: string, body: Record<string, unknown>) => MATERIALS_PUT(req('PUT', '/api/ain/villages/alpha/materials', user, body), ctx('alpha'));
const exhibition = async (user: string) => {
  const res = await EXHIBITION_GET(req('GET', '/api/ain/villages/alpha/exhibition', user), ctx('alpha'));
  assert.equal(res.status, 200);
  return res.json() as Promise<ExhibitionBody>;
};

test('17.4 소유자만 전시 자료를 붙이고 뗀다; 전시 audience 는 public·members; 멤버는 일반 자료만', withEnv(ENV, async () => {
  const w = wire();
  try {
    await w.dir.setOwner('alpha', 'owner-1');
    await w.dir.addMember('alpha', 'member-2');
    assert.equal((await put('owner-1', { fileKey: fileKey(ART), audience: 'public', exhibition: true })).status, 200);
    assert.equal((await put('owner-1', { fileKey: fileKey(ART), audience: 'agent', exhibition: true })).status, 400, 'agent audience 는 전시 불가');
    assert.equal((await put('owner-1', { fileKey: fileKey(ART), audience: 'public', exhibition: 'yes' })).status, 400);
    // 멤버: 전시 자료를 붙이거나, 기존 전시 자료를 일반 PUT 으로 덮어쓰거나, 떼지 못한다
    assert.equal((await put('member-2', { fileKey: fileKey(NOTE), audience: 'public', exhibition: true })).status, 403);
    assert.equal((await put('member-2', { fileKey: fileKey(ART), audience: 'members' })).status, 403);
    assert.equal((await MATERIALS_DELETE(req('DELETE', `/api/ain/villages/alpha/materials?fileKey=${encodeURIComponent(fileKey(ART))}`, 'member-2'), ctx('alpha'))).status, 403);
    // 멤버의 일반 자료는 그대로 되고, 전시 목록에는 나오지 않는다
    assert.equal((await put('member-2', { fileKey: fileKey(NOTE), audience: 'public' })).status, 200);
    const e = await exhibition('owner-1');
    assert.equal(e.isOwner, true);
    assert.deepEqual(e.items.map((i) => i.ref.displayName), ['art.png']);
    const manage = await (await MATERIALS_GET(req('GET', '/api/ain/villages/alpha/materials?view=manage', 'owner-1'), ctx('alpha'))).json() as { items: { ref: FileRef; exhibition?: boolean }[] };
    assert.deepEqual(manage.items.map((i) => [i.ref.displayName, i.exhibition ?? false]), [['art.png', true], ['note.png', false]]);
    // 소유자는 뗄 수 있다
    assert.equal((await MATERIALS_DELETE(req('DELETE', `/api/ain/villages/alpha/materials?fileKey=${encodeURIComponent(fileKey(ART))}`, 'owner-1'), ctx('alpha'))).status, 200);
    assert.deepEqual((await exhibition('owner-1')).items, []);
    // 플래그 off → 404
    await withEnv({ AIN_INTEGRATION_ENABLED: undefined }, async () => {
      assert.equal((await EXHIBITION_GET(req('GET', '/api/ain/villages/alpha/exhibition', 'owner-1'), ctx('alpha'))).status, 404);
    })();
    assert.equal((await EXHIBITION_GET(req('GET', '/api/ain/villages/alpha/exhibition', null), ctx('alpha'))).status, 401);
  } finally { w.restore(); }
}));

test('17.4 마을 화면: 보는 사람의 aindrive 기준 가용성 — available·deleted·forbidden(여는 위치 없음)·offline, members 전시는 방문자에게 안 보임, 미연결은 unknown + actionUrl', withEnv(ENV, async () => {
  const w = wire();
  try {
    await w.dir.setOwner('alpha', 'owner-1');
    for (const [r, audience] of [[ART, 'public'], [GONE, 'public'], [REVOKED, 'public'], [OFF, 'public'], [MEMBERS_ONLY, 'members']] as const) {
      assert.equal((await put('owner-1', { fileKey: fileKey(r), audience, exhibition: true })).status, 200);
    }
    const v = await exhibition('visitor-9');
    assert.equal(v.viewer, 'visitor');
    assert.equal(v.isOwner, false);
    assert.equal(findSecretKey(v), null);
    const byName = Object.fromEntries(v.items.map((i) => [i.ref.displayName, i]));
    assert.deepEqual(Object.keys(byName).sort(), ['art.png', 'gone.png', 'off.png', 'revoked.png']);
    assert.equal(byName['art.png'].availability, 'available');
    assert.ok(byName['art.png'].ref.sourceUrl);
    assert.equal(byName['gone.png'].availability, 'deleted');
    assert.equal(byName['revoked.png'].availability, 'forbidden');
    assert.equal(byName['revoked.png'].ref.sourceUrl, undefined, '볼 수 없는 파일의 여는 위치는 내려보내지 않는다');
    assert.equal(byName['off.png'].availability, 'offline');

    // 소유자(멤버): members 전시까지, 모두 available
    const o = await exhibition('owner-1');
    assert.deepEqual(o.items.map((i) => i.ref.displayName).sort(), ['art.png', 'gone.png', 'members.png', 'off.png', 'revoked.png']);
    assert.ok(o.items.every((i) => i.availability === 'available'));

    // aindrive 미연결 방문자: 모두 unknown + 연결 안내
    const n = await exhibition('no-aindrive');
    assert.ok(n.items.every((i) => i.availability === 'unknown'));
    assert.equal(n.actionUrl, 'http://localhost/api/ain/aindrive/connect');
  } finally { w.restore(); }
}));
