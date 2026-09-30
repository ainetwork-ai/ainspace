import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { aindriveFileId } from './files';
import { findSecretKey, resetNativeSupport } from './http';
import { invokeSharedAgent, parseInvokeBody, type InvokeOptions } from './invoke';
import { isRenamedVariant, parseSaveTo, renamedName, resolveOwnFolder, saveAnswerToFolder, type SaveTarget } from './save';
import { AIN_CONTRACT_VERSION, AinContractError, HTTP_STATUS_FOR, fileKey, isTaskRef, type AgentRef, type FileRef } from './types';
import { fakeFetch, jsonResponse } from './__tests__/helpers';

const AINDRIVE = 'https://aindrive.example';
const AINIZE = 'https://ainize.example';
const DRIVE_B = 'drvB';
const TOKEN = 'aind_aat_secret_bob';
const AGENT_KEY = `${AINIZE}#doc-summary`;
const ANSWER = '두 줄 요약.\n\nSources\n- 전시 안내.md (김작가, 12점)';
const BYTES = Buffer.byteLength(ANSWER, 'utf8');

const bob = { kind: 'account' as const, issuer: 'https://sso.example', subject: 'acc_bob' };
const rootB: FileRef = {
  contract: AIN_CONTRACT_VERSION, issuer: AINDRIVE, driveId: DRIVE_B, fileId: aindriveFileId(DRIVE_B, '/'), revision: 'm0-s0', kind: 'folder',
  displayName: 'drive-B', ownerRef: bob, availability: { state: 'online' }, sourceUrl: `${AINDRIVE}/d/${DRIVE_B}/`, legacy: { path: '/' },
};
const rootA: FileRef = { ...rootB, driveId: 'drvA', fileId: aindriveFileId('drvA', '/'), displayName: 'drive-A', ownerRef: { kind: 'account', issuer: 'https://sso.example', subject: 'acc_alice' }, sourceUrl: `${AINDRIVE}/d/drvA/`, legacy: { path: '/' } };
const ROOT_B_KEY = fileKey(rootB);

const agentRef = (): AgentRef => ({
  contract: AIN_CONTRACT_VERSION, registryIssuer: AINIZE, agentId: 'doc-summary', releaseId: 'v2',
  ownerRef: { kind: 'wallet', issuer: AINIZE, subject: '0xabc' }, visibility: 'public',
  agentCardUrl: `${AINIZE}/agents/doc-summary/.well-known/agent-card.json`, endpoint: `${AINIZE}/agents/doc-summary`,
  supportedProtocolVersions: ['0.3.0'], skills: [], inputModes: ['text/plain'], outputModes: ['text/plain'], uiCapabilities: ['streaming'],
  status: 'active', displayName: '문서 요약', updatedAt: '2026-09-29T06:00:00Z',
});

