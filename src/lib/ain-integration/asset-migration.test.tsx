/**
 * 17.7 — 자산 인벤토리 분류(값을 읽지 않고, 비밀 종류는 이름도 가린다)와 채팅 첨부 이관(새 첨부 → aindrive, saveTo 경로,
 * base64 쓰기, rename 충돌, 옛 첨부 URL 은 그대로).
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { classifyBlobPath, classifyBucketPath, classifyRedisKey, summarize, EXTERNAL_ASSETS } from './asset-inventory';
import { attachmentName, saveChatAttachment, MAX_ATTACHMENT_BYTES } from './chat-attachments';
import { attachmentsDeps } from './deps';
import { aindriveFileId } from './files';
import { findSecretKey, resetNativeSupport } from './http';
import { AIN_CONTRACT_VERSION, AinContractError, fileKey, type FileRef } from './types';
import { SESSION_ENV, fakeFetch, jsonResponse, signedJwt, withEnv } from './__tests__/helpers';
import { chatFileSrc } from '@/lib/backend/chat-files';
import ChatAttachmentUpload, { uploadChatAttachment } from '@/components/chat/ChatAttachmentUpload';
import { POST } from '@/app/api/ain/attachments/route';

beforeEach(() => resetNativeSupport());

// ------------------------------------------------------------------------------- inventory

test('인벤토리: Redis 키·Blob·버킷 이름을 종류와 이관 계획으로 나눈다', () => {
  const cases: [string, string, string][] = [
    ['ain:aindrive_account:user-42', 'ain-aindrive-connection', 'secret'],
    ['ain:aindrive_oauth_state:abc', 'ain-oauth-state', 'ephemeral'],
    ['ain:aindrive_token:user-1', 'legacy-aindrive-token', 'delete-legacy'],
    ['village:alpha', 'village-metadata', 'stays'],
    ['village:alpha:ain_materials', 'village-materials', 'reference'],
    ['village:alpha:players', 'village-presence', 'ephemeral'],
    ['village:grid:1,2', 'village-grid', 'stays'],
    ['user:u1:threads', 'chat-threads', 'stays'],
    ['user:u1:ain_tasks', 'ain-task-refs', 'reference'],
    ['user:0xabc', 'user-permissions', 'stays'],
    ['global-tiles', 'global-tiles', 'stays'],
    ['something-else', 'unknown', 'unknown'],
  ];
  for (const [key, kind, disp] of cases) {
    const k = classifyRedisKey(key);
    assert.equal(k.kind, kind, key);
    assert.equal(k.disposition, disp, key);
  }
  assert.equal(classifyBlobPath('tiles/t1.png').disposition, 'stays');
  assert.equal(classifyBlobPath('chat/x.png').disposition, 'moves');
  assert.equal(classifyBucketPath('villages/alpha/map.tmj').kind, 'village-map');
  assert.equal(classifyBucketPath('villages/alpha/tilesets/a.png').kind, 'village-tileset');
  assert.equal(classifyBucketPath('prod/sprites/abc-1.png').kind, 'agent-sprite');
  assert.equal(classifyBucketPath('villages/shared.png').kind, 'shared-tileset');
  assert.ok(EXTERNAL_ASSETS.some((e) => e.kind === 'chat-attachment-backend' && e.disposition === 'moves'));
});

test('인벤토리 요약: 개수·크기, 비밀 종류의 샘플은 사용자 id 까지 가린다', () => {
  const names = ['ain:aindrive_account:user-42', 'ain:aindrive_account:user-7', 'village:alpha', 'village:beta'];
  const rows = summarize([
    ...names.map((name) => ({ name, kind: classifyRedisKey(name) })),
    { name: 'tiles/a.png', size: 100, kind: classifyBlobPath('tiles/a.png') },
    { name: 'tiles/b.png', size: 50, kind: classifyBlobPath('tiles/b.png') },
  ]);
  const secret = rows.find((r) => r.kind === 'ain-aindrive-connection')!;
  assert.equal(secret.count, 2);
  assert.deepEqual(secret.samples, ['ain:aindrive_account:…']);
  assert.ok(!JSON.stringify(rows).includes('user-42'));
  assert.equal(rows.find((r) => r.kind === 'village-metadata')!.count, 2);
  const tiles = rows.find((r) => r.kind === 'tile-upload')!;
  assert.equal(tiles.bytes, 150);
  assert.equal(secret.bytes, null);
});

// ------------------------------------------------------------------------------- chat attachments

const AINDRIVE = 'https://aindrive.example';
const TOKEN = 'aind_aat_secret_bob';
const DRIVE = 'drvB';
const owner = { kind: 'account' as const, issuer: 'https://sso.example', subject: 'acc_bob' };
const root = (driveId: string, name: string): FileRef => ({
  contract: AIN_CONTRACT_VERSION, issuer: AINDRIVE, driveId, fileId: aindriveFileId(driveId, '/'), revision: 'm0-s0', kind: 'folder',
  displayName: name, ownerRef: owner, availability: { state: 'online' }, sourceUrl: `${AINDRIVE}/d/${driveId}/`, legacy: { path: '/' },
});
const sse = (v: unknown) => new Response(`event: message\ndata: ${JSON.stringify(v)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });

/** 가짜 aindrive: mine = drive-B(+drive-Z), fs/write 는 계정 토큰을 401 로 거절(실제와 같이) → MCP write_file(base64). */
function drive(existing: { name: string; size: number }[] = []) {
  const writes: { path: string; content: string; encoding: string }[] = [];
  const entries = existing.map((e) => ({ name: e.name, path: e.name, isDir: false, size: e.size, mtimeMs: 1 }));
  const f = fakeFetch({
    '/api/oauth/shared': (url) => jsonResponse({ contract: '1.0', asOf: '2026-09-30T00:00:00Z', nextCursor: null,
      items: url.searchParams.get('scope') === 'mine' ? [{ ref: root('drvZ', 'zeta'), role: 'owner', shareOrigin: 'own' }, { ref: root(DRIVE, 'beta'), role: 'owner', shareOrigin: 'own' }] : [] }),
    [`/api/drives/${DRIVE}/fs/write`]: () => jsonResponse({ error: 'unauthorized' }, 401),
    [`/mcp/d/${DRIVE}`]: (_u, init) => {
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${TOKEN}`);
      const body = JSON.parse(String(init?.body));
      if (body.params.name === 'list_files') return sse({ jsonrpc: '2.0', id: body.id, result: { content: [], structuredContent: { entries } } });
      const { path, content, encoding } = body.params.arguments;
      writes.push({ path, content, encoding });
      const size = Buffer.from(content, encoding === 'base64' ? 'base64' : 'utf8').byteLength;
      entries.push({ name: path, path, isDir: false, size, mtimeMs: 2 });
      return sse({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'ok' }], structuredContent: { ok: true, size, mtimeMs: 1790700000000 } } });
    },
  });
  return { f, writes };
}
const opts = (f: ReturnType<typeof fakeFetch>, token: string | null = TOKEN) => ({ aindriveUrl: AINDRIVE, token, connectUrl: 'http://localhost/api/ain/aindrive/connect', fetch: f, now: () => new Date('2026-09-30T00:00:00Z') });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);

test('채팅 첨부: 내 첫 드라이브 루트(이름순)에 base64 로 쓰고 링크 파트를 돌려준다', async () => {
  const d = drive();
  const r = await saveChatAttachment(opts(d.f), { name: '사진 (1).png', bytes: PNG, mimeType: 'image/png' });
  assert.equal(d.writes.length, 1);
  assert.equal(d.writes[0].encoding, 'base64');
  assert.deepEqual(new Uint8Array(Buffer.from(d.writes[0].content, 'base64')), PNG);
  assert.equal(d.writes[0].path, '사진 (1).png');
  assert.equal(r.file.driveId, DRIVE, '이름순 첫 드라이브(beta < zeta)');
  assert.equal(r.file.mimeType, 'image/png');
  assert.equal(r.file.size, PNG.byteLength);
  assert.equal(r.markdown, `[사진 (1).png](${AINDRIVE}/d/${DRIVE}/%EC%82%AC%EC%A7%84%20%281%29.png)`);
  assert.equal(findSecretKey(r), null);
  assert.ok(!JSON.stringify(r).includes(TOKEN));
});

test('채팅 첨부: 같은 이름이 있으면 rename, 폴더를 주면 내 폴더인지 확인; 토큰 없음·크기 초과·빈 파일은 거절', async () => {
  const d = drive([{ name: 'a.png', size: 3 }]);
  const r = await saveChatAttachment(opts(d.f), { folderKey: fileKey(root(DRIVE, 'beta')), name: 'a.png', bytes: PNG });
  assert.match(d.writes[0].path, /^a-[0-9a-z]{1,6}\.png$/);
  assert.notEqual(r.file.displayName, 'a.png');
  await assert.rejects(() => saveChatAttachment(opts(d.f), { folderKey: `${AINDRIVE}#other#p1:${'0'.repeat(32)}`, name: 'x', bytes: PNG }), (e: AinContractError) => e.code === 'forbidden');
  await assert.rejects(() => saveChatAttachment(opts(d.f, null), { name: 'x', bytes: PNG }), (e: AinContractError) => e.code === 'auth_required' && e.actionUrl === 'http://localhost/api/ain/aindrive/connect');
  await assert.rejects(() => saveChatAttachment(opts(d.f), { name: 'x', bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1) }), (e: AinContractError) => e.code === 'unsupported_input');
  await assert.rejects(() => saveChatAttachment(opts(d.f), { name: 'x', bytes: new Uint8Array(0) }), (e: AinContractError) => e.code === 'unsupported_input');
  assert.equal(attachmentName('../../etc/passwd'), '_.._etc_passwd');
  assert.equal(attachmentName('  '), 'attachment');
  assert.equal(attachmentName('..'), 'attachment');
});

const ON = { ...SESSION_ENV, AIN_INTEGRATION_ENABLED: 'true', NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined, AINDRIVE_URL: AINDRIVE, AINDRIVE_CONNECT_URL: undefined, NEXT_PUBLIC_URL: undefined };
const upload = (user: string | null, file?: File, folderKey?: string) => {
  const form = new FormData();
  if (file) form.set('file', file);
  if (folderKey) form.set('folderKey', folderKey);
  return POST(new NextRequest('http://localhost/api/ain/attachments', { method: 'POST', headers: user ? { authorization: `Bearer ${signedJwt(user)}` } : {}, body: form }));
};

test('채팅 첨부 라우트: 세션·플래그 가드, aindrive 연결 없음 → 401 + 연결 시작, 성공 → FileRef + markdown(토큰 없음)', async () => {
  const d = drive();
  const prev = { ...attachmentsDeps };
  try {
    attachmentsDeps.saveChatAttachment = (o, i) => saveChatAttachment({ ...o, fetch: d.f }, i);
    await withEnv({ ...ON, AIN_INTEGRATION_ENABLED: undefined }, async () => {
      assert.equal((await upload('u1', new File([PNG], 'a.png'))).status, 404);
    })();
    await withEnv(ON, async () => {
      assert.equal((await upload(null, new File([PNG], 'a.png'))).status, 401);
      assert.equal((await upload('u1')).status, 400);
      assert.equal((await upload('u1', new File([PNG], 'a.png'), 'bad-key')).status, 400);
      attachmentsDeps.getAindriveAccountToken = async () => null;
      const noConn = await upload('u1', new File([PNG], 'a.png'));
      assert.equal(noConn.status, 401);
      assert.equal((await noConn.json()).error.actionUrl, 'http://localhost/api/ain/aindrive/connect');
      assert.equal(d.writes.length, 0);
      attachmentsDeps.getAindriveAccountToken = async (u) => (u === 'u1' ? TOKEN : null);
      const ok = await upload('u1', new File([PNG], 'a.png', { type: 'image/png' }));
      assert.equal(ok.status, 200);
      const body = await ok.json();
      assert.equal(body.file.displayName, 'a.png');
      assert.match(body.markdown, /^\[a\.png\]\(https:\/\/aindrive\.example\/d\/drvB\/a\.png\)$/);
      assert.equal(findSecretKey(body), null);
      assert.ok(!JSON.stringify(body).includes(TOKEN));
      assert.equal(d.writes.length, 1);
    })();
  } finally { Object.assign(attachmentsDeps, prev); }
});

test('옛 첨부는 그대로: backend 파일 id 는 여전히 /api/files/:id 프록시로 열린다', () => {
  assert.equal(chatFileSrc({ id: '0b7c7a3e-1111-4222-8333-944445555666' }, 'tok'), '/api/files/0b7c7a3e-1111-4222-8333-944445555666?token=tok');
});

test('첨부 UI: 플래그 off 면 렌더링 없음, on 이면 진입점; 업로드 헬퍼는 multipart 로 보내고 링크 파트를 돌려준다', async () => {
  await withEnv({ NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined }, () => {
    assert.equal(renderToStaticMarkup(<ChatAttachmentUpload onUploaded={() => {}} />), '');
  })();
  await withEnv({ NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: 'true' }, () => {
    assert.ok(renderToStaticMarkup(<ChatAttachmentUpload onUploaded={() => {}} />).includes('data-testid="chat-attachment-upload"'));
  })();
  let sent: FormData | null = null;
  const r = await uploadChatAttachment(async (input, init) => {
    assert.equal(input, '/api/ain/attachments');
    sent = init?.body as FormData;
    return jsonResponse({ file: root(DRIVE, 'beta'), markdown: '[a](u)', reused: false });
  }, new File([PNG], 'a.png'));
  assert.ok(r.ok);
  assert.equal((sent as unknown as FormData).get('file') instanceof File, true);
  const bad = await uploadChatAttachment(async () => jsonResponse({ error: { code: 'auth_required', message: '연결 필요', retryable: false, actionUrl: 'http://x/api/ain/aindrive/connect' } }, 401), new File([PNG], 'a.png'));
  assert.deepEqual(bad, { ok: false, error: { message: '연결 필요', actionUrl: 'http://x/api/ain/aindrive/connect' } });
});
