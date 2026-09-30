/**
 * 17.5 마을 자료 구분 — 방문자는 public 만, 멤버는 public+members, 에이전트 호출에는 public·agent 만 file-refs 로.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import taskRef from '@/lib/ain-integration/__fixtures__/task-ref.json';
import { invokeDeps, villageDeps, villageMaterialsDeps as deps } from '@/lib/ain-integration/deps';
import { memoryVillageDirectory } from '@/lib/ain-integration/village-membership';
import { findSecretKey } from '@/lib/ain-integration/http';
import { memoryKv } from '@/lib/ain-integration/kv';
import { AIN_CONTRACT_VERSION, AinContractError, fileKey, type FileRef, type TaskRef } from '@/lib/ain-integration/types';
import { agentMaterialKeys, materialsKey, putVillageMaterial, visibleMaterials, type VillageMaterial, type VillageMaterialsStore } from '@/lib/ain-integration/village-materials';
import { SESSION_ENV, signedJwt, withEnv } from '@/lib/ain-integration/__tests__/helpers';
import { DELETE, GET, PUT } from './route';
import { POST as INVOKE } from '../../../invoke/route';

const ON = { ...SESSION_ENV, AIN_INTEGRATION_ENABLED: 'true', NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined, AINDRIVE_URL: 'https://aindrive.example' };
const ref = (id: string): FileRef => ({
  contract: AIN_CONTRACT_VERSION, issuer: 'https://aindrive.example', driveId: 'drv_1', fileId: `p1:${id.padEnd(32, '0')}`, revision: 'm1-s1', kind: 'file',
  displayName: `${id}.pdf`, ownerRef: { kind: 'principal', issuer: 'https://aindrive.example', subject: 'me' }, availability: { state: 'online' }, sourceUrl: `https://aindrive.example/d/drv_1/${id}.pdf`,
});
const PUB = ref('pub'); const MEM = ref('mem'); const AGT = ref('agt');

function setup() {
  const kv = memoryKv();
  const members = new Set(['member-1']);
  const store: VillageMaterialsStore = { kv, isMember: async (slug, userId) => slug === 'alpha' && members.has(userId) };
  const prev = { ...deps };
  deps.store = store;
  return { kv, store, restore: () => Object.assign(deps, prev) };
}
async function seed(store: VillageMaterialsStore) {
  const at = '2026-09-30T00:00:0';
  await putVillageMaterial('alpha', { ref: PUB, audience: 'public', addedBy: 'member-1', addedAt: `${at}1Z` }, store);
  await putVillageMaterial('alpha', { ref: MEM, audience: 'members', addedBy: 'member-1', addedAt: `${at}2Z` }, store);
  await putVillageMaterial('alpha', { ref: AGT, audience: 'agent', addedBy: 'member-1', addedAt: `${at}3Z` }, store);
}
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const req = (method: string, path: string, user?: string, body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method, headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${signedJwt(user)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
});
const names = (b: { items: { ref: FileRef }[] }) => b.items.map((i) => i.ref.displayName);

test('순수 규칙: 방문자 public, 멤버 public+members, 에이전트 public+agent (members 는 에이전트에 없음)', () => {
  const all: VillageMaterial[] = [
    { ref: PUB, audience: 'public', addedBy: 'm', addedAt: '1' }, { ref: MEM, audience: 'members', addedBy: 'm', addedAt: '2' }, { ref: AGT, audience: 'agent', addedBy: 'm', addedAt: '3' },
  ];
  assert.deepEqual(visibleMaterials(all, 'visitor').map((m) => m.audience), ['public']);
  assert.deepEqual(visibleMaterials(all, 'member').map((m) => m.audience), ['public', 'members']);
  assert.deepEqual(agentMaterialKeys(all), [fileKey(PUB), fileKey(AGT)]);
});

test('17.5 GET: 방문자·멤버가 보는 자료가 다르고, 저장은 참조 하나당 Redis 필드 하나(audience 포함)', withEnv(ON, async () => {
  const s = setup();
  try {
    await seed(s.store);
    const fields = s.kv.hashes.get(materialsKey('alpha'))!;
    assert.equal(fields.size, 3);
    assert.equal(JSON.parse(fields.get(fileKey(MEM))!).audience, 'members');

    const visitor = await (await GET(req('GET', '/api/ain/villages/alpha/materials', 'visitor-9'), ctx('alpha'))).json();
    assert.equal(visitor.viewer, 'visitor');
    assert.deepEqual(names(visitor), ['pub.pdf']);
    const member = await (await GET(req('GET', '/api/ain/villages/alpha/materials', 'member-1'), ctx('alpha'))).json();
    assert.equal(member.viewer, 'member');
    assert.deepEqual(names(member), ['pub.pdf', 'mem.pdf']);
    // 관리 보기는 멤버만: 방문자가 view=manage 를 붙여도 public 만
    const manage = await (await GET(req('GET', '/api/ain/villages/alpha/materials?view=manage', 'member-1'), ctx('alpha'))).json();
    assert.deepEqual(names(manage), ['pub.pdf', 'mem.pdf', 'agt.pdf']);
    const sneaky = await (await GET(req('GET', '/api/ain/villages/alpha/materials?view=manage', 'visitor-9'), ctx('alpha'))).json();
    assert.deepEqual(names(sneaky), ['pub.pdf']);
    assert.equal(findSecretKey(manage), null);
    // 세션 없음·잘못된 slug
    assert.equal((await GET(req('GET', '/api/ain/villages/alpha/materials'), ctx('alpha'))).status, 401);
    assert.equal((await GET(req('GET', '/api/ain/villages/Bad%20Slug/materials', 'member-1'), ctx('Bad Slug'))).status, 400);
  } finally { s.restore(); }
}));

test('17.5 PUT/DELETE: 멤버만, 파일은 그 멤버의 aindrive 에서 해석된 것만 붙는다', withEnv(ON, async () => {
  const s = setup();
  try {
    const seen: { token: string | null; keys: string[] }[] = [];
    deps.getAindriveAccountToken = async (u) => (u === 'member-1' ? 'aind_aat_member' : null);
    deps.resolveFiles = async (o, keys) => {
      seen.push({ token: o.token, keys });
      if (keys[0] !== fileKey(MEM)) throw new AinContractError('forbidden', '볼 수 없는 파일');
      return [MEM];
    };
    const denied = await PUT(req('PUT', '/api/ain/villages/alpha/materials', 'visitor-9', { fileKey: fileKey(MEM), audience: 'members' }), ctx('alpha'));
    assert.equal(denied.status, 403);
    assert.equal(seen.length, 0);
    assert.equal((await PUT(req('PUT', '/api/ain/villages/alpha/materials', 'member-1', { fileKey: fileKey(MEM), audience: 'everyone' }), ctx('alpha'))).status, 400);
    const ok = await PUT(req('PUT', '/api/ain/villages/alpha/materials', 'member-1', { fileKey: fileKey(MEM), audience: 'members' }), ctx('alpha'));
    assert.equal(ok.status, 200);
    assert.ok(!JSON.stringify(await ok.json()).includes('aind_aat_'));
    assert.deepEqual(seen[0], { token: 'aind_aat_member', keys: [fileKey(MEM)] });
    const cannotSee = await PUT(req('PUT', '/api/ain/villages/alpha/materials', 'member-1', { fileKey: fileKey(AGT), audience: 'agent' }), ctx('alpha'));
    assert.equal(cannotSee.status, 403);
    assert.equal(s.kv.hashes.get(materialsKey('alpha'))!.size, 1);
    // audience 변경 = 같은 필드 갱신
    deps.resolveFiles = async () => [MEM];
    await PUT(req('PUT', '/api/ain/villages/alpha/materials', 'member-1', { fileKey: fileKey(MEM), audience: 'public' }), ctx('alpha'));
    assert.equal(s.kv.hashes.get(materialsKey('alpha'))!.size, 1);
    assert.equal(JSON.parse(s.kv.hashes.get(materialsKey('alpha'))!.get(fileKey(MEM))!).audience, 'public');
    assert.equal((await DELETE(req('DELETE', `/api/ain/villages/alpha/materials?fileKey=${encodeURIComponent(fileKey(MEM))}`, 'visitor-9'), ctx('alpha'))).status, 403);
    assert.equal((await DELETE(req('DELETE', `/api/ain/villages/alpha/materials?fileKey=${encodeURIComponent(fileKey(MEM))}`, 'member-1'), ctx('alpha'))).status, 200);
    assert.equal(s.kv.hashes.get(materialsKey('alpha'))!.size, 0);
  } finally { s.restore(); }
}));

test('17.5 invoke: villageMaterials=true 면 public·agent 자료만 file-refs 로, members 자료는 넘기지 않는다', withEnv(ON, async () => {
  const s = setup();
  const prev = { ...invokeDeps };
  const prevVillage = { ...villageDeps };
  try {
    await seed(s.store);
    // 에이전트는 alpha 에 배치되어 있고, visitor-9 는 검증된 체류 중
    const dir = memoryVillageDirectory({ villages: ['alpha'], agents: [{ commonAgentId: 'https://ainize.example#guide', isPlaced: true, state: { x: 1, y: 1, behavior: 'idle', color: '#000', mapName: 'alpha' } }] });
    await dir.markPresent('alpha', 'visitor-9', Date.now());
    villageDeps.directory = dir;
    let passed = null as string[] | null;
    invokeDeps.getAindriveAccountToken = async () => null;
    invokeDeps.saveTaskRef = async () => {};
    invokeDeps.invokeSharedAgent = async (_o, r) => { passed = r.fileKeys; return { task: taskRef as TaskRef, text: '' }; };
    const base = { agentKey: 'https://ainize.example#guide', text: '안내해 줘', conversation: 'thr_1', room: 'alpha' };
    const mine = 'https://aindrive.example#drv_2#p1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const res = await INVOKE(req('POST', '/api/ain/invoke', 'visitor-9', { ...base, fileKeys: [mine], villageMaterials: true }));
    assert.equal(res.status, 200);
    assert.deepEqual(passed, [mine, fileKey(PUB), fileKey(AGT)]);
    assert.ok(!passed!.includes(fileKey(MEM)));
    // 끄면 마을 자료를 붙이지 않는다; room 없이 켜면 400
    await INVOKE(req('POST', '/api/ain/invoke', 'visitor-9', { ...base, fileKeys: [] }));
    assert.deepEqual(passed, []);
    const { room: _room, ...noRoom } = base; void _room;
    assert.equal((await INVOKE(req('POST', '/api/ain/invoke', 'visitor-9', { ...noRoom, villageMaterials: true }))).status, 400);
  } finally { Object.assign(invokeDeps, prev); Object.assign(villageDeps, prevVillage); s.restore(); }
}));