interface Entry { name: string; path: string; isDir: boolean; size?: number; mtimeMs?: number; mime?: string }
const sse = (v: unknown) => new Response(`event: message\ndata: ${JSON.stringify(v)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });

/**
 * 가짜 aindrive: 목록(mine=drive-B, shared_with_me=drive-A) + 드라이브 MCP(list_files / write_file) + fs/write
 * (기본은 실제와 같이 계정 토큰을 401 로 거절) + 가짜 Ainize(목록·A2A, 파일 없음이라 SSO 불필요).
 */
function stack(o: { entries?: Record<string, Entry[]>; native?: 'reject' | 'ok' | 403; mcpWrite?: 'ok' | 'forbidden' | 'unknown_tool' | 'http403'; agentState?: string } = {}) {
  const entries: Record<string, Entry[]> = o.entries ?? { '': [] };
  const writes: { via: 'native' | 'mcp'; path: string; content: string; auth?: string }[] = [];
  const mcpCalls: string[] = [];
  const a2aCalls: number[] = [];
  const f = fakeFetch({
    '/api/shared-agents': () => jsonResponse({ contract: '1.0', asOf: '2026-09-29T06:00:00Z', nextCursor: null, items: [{ ref: agentRef(), canInvoke: true }] }),
    '/api/oauth/shared': (url, init) => {
      assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
      const scope = url.searchParams.get('scope');
      return jsonResponse({ contract: '1.0', asOf: '2026-09-29T06:00:00Z', nextCursor: null, items: scope === 'mine' ? [{ ref: rootB, role: 'owner', shareOrigin: 'own' }] : scope === 'shared_with_me' ? [{ ref: rootA, role: 'viewer', shareOrigin: 'direct' }] : [] });
    },
    [`/api/drives/${DRIVE_B}/fs/write`]: (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (o.native === 403) return jsonResponse({ error: 'forbidden' }, 403);
      if (o.native === 'ok') {
        writes.push({ via: 'native', path: body.path, content: body.content, auth: (init?.headers as Record<string, string>).authorization });
        (entries[''] ??= []).push({ name: body.path.slice(1), path: body.path.slice(1), isDir: false, size: Buffer.byteLength(body.content), mtimeMs: 1790700000000 });
        return jsonResponse({ ok: true, mtimeMs: 1790700000000, size: Buffer.byteLength(body.content) });
      }
      return jsonResponse({ error: 'forbidden' }, 401);
    },
    [`/mcp/d/${DRIVE_B}`]: (_url, init) => {
      assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
      const body = JSON.parse(String(init?.body));
      mcpCalls.push(body.params.name);
      if (body.params.name === 'list_files') {
        const dir = entries[body.params.arguments.path] ?? [];
        return sse({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'x' }], structuredContent: { entries: dir } } });
      }
      if (body.params.name === 'write_file') {
        if (o.mcpWrite === 'http403') return jsonResponse({ error: 'forbidden' }, 403);
        if (o.mcpWrite === 'forbidden') return sse({ jsonrpc: '2.0', id: body.id, result: { isError: true, content: [{ type: 'text', text: '[forbidden] editor role required' }] } });
        if (o.mcpWrite === 'unknown_tool') return sse({ jsonrpc: '2.0', id: body.id, result: { isError: true, content: [{ type: 'text', text: 'unknown tool: write_file' }] } });
        const { path, content } = body.params.arguments as { path: string; content: string };
        writes.push({ via: 'mcp', path, content });
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        (entries[dir] ??= []).push({ name: path.split('/').pop()!, path, isDir: false, size: Buffer.byteLength(content), mtimeMs: 1790700000000, mime: 'text/markdown' });
        return sse({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: `wrote ${path}` }], structuredContent: { ok: true, mtimeMs: 1790700000000, size: Buffer.byteLength(content) } } });
      }
      return sse({ jsonrpc: '2.0', id: body.id, result: { isError: true, content: [{ type: 'text', text: `unknown tool: ${body.params.name}` }] } });
    },
    '/agents/doc-summary': (_url, init) => {
      const body = JSON.parse(String(init?.body));
      a2aCalls.push(1);
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { id: 'task_1', contextId: body.params.message.contextId, status: { state: o.agentState ?? 'completed' }, artifacts: [{ parts: [{ kind: 'text', text: ANSWER }] }] } });
    },
  });
  return { f, writes, mcpCalls, a2aCalls, entries };
}

const filesOpts = (f: ReturnType<typeof fakeFetch>, token: string | null = TOKEN) => ({ aindriveUrl: AINDRIVE, token, connectUrl: `${AINDRIVE}/oauth/authorize`, fetch: f, now: () => new Date('2026-09-29T06:00:00Z') });
const opts = (f: ReturnType<typeof fakeFetch>, over: Partial<InvokeOptions> = {}): InvokeOptions => ({
  aindriveUrl: AINDRIVE, ainizeUrl: AINIZE, aindriveToken: TOKEN, aindriveConnectUrl: `${AINDRIVE}/oauth/authorize`, sso: null,
  getSessionProof: async () => null, scope: { account: 'user-42', org: null, product: 'ainspace' }, fetch: f, now: () => new Date('2026-09-29T06:00:00Z'), ...over,
});
const saveTo = (over: Partial<SaveTarget> = {}): SaveTarget => ({ folderKey: ROOT_B_KEY, displayName: 'summary.md', onConflict: 'rename', ...over });
const request = (over: Partial<SaveTarget> = {}) => ({ agentKey: AGENT_KEY, text: '요약해줘', fileKeys: [], conversation: 'thr_1', saveTo: saveTo(over) });
const existingSummary = (size: number): Entry => ({ name: 'summary.md', path: 'summary.md', isDir: false, size, mtimeMs: 1790600000000, mime: 'text/markdown' });

beforeEach(() => resetNativeSupport());

test('parseSaveTo / parseInvokeBody: saveTo 검증 — 모양·이름·정책', () => {
  assert.equal(parseSaveTo({ folderKey: ROOT_B_KEY, displayName: 'a.md', onConflict: 'fail' }).ok, true);
  assert.equal(parseSaveTo({ folderKey: 'nohash', displayName: 'a.md', onConflict: 'fail' }).ok, false);
  assert.equal(parseSaveTo({ folderKey: ROOT_B_KEY, displayName: 'sub/a.md', onConflict: 'fail' }).ok, false);
  assert.equal(parseSaveTo({ folderKey: ROOT_B_KEY, displayName: '..', onConflict: 'fail' }).ok, false);
  assert.equal(parseSaveTo({ folderKey: ROOT_B_KEY, displayName: ' a.md', onConflict: 'fail' }).ok, false);
  assert.equal(parseSaveTo({ folderKey: ROOT_B_KEY, displayName: 'a.md', onConflict: 'skip' }).ok, false);
  assert.equal(parseSaveTo('x').ok, false);
  // NFD 로 온 이름은 NFC 로 정규화된다.
  const nfd = parseSaveTo({ folderKey: ROOT_B_KEY, displayName: '요약.md'.normalize('NFD'), onConflict: 'rename' });
  assert.ok(nfd.ok && nfd.saveTo.displayName === '요약.md'.normalize('NFC'));
  const body = parseInvokeBody({ agentKey: AGENT_KEY, text: '요약', conversation: 'c1', saveTo: saveTo() });
  assert.ok(body.ok && body.req.saveTo?.folderKey === ROOT_B_KEY && body.req.saveTo.onConflict === 'rename');
  const bad = parseInvokeBody({ agentKey: AGENT_KEY, text: '요약', conversation: 'c1', saveTo: { folderKey: ROOT_B_KEY } });
  assert.ok(!bad.ok && /saveTo\.displayName/.test(bad.message));
  const none = parseInvokeBody({ agentKey: AGENT_KEY, text: '요약', conversation: 'c1', saveTo: null });
  assert.ok(none.ok && none.req.saveTo === undefined);
});

test('저장: fs/write 가 계정 토큰을 401 로 거절하면 MCP write_file 로 쓰고 outputs[0] 이 계약 FileRef 다', async () => {
  const s = stack();
  const { task, text } = await invokeSharedAgent(opts(s.f), request());
  assert.equal(text, ANSWER);
  assert.ok(isTaskRef(task));
  assert.equal(task.status, 'completed');
  assert.equal(s.writes.length, 1);
  assert.deepEqual(s.writes[0], { via: 'mcp', path: 'summary.md', content: ANSWER });
  assert.equal(s.f.calls.filter((c) => c.url.endsWith('/fs/write')).length, 1);
  assert.equal(task.outputs.length, 1);
  const out = task.outputs[0];
  assert.equal(out.overwrote, false);
  assert.equal(out.file.contract, AIN_CONTRACT_VERSION);
  assert.equal(out.file.issuer, AINDRIVE);
  assert.equal(out.file.driveId, DRIVE_B);
  assert.equal(out.file.fileId, aindriveFileId(DRIVE_B, '/summary.md'));
  assert.match(out.file.fileId, /^p1:[0-9a-f]{32}$/);
  assert.equal(out.file.revision, `m1790700000000-s${BYTES}`);
  assert.equal(out.file.kind, 'file');
  assert.equal(out.file.displayName, 'summary.md');
  assert.equal(out.file.mimeType, 'text/markdown');
  assert.deepEqual(out.file.ownerRef, bob);
  assert.equal(out.file.availability.state, 'online');
  assert.equal(out.file.sourceUrl, `${AINDRIVE}/d/${DRIVE_B}/summary.md`);
  assert.deepEqual(out.file.legacy, { path: '/summary.md' });
  assert.equal(out.file.size, BYTES);
  // 토큰은 헤더로만 갔고 결과 어디에도 없다.
  assert.equal(findSecretKey({ task, text }), null);
  assert.ok(!JSON.stringify({ task, text }).includes(TOKEN));
  assert.ok(s.f.calls.every((c) => !c.url.includes(TOKEN)));
  // 네이티브 판별은 기억된다: 두 번째 저장은 fs/write 를 다시 두드리지 않는다.
  await saveAnswerToFolder(filesOpts(s.f), rootB, saveTo({ displayName: 'other.md' }), ANSWER);
  assert.equal(s.f.calls.filter((c) => c.url.endsWith('/fs/write')).length, 1);
  assert.equal(s.writes.length, 2);
});

test('저장: fs/write 가 계정 토큰을 받으면 그대로 쓰고 MCP write_file 은 부르지 않는다', async () => {
  const s = stack({ native: 'ok' });
  const r = await saveAnswerToFolder(filesOpts(s.f), rootB, saveTo(), ANSWER);
  assert.equal(s.writes.length, 1);
  assert.equal(s.writes[0].via, 'native');
  assert.equal(s.writes[0].path, '/summary.md');
  assert.equal(s.writes[0].auth, `Bearer ${TOKEN}`);
  assert.ok(!s.mcpCalls.includes('write_file'));
  assert.equal(r.file.fileId, aindriveFileId(DRIVE_B, '/summary.md'));
  assert.equal(r.overwrote, false);
  assert.equal(r.reused, false);
});

test('재시도 재사용: 같은 이름·같은 바이트 수의 파일이 이미 있으면(정책 ≠ overwrite) 다시 쓰지 않고 overwrote=false', async () => {
  for (const onConflict of ['rename', 'fail'] as const) {
    resetNativeSupport();
    const s = stack({ entries: { '': [existingSummary(BYTES)] } });
    const { task } = await invokeSharedAgent(opts(s.f), request({ onConflict }));
    assert.equal(s.writes.length, 0, `${onConflict}: no write`);
    assert.equal(task.outputs.length, 1);
    assert.equal(task.outputs[0].overwrote, false);
    assert.equal(task.outputs[0].file.fileId, aindriveFileId(DRIVE_B, '/summary.md'));
    assert.equal(task.outputs[0].file.revision, `m1790600000000-s${BYTES}`);
    assert.deepEqual(task.outputs[0].file.ownerRef, bob);
  }
});

test('재시도 재사용(rename 변형): 이전 실행이 `<이름>-<무작위>.<확장자>` 로 저장했어도 같은 바이트 수면 그 파일을 돌려준다', async () => {
  const s = stack({ entries: { '': [existingSummary(BYTES + 7), { ...existingSummary(BYTES), name: 'summary-k3x9a.md', path: 'summary-k3x9a.md' }] } });
  const { task } = await invokeSharedAgent(opts(s.f), request({ onConflict: 'rename' }));
  assert.equal(s.writes.length, 0);
  assert.equal(task.outputs[0].file.displayName, 'summary-k3x9a.md');
  assert.equal(task.outputs[0].file.fileId, aindriveFileId(DRIVE_B, '/summary-k3x9a.md'));
  assert.equal(task.outputs[0].overwrote, false);
  // 변형이 아닌 이름(다른 접두·긴 접미)은 재사용하지 않는다.
  assert.equal(isRenamedVariant('summary.md', 'summary-k3x9a.md'), true);
  assert.equal(isRenamedVariant('summary.md', 'summary-k3x9a7b.md'), false);
  assert.equal(isRenamedVariant('summary.md', 'summary.md'), false);
  assert.equal(isRenamedVariant('summary.md', 'summary-k3x9a.txt'), false);
  assert.equal(isRenamedVariant('a.b.md', 'a.b-zz.md'), true);
  assert.equal(isRenamedVariant('a.b.md', 'aXb-zz.md'), false);
});

test('rename: 다른 내용의 같은 이름이 있으면 `<이름>-<무작위>.<확장자>` 로 쓴다', async () => {
  const s = stack({ entries: { '': [existingSummary(BYTES + 7)] } });
  const { task } = await invokeSharedAgent(opts(s.f), request({ onConflict: 'rename' }));
  assert.equal(s.writes.length, 1);
  assert.match(s.writes[0].path, /^summary-[0-9a-z]{1,6}\.md$/);
  const out = task.outputs[0];
  assert.equal(out.overwrote, false);
  assert.equal(out.file.displayName, s.writes[0].path);
  assert.equal(out.file.fileId, aindriveFileId(DRIVE_B, `/${s.writes[0].path}`));
  assert.deepEqual(out.file.legacy, { path: `/${s.writes[0].path}` });
  // 겹치는 이름은 피한다.
  const names = new Set(['a-x.md']);
  let n = 0;
  assert.equal(renamedName('a.md', names, () => (n++ === 0 ? 'x' : 'y')), 'a-y.md');
  assert.equal(renamedName('noext', new Set(), () => 'z'), 'noext-z');
});

test('fail: 다른 내용의 같은 이름이 있으면 unsupported_input 이고 HTTP status 는 409 (원본 status 가 아니라 계약의 충돌 매핑)', async () => {
  const s = stack({ entries: { '': [existingSummary(BYTES + 7)] } });
  await assert.rejects(() => invokeSharedAgent(opts(s.f), request({ onConflict: 'fail' })), (e: AinContractError) =>
    e instanceof AinContractError && e.code === 'unsupported_input' && e.status === 409 && e.detail === 'name_conflict' && e.retryable === false && !e.message.includes(TOKEN));
  assert.equal(s.writes.length, 0);
  // 충돌이 아닌 unsupported_input 은 여전히 코드 표의 status 다.
  assert.equal(new AinContractError('unsupported_input', 'x').status, HTTP_STATUS_FOR.unsupported_input);
});

test('overwrite: 같은 이름이 있으면 같은 경로에 쓰고 overwrote=true', async () => {
  const s = stack({ entries: { '': [existingSummary(BYTES + 7)] } });
  const { task } = await invokeSharedAgent(opts(s.f), request({ onConflict: 'overwrite' }));
  assert.equal(s.writes.length, 1);
  assert.equal(s.writes[0].path, 'summary.md');
  assert.equal(task.outputs[0].overwrote, true);
  assert.equal(task.outputs[0].file.fileId, aindriveFileId(DRIVE_B, '/summary.md'));
  // overwrite 는 같은 바이트여도 다시 쓴다(재사용 규칙은 overwrite 에 적용되지 않는다).
  resetNativeSupport();
  const s2 = stack({ entries: { '': [existingSummary(BYTES)] } });
  const r2 = await invokeSharedAgent(opts(s2.f), request({ onConflict: 'overwrite' }));
  assert.equal(s2.writes.length, 1);
  assert.equal(r2.task.outputs[0].overwrote, true);
});

test('계정 토큰 없음 → auth_required + 연결 actionUrl, 에이전트는 호출되지 않는다', async () => {
  const s = stack();
  await assert.rejects(() => invokeSharedAgent(opts(s.f, { aindriveToken: null }), request()), (e: AinContractError) =>
    e instanceof AinContractError && e.code === 'auth_required' && e.actionUrl === `${AINDRIVE}/oauth/authorize`);
  assert.equal(s.a2aCalls.length, 0);
  assert.equal(s.writes.length, 0);
});

test('쓰기 403 → forbidden (fs/write 403, MCP HTTP 403, MCP [forbidden], 도구 없음=drives:write 없음)', async () => {
  for (const o of [{ native: 403 as const }, { mcpWrite: 'http403' as const }, { mcpWrite: 'forbidden' as const }, { mcpWrite: 'unknown_tool' as const }]) {
    resetNativeSupport();
    const s = stack(o);
    await assert.rejects(() => saveAnswerToFolder(filesOpts(s.f), rootB, saveTo(), ANSWER), (e: AinContractError) =>
      e instanceof AinContractError && e.code === 'forbidden' && e.status === HTTP_STATUS_FOR.forbidden && e.retryable === false && !e.message.includes(TOKEN) && !e.message.includes('editor role required'),
      JSON.stringify(o));
    assert.equal(s.writes.length, 0);
  }
});

test('폴더가 내 목록(mine)에 없으면 forbidden — 남의 공유 드라이브(shared_with_me)에는 쓰지 않고 에이전트도 부르지 않는다', async () => {
  const s = stack();
  await assert.rejects(() => invokeSharedAgent(opts(s.f), request({ folderKey: fileKey(rootA) })), (e: AinContractError) => e instanceof AinContractError && e.code === 'forbidden');
  await assert.rejects(() => resolveOwnFolder(filesOpts(s.f), `https://other.example#${DRIVE_B}#p1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`), (e: AinContractError) => e.code === 'unsupported_input');
  assert.equal(s.a2aCalls.length, 0);
});

test('하위 폴더는 내 뿌리 아래를 MCP list_files 로 탐색해 찾고, 그 안에 쓴다; 파일을 가리키면 unsupported_input', async () => {
  const s = stack({ entries: { '': [{ name: 'out', path: 'out', isDir: true }, { name: 'note.md', path: 'note.md', isDir: false, size: 3 }], out: [] } });
  const subKey = `${AINDRIVE}#${DRIVE_B}#${aindriveFileId(DRIVE_B, '/out')}`;
  const folder = await resolveOwnFolder(filesOpts(s.f), subKey);
  assert.equal(folder.kind, 'folder');
  assert.deepEqual(folder.legacy, { path: '/out' });
  assert.deepEqual(folder.ownerRef, bob);
  const r = await saveAnswerToFolder(filesOpts(s.f), folder, saveTo(), ANSWER);
  assert.equal(s.writes[0].path, 'out/summary.md');
  assert.equal(r.file.fileId, aindriveFileId(DRIVE_B, '/out/summary.md'));
  assert.equal(r.file.sourceUrl, `${AINDRIVE}/d/${DRIVE_B}/out/summary.md`);
  await assert.rejects(() => resolveOwnFolder(filesOpts(s.f), `${AINDRIVE}#${DRIVE_B}#${aindriveFileId(DRIVE_B, '/note.md')}`), (e: AinContractError) => e.code === 'unsupported_input');
});

test('task 가 completed 가 아니면 쓰지 않고 outputs 는 비어 있다', async () => {
  const s = stack({ agentState: 'working' });
  const { task } = await invokeSharedAgent(opts(s.f), request());
  assert.equal(task.status, 'working');
  assert.deepEqual(task.outputs, []);
  assert.equal(s.writes.length, 0);
});
