import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import taskRefFixture from './__fixtures__/task-ref.json';
import delegationClaimsFixture from './__fixtures__/delegation-claims.json';
import { buildA2aMessage, textOfTask } from './a2a';
import { requestDelegation } from './delegation';
import { aindriveFileId } from './files';
import { findSecretKey, resetNativeSupport } from './http';
import { deriveIdempotencyKey, invokeSharedAgent, parseInvokeBody, type InvokeOptions } from './invoke';
import type { FetchLike } from './http';
import { AIN_CONTRACT_VERSION, AinContractError, DELEGATION_PART_TYPE, FILE_REFS_PART_TYPE, HTTP_STATUS_FOR, conversationContextId, isTaskRef, type AgentRef, type FileRef } from './types';
import { fakeFetch, jsonResponse } from './__tests__/helpers';

const AINDRIVE = 'https://aindrive.example';
const AINIZE = 'https://ainize.example';
const SSO = 'https://sso.example';
const DRIVE = 'drv_1';
const FILE_PATH = '/전시 안내.md';
const FILE_ID = aindriveFileId(DRIVE, FILE_PATH);
const FILE_KEY = `${AINDRIVE}#${DRIVE}#${FILE_ID}`;
const AGENT_KEY = `${AINIZE}#doc-summary`;
const POP_JWK = { kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0', kid: 'k1' };
const DELEGATION_TOKEN = 'eyJhbGciOiJFUzI1NiJ9.fake-delegation-payload-rdlg_1.fake-signature';
const SESSION_PROOF = 'eyJhbGciOiJFUzI1NiJ9.idtoken-B-payload.idtoken-B-sig';

const agentRef = (over: Partial<AgentRef> = {}): AgentRef => ({
  contract: AIN_CONTRACT_VERSION, registryIssuer: AINIZE, agentId: 'doc-summary', releaseId: 'v2',
  ownerRef: { kind: 'wallet', issuer: AINIZE, subject: '0xabc' }, visibility: 'public',
  agentCardUrl: `${AINIZE}/agents/doc-summary/.well-known/agent-card.json`, endpoint: `${AINIZE}/agents/doc-summary`,
  supportedProtocolVersions: ['0.3.0'], skills: [], inputModes: ['text/plain'], outputModes: ['text/plain'], uiCapabilities: ['streaming'],
  popJwk: POP_JWK, status: 'active', displayName: '문서 요약', updatedAt: '2026-09-29T06:00:00Z', ...over,
});

const rootFolder: FileRef = {
  contract: AIN_CONTRACT_VERSION, issuer: AINDRIVE, driveId: DRIVE, fileId: aindriveFileId(DRIVE, '/'), revision: 'm1-s0', kind: 'folder',
  displayName: 'drive-A', ownerRef: { kind: 'account', issuer: SSO, subject: 'acc_alice' }, availability: { state: 'online' },
  sourceUrl: `${AINDRIVE}/d/${DRIVE}/`, legacy: { path: '/' },
};

const sse = (v: unknown) => new Response(`event: message\ndata: ${JSON.stringify(v)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });

/** 가짜 SSO(발급/거절) + 가짜 aindrive(목록·MCP 폴더) + 가짜 Ainize(목록·A2A). */
function stack(o: { agents?: AgentRef[]; ssoRejects?: 'proof' | 'client' | null; agentReply?: (body: Record<string, unknown>) => unknown; echoToken?: boolean } = {}) {
  const agents = o.agents ?? [agentRef()];
  const a2aBodies: { params: { message: { messageId: string; contextId: string; parts: { kind: string; text?: string; data?: Record<string, unknown>; metadata?: { type?: string } }[] } } }[] = [];
  const ssoBodies: Record<string, unknown>[] = [];
  const ssoAuth: (string | undefined)[] = [];
  const f = fakeFetch({
    '/api/shared-agents': () => jsonResponse({ contract: '1.0', asOf: '2026-09-29T06:00:00Z', nextCursor: null, items: agents.map((ref) => ({ ref, canInvoke: ref.status === 'active' })) }),
    '/api/oauth/shared': (url) => jsonResponse({ contract: '1.0', asOf: '2026-09-29T06:00:00Z', nextCursor: null, items: url.searchParams.get('scope') === 'shared_with_me' ? [{ ref: rootFolder, role: 'viewer', shareOrigin: 'direct' }] : [] }),
    [`/mcp/d/${DRIVE}`]: (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.params.name, 'list_files');
      const entries = body.params.arguments.path === ''
        ? [{ name: '전시 안내.md', path: '전시 안내.md', isDir: false, size: 88, mtimeMs: 1790668441187, mime: 'text/markdown' }, { name: 'sub', path: 'sub', isDir: true }]
        : [{ name: 'deep.md', path: 'sub/deep.md', isDir: false, size: 1, mtimeMs: 2, mime: 'text/markdown' }];
      return sse({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'x' }], structuredContent: { entries } } });
    },
    '/api/delegations/resource': (_url, init) => {
      const body = JSON.parse(String(init?.body));
      ssoBodies.push(body);
      ssoAuth.push((init?.headers as Record<string, string>).authorization);
      if (o.ssoRejects === 'client') return jsonResponse({ error: 'invalid_client' }, 401);
      if (o.ssoRejects === 'proof' || body.sessionProof !== SESSION_PROOF) return jsonResponse({ error: 'session_proof_invalid', error_description: 'sessionProof must be a valid ID token' }, 400);
      if (!body.cnf?.jwk?.x) return jsonResponse({ error: 'invalid_request' }, 400);
      return jsonResponse({ jti: 'rdlg_1', token: DELEGATION_TOKEN, expiresAt: Math.floor(Date.now() / 1000) + body.ttlSeconds, reused: false }, 201);
    },
    '/agents/doc-summary': (_url, init) => {
      const body = JSON.parse(String(init?.body));
      a2aBodies.push(body);
      if (o.agentReply) return jsonResponse(o.agentReply(body));
      const text = o.echoToken ? `요약. Sources: 전시 안내.md ${DELEGATION_TOKEN}` : '두 줄 요약.\n\nSources\n- 전시 안내.md (김작가, 12점)';
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { id: `task_${body.params.message.messageId.slice(5, 13)}`, contextId: body.params.message.contextId, status: { state: 'completed' }, artifacts: [{ parts: [{ kind: 'text', text }] }] } });
    },
  });
  return { f, a2aBodies, ssoBodies, ssoAuth };
}

const opts = (f: ReturnType<typeof fakeFetch>, over: Partial<InvokeOptions> = {}): InvokeOptions => ({
  aindriveUrl: AINDRIVE, ainizeUrl: AINIZE, aindriveToken: 'aind_aat_secret', aindriveConnectUrl: `${AINDRIVE}/oauth/authorize`,
  sso: { issuer: SSO, clientId: 'client-ainspace', clientSecret: 's3cret', connectUrl: `${SSO}/` },
  getSessionProof: async () => SESSION_PROOF,
  scope: { account: 'user-42', org: null, product: 'ainspace' },
  fetch: f, now: () => new Date('2026-09-29T06:00:00Z'), ...over,
});

const request = { agentKey: AGENT_KEY, text: '이 문서를 두 줄로 요약하고 Sources를 남겨줘', fileKeys: [FILE_KEY], conversation: 'thr_1' };

beforeEach(() => resetNativeSupport());

test('fixture: 계약 task-ref 와 delegation-claims 를 파싱한다', () => {
  assert.ok(isTaskRef(taskRefFixture));
  assert.equal(taskRefFixture.sources[0].citations[0].locator, 'page 2');
  assert.equal(findSecretKey(taskRefFixture), null);
  assert.equal(delegationClaimsFixture.agt, 'https://ainize.ai#gallery-guide');
  assert.deepEqual(delegationClaimsFixture.res[0].actions, ['read']);
  assert.ok('jkt' in delegationClaimsFixture.cnf);
});

test('(a) parts 3개가 text → file-refs → delegation 순서·type 으로 전송되고 messageId=idempotencyKey, contextId 는 scope 에서 온다', async () => {
  const s = stack();
  const { task, text } = await invokeSharedAgent(opts(s.f), request);
  assert.equal(s.a2aBodies.length, 1);
  const msg = s.a2aBodies[0].params.message;
  assert.deepEqual(msg.parts.map((p) => p.metadata?.type ?? p.kind), ['text', FILE_REFS_PART_TYPE, DELEGATION_PART_TYPE]);
  assert.equal(msg.parts[0].text, request.text);
  const refs = (msg.parts[1].data as { refs: FileRef[] }).refs;
  assert.equal(refs.length, 1);
  assert.equal(refs[0].fileId, FILE_ID);
  assert.deepEqual(refs[0].legacy, { path: FILE_PATH });
  assert.equal(refs[0].kind, 'file');
  assert.equal(refs[0].mimeType, 'text/markdown');
  assert.equal(refs[0].displayName, '전시 안내.md');
  assert.equal(msg.parts[2].data!.token, DELEGATION_TOKEN);
  assert.deepEqual(msg.parts[2].data!.audience, [AINDRIVE]);
  assert.equal(msg.parts[2].data!.jti, 'rdlg_1');
  assert.equal(msg.messageId, task.idempotencyKey);
  assert.equal(msg.contextId, conversationContextId({ account: 'user-42', org: null, product: 'ainspace', room: null, conversation: 'thr_1' }));
  assert.equal(msg.contextId, 'ctx:user-42:-:ainspace:-:thr_1');
  // SSO 요청: client_secret_basic, 세션 증명, agent/resources/audience/cnf
  assert.equal(s.ssoAuth[0], `Basic ${Buffer.from('client-ainspace:s3cret').toString('base64')}`);
  const sso = s.ssoBodies[0] as { agent: string; resources: { resource: string; actions: string[] }[]; audience: string[]; ttlSeconds: number; cnf: { jwk: { x: string } }; idempotencyKey: string };
  assert.equal(sso.agent, AGENT_KEY);
  assert.deepEqual(sso.resources, [{ resource: FILE_KEY, actions: ['read'] }]);
  assert.deepEqual(sso.audience, [AINDRIVE]);
  assert.equal(sso.ttlSeconds, 900);
  assert.equal(sso.cnf.jwk.x, POP_JWK.x);
  // 위임 키 접미는 무작위 UUID(시각이 아니다).
  assert.match(sso.idempotencyKey, new RegExp(`^${task.idempotencyKey}-dlg-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`));
  // 결과
  assert.ok(isTaskRef(task));
  assert.equal(task.status, 'completed');
  assert.equal(task.agent, AGENT_KEY);
  assert.equal(task.sources[0].file.fileId, FILE_ID);
  assert.match(text, /Sources/);
});

test('(b) 토큰은 text part·응답·오류 메시지에 없다 — 에이전트가 토큰을 되돌려 말해도 지운다', async () => {
  const s = stack({ echoToken: true });
  const result = await invokeSharedAgent(opts(s.f), request);
  const msg = s.a2aBodies[0].params.message;
  assert.ok(!msg.parts[0].text!.includes(DELEGATION_TOKEN));
  assert.ok(!msg.parts[0].text!.includes(SESSION_PROOF));
  const out = JSON.stringify(result);
  assert.ok(!out.includes(DELEGATION_TOKEN));
  assert.ok(!out.includes(SESSION_PROOF));
  assert.ok(!out.includes('aind_aat_secret'));
  assert.ok(result.text.includes('[redacted]'));
  assert.equal(findSecretKey(result), null);
  // 세션 증명은 SSO 바디로만 나간다(URL·다른 원본 호출에는 없다)
  for (const c of s.f.calls) {
    assert.ok(!c.url.includes(SESSION_PROOF));
    if (!c.url.endsWith('/api/delegations/resource')) assert.ok(!String(c.init?.body ?? '').includes(SESSION_PROOF));
  }
});

test('(c) 같은 입력 두 번 → 같은 messageId·taskId, 위임 키는 시도마다 다르다; 입력이 다르면 다른 키', async () => {
  const s = stack();
  const a = await invokeSharedAgent(opts(s.f), request);
  const b = await invokeSharedAgent(opts(s.f), request);
  assert.equal(a.task.idempotencyKey, b.task.idempotencyKey);
  assert.equal(a.task.taskId, b.task.taskId);
  assert.equal(s.a2aBodies[0].params.message.messageId, s.a2aBodies[1].params.message.messageId);
  assert.notEqual((s.ssoBodies[0] as { idempotencyKey: string }).idempotencyKey, (s.ssoBodies[1] as { idempotencyKey: string }).idempotencyKey);
  const c = await invokeSharedAgent(opts(s.f), { ...request, text: '다른 질문' });
  assert.notEqual(c.task.idempotencyKey, a.task.idempotencyKey);
  const d = await invokeSharedAgent(opts(s.f, { scope: { account: 'user-99', org: null, product: 'ainspace' } }), request);
  assert.notEqual(d.task.idempotencyKey, a.task.idempotencyKey);
  assert.match(a.task.idempotencyKey, /^idem_[0-9a-f]{40}$/);
  assert.equal(deriveIdempotencyKey({ account: 'u', agentKey: 'a#b', fileKeys: ['k'], text: 't', conversation: 'c' }), deriveIdempotencyKey({ account: 'u', agentKey: 'a#b', fileKeys: ['k'], text: 't', conversation: 'c' }));
  // room 은 contextId 의 경계이므로 키에도 들어간다: 다른 방 = 다른 messageId. fileKeys 는 순서와 무관.
  const e = await invokeSharedAgent(opts(s.f), { ...request, room: 'village-1' });
  assert.notEqual(e.task.idempotencyKey, a.task.idempotencyKey);
  assert.equal(e.task.contextId, 'ctx:user-42:-:ainspace:village-1:thr_1');
  const base = { account: 'u', agentKey: 'a#b', text: 't', conversation: 'c' };
  assert.equal(deriveIdempotencyKey({ ...base, fileKeys: ['k1', 'k2'] }), deriveIdempotencyKey({ ...base, fileKeys: ['k2', 'k1', 'k2'] }));
  assert.equal(deriveIdempotencyKey({ ...base, fileKeys: ['k'] }), deriveIdempotencyKey({ ...base, fileKeys: ['k'], room: null }));
  assert.notEqual(deriveIdempotencyKey({ ...base, fileKeys: ['k'], room: 'r1' }), deriveIdempotencyKey({ ...base, fileKeys: ['k'], room: 'r2' }));
});

test('(d) popJwk 없는 에이전트 → unsupported_input (SSO·A2A 는 호출되지 않는다)', async () => {
  const { popJwk: _p, ...noPop } = agentRef();
  void _p;
  const s = stack({ agents: [noPop as AgentRef] });
  await assert.rejects(() => invokeSharedAgent(opts(s.f), request), (e: AinContractError) => e.code === 'unsupported_input');
  assert.equal(s.ssoBodies.length, 0);
  assert.equal(s.a2aBodies.length, 0);
  assert.equal(aindriveCalls(s.f), 0, 'popJwk 없는 에이전트에는 aindrive 를 훑기 전에 끝난다');
});

const aindriveCalls = (f: ReturnType<typeof fakeFetch>) => f.calls.filter((c) => c.url.startsWith(AINDRIVE)).length;

test('(g) 순서: popJwk·SSO 설정·세션 증명을 aindrive 탐색보다 먼저 본다 — 전제가 없으면 aindrive 는 한 번도 불리지 않는다', async () => {
  const s = stack();
  await assert.rejects(() => invokeSharedAgent(opts(s.f, { getSessionProof: async () => null }), request), (e: AinContractError) => e.code === 'auth_required');
  assert.equal(aindriveCalls(s.f), 0, '세션 증명 없음 → aindrive 미호출');
  await assert.rejects(() => invokeSharedAgent(opts(s.f, { sso: null }), request), (e: AinContractError) => e.detail === 'ain_sso_client_missing');
  assert.equal(aindriveCalls(s.f), 0, 'SSO 설정 없음 → aindrive 미호출');
  // 파일이 없는 호출은 전제를 묻지 않는다(증명 조회조차 없다).
  let proofAsked = false;
  await invokeSharedAgent(opts(s.f, { getSessionProof: async () => { proofAsked = true; return null; } }), { ...request, fileKeys: [] });
  assert.equal(proofAsked, false);
  // 전제가 갖춰지면 aindrive 를 훑고(목록 + MCP) 위임·호출까지 간다.
  await invokeSharedAgent(opts(s.f), request);
  assert.ok(aindriveCalls(s.f) >= 2);
});

test('(h) actionUrl: SSO 거절 → AIN SSO 연결 URL, aindrive 토큰 없음 → aindrive 연결 URL (서로 바뀌지 않는다)', async () => {
  const s = stack({ ssoRejects: 'proof' });
  await assert.rejects(() => invokeSharedAgent(opts(s.f), request), (e: AinContractError) =>
    e.code === 'auth_required' && e.actionUrl === `${SSO}/` && e.detail === 'session_proof_invalid' && !e.message.includes('sessionProof must be'));
  await assert.rejects(() => invokeSharedAgent(opts(s.f, { getSessionProof: async () => null }), request), (e: AinContractError) => e.code === 'auth_required' && e.actionUrl === `${SSO}/`);
  await assert.rejects(() => invokeSharedAgent(opts(s.f, { aindriveToken: null }), request), (e: AinContractError) => e.code === 'auth_required' && e.actionUrl === `${AINDRIVE}/oauth/authorize`);
  // connectUrl 이 없는 배포면 actionUrl 없이 auth_required.
  await assert.rejects(() => invokeSharedAgent(opts(s.f, { sso: { issuer: SSO, clientId: 'c', clientSecret: 's' } }), request), (e: AinContractError) => e.code === 'auth_required' && e.actionUrl === undefined);
});

test('(i) 원본 오류 문장은 응답에 싣지 않는다 — SSO 계약 모양 오류의 message·A2A HTTP 오류; status 는 코드 표', async () => {
  // SSO 가 계약 모양 오류 바디를 돌려줘도 message 는 고정 문구, code 만 옮긴다.
  const ssoMsg = 'internal: token aind_aat_leaked for user X';
  const sso = fakeFetch({
    '/api/shared-agents': () => jsonResponse({ contract: '1.0', asOf: '2026-09-29T06:00:00Z', nextCursor: null, items: [{ ref: agentRef(), canInvoke: true }] }),
    '/api/oauth/shared': (url) => jsonResponse({ contract: '1.0', asOf: '2026-09-29T06:00:00Z', nextCursor: null, items: url.searchParams.get('scope') === 'shared_with_me' ? [{ ref: rootFolder, role: 'viewer', shareOrigin: 'direct' }] : [] }),
    [`/mcp/d/${DRIVE}`]: (_url, init) => sse({ jsonrpc: '2.0', id: JSON.parse(String(init?.body)).id, result: { content: [], structuredContent: { entries: [{ name: '전시 안내.md', path: '전시 안내.md', isDir: false, size: 88, mtimeMs: 1, mime: 'text/markdown' }] } } }),
    '/api/delegations/resource': () => jsonResponse({ error: { code: 'forbidden', message: ssoMsg, retryable: false } }, 418),
  });
  await assert.rejects(() => invokeSharedAgent(opts(sso), request), (e: AinContractError) => {
    const body = JSON.stringify(e.toBody());
    return e.code === 'forbidden' && e.status === 403 && e.upstreamStatus === 418 && e.detail === 'ain_sso_forbidden' && !body.includes(ssoMsg) && !body.includes('aind_aat_leaked') && !body.includes('418');
  });
  // 에이전트 엔드포인트가 5xx → temporary_failure, status 503(코드 표), 원본 숫자·문장은 바디에 없다.
  const agent500 = stack({ agentReply: () => { throw new Error('unused'); } });
  const f500: FetchLike = (url, init) => url.endsWith('/agents/doc-summary') ? Promise.resolve(new Response('upstream exploded: secret-ish text', { status: 500 })) : agent500.f(url, init);
  await assert.rejects(() => invokeSharedAgent(opts(f500 as ReturnType<typeof fakeFetch>), request), (e: AinContractError) => {
    const body = JSON.stringify(e.toBody());
    return e.code === 'temporary_failure' && e.retryable && e.status === 503 && e.upstreamStatus === 500 && e.detail === 'agent_http_error' && !body.includes('exploded') && !body.includes('500');
  });
  // 에이전트 403 → forbidden 403(코드 표와 같지만 upstreamStatus 로만 기억한다).
  const f403: FetchLike = (url, init) => url.endsWith('/agents/doc-summary') ? Promise.resolve(new Response('', { status: 403 })) : agent500.f(url, init);
  await assert.rejects(() => invokeSharedAgent(opts(f403 as ReturnType<typeof fakeFetch>), request), (e: AinContractError) => e.code === 'forbidden' && e.status === HTTP_STATUS_FOR.forbidden);
});

/** signal 이 abort 될 때까지 응답하지 않는 fetch — 타임아웃 검증용. */
const hangs = (base: ReturnType<typeof fakeFetch>, pathSuffix: string): FetchLike => (url, init) => {
  if (!url.endsWith(pathSuffix)) return base(url, init);
  return new Promise<Response>((_resolve, reject) => {
    const sig = init?.signal;
    assert.ok(sig, `${pathSuffix}: 원본 호출에는 항상 AbortSignal 이 있어야 한다`);
    if (sig.aborted) reject(sig.reason);
    else sig.addEventListener('abort', () => reject(sig.reason), { once: true });
  });
};

test('(j) 타임아웃: A2A message/send · SSO 위임 · aindrive MCP list_files 가 제때 답하지 않으면 temporary_failure(재시도 가능) + *_timeout', async () => {
  const s = stack();
  const t0 = Date.now();
  await assert.rejects(() => invokeSharedAgent(opts(hangs(s.f, '/agents/doc-summary') as ReturnType<typeof fakeFetch>, { a2a: { timeoutMs: 20 } }), request),
    (e: AinContractError) => e.code === 'temporary_failure' && e.retryable && e.detail === 'agent_timeout' && e.status === 503);
  await assert.rejects(() => invokeSharedAgent(opts(hangs(s.f, '/api/delegations/resource') as ReturnType<typeof fakeFetch>, { sso: { issuer: SSO, clientId: 'c', clientSecret: 's', connectUrl: `${SSO}/`, timeoutMs: 20 } }), request),
    (e: AinContractError) => e.code === 'temporary_failure' && e.retryable && e.detail === 'ain_sso_timeout');
  // MCP list_files 는 resolveFiles 가 폴더를 훑을 때 불린다(목록에 없는 fileKey → 뿌리 탐색).
  const { listFolderEntries } = await import('./files');
  await assert.rejects(() => listFolderEntries({ aindriveUrl: AINDRIVE, token: 'aind_aat_secret', fetch: hangs(s.f, `/mcp/d/${DRIVE}`), timeoutMs: 20 }, DRIVE, '/'),
    (e: AinContractError) => e.code === 'temporary_failure' && e.retryable && e.detail === 'aindrive_mcp_timeout');
  assert.ok(Date.now() - t0 < 5_000, '짧은 timeoutMs 가 실제로 적용된다');
  assert.equal(s.a2aBodies.length, 0);
  // 정상 호출에도 A2A 요청에 signal 이 실린다(기본 타임아웃).
  await invokeSharedAgent(opts(s.f), request);
  const a2aCall = s.f.calls.find((c) => c.url.endsWith('/agents/doc-summary'));
  assert.ok(a2aCall?.init?.signal instanceof AbortSignal);
});

test('(e) 세션 증명 없음 → auth_required + actionUrl(AIN SSO 연결); 다른 토큰을 대신 보내지 않는다', async () => {
  const s = stack();
  await assert.rejects(() => invokeSharedAgent(opts(s.f, { getSessionProof: async () => null }), request), (e: AinContractError) => e.code === 'auth_required' && e.actionUrl === `${SSO}/`);
  // SSO 클라이언트가 설정되지 않은 배포는 사용자 문제(auth_required)가 아니라 배포 문제(temporary_failure)로 — 증명 유무와 무관하게, 증명 조회보다 먼저.
  let proofAsked = false;
  await assert.rejects(() => invokeSharedAgent(opts(s.f, { sso: null, getSessionProof: async () => { proofAsked = true; return null; } }), request), (e: AinContractError) => e.code === 'temporary_failure' && e.detail === 'ain_sso_client_missing' && e.retryable === false);
  assert.equal(proofAsked, false);
  await assert.rejects(() => invokeSharedAgent(opts(s.f, { sso: null }), request), (e: AinContractError) => e.code === 'temporary_failure' && e.detail === 'ain_sso_client_missing');
  assert.equal(s.ssoBodies.length, 0);
  assert.equal(s.a2aBodies.length, 0);
  // SSO 가 증명을 거절하면 auth_required
  await assert.rejects(() => invokeSharedAgent(opts(s.f, { getSessionProof: async () => 'eyJ.not-an-id-token.x' }), request), (e: AinContractError) => e.code === 'auth_required');
  assert.equal(s.a2aBodies.length, 0);
});

test('(f) 비활성 에이전트 → agent_stopped; 목록에 없는 에이전트 → resource_deleted', async () => {
  const s = stack({ agents: [agentRef({ status: 'disabled' })] });
  await assert.rejects(() => invokeSharedAgent(opts(s.f), request), (e: AinContractError) => e.code === 'agent_stopped');
  await assert.rejects(() => invokeSharedAgent(opts(s.f), { ...request, agentKey: `${AINIZE}#nope` }), (e: AinContractError) => e.code === 'resource_deleted');
  assert.equal(s.a2aBodies.length, 0);
});

test('파일: 목록·폴더 탐색에서 못 찾으면 forbidden, 하위 폴더는 너비 우선으로 찾는다, 파일 없는 호출은 위임 없이 간다', async () => {
  const s = stack();
  await assert.rejects(() => invokeSharedAgent(opts(s.f), { ...request, fileKeys: [`${AINDRIVE}#${DRIVE}#p1:00000000000000000000000000000000`] }), (e: AinContractError) => e.code === 'forbidden');
  const deep = await invokeSharedAgent(opts(s.f), { ...request, fileKeys: [`${AINDRIVE}#${DRIVE}#${aindriveFileId(DRIVE, '/sub/deep.md')}`] });
  assert.deepEqual(deep.task.sources[0].file.legacy, { path: '/sub/deep.md' });
  const none = await invokeSharedAgent(opts(s.f), { ...request, fileKeys: [] });
  assert.deepEqual(s.a2aBodies.at(-1)!.params.message.parts.map((p) => p.metadata?.type ?? p.kind), ['text']);
  assert.deepEqual(none.task.sources, []);
  // aindrive 토큰 없음 + 파일 있음 → auth_required(aindrive 연결)
  await assert.rejects(() => invokeSharedAgent(opts(s.f, { aindriveToken: null }), request), (e: AinContractError) => e.code === 'auth_required' && e.actionUrl === `${AINDRIVE}/oauth/authorize`);
});

test('A2A: failed 상태는 error 를 싣고, JSON-RPC error 는 temporary_failure, message 결과도 받는다', async () => {
  const failed = stack({ agentReply: (b) => ({ jsonrpc: '2.0', id: b.id, result: { id: 't-f', status: { state: 'failed', message: { parts: [{ kind: 'text', text: '읽을 수 없음' }] } } } }) });
  const r = await invokeSharedAgent(opts(failed.f), request);
  assert.equal(r.task.status, 'failed');
  assert.equal(r.task.error?.code, 'temporary_failure');
  assert.equal(r.text, '읽을 수 없음');
  // JSON-RPC error.message 는 에이전트가 만든 문자열: 토큰을 되돌려 말해도 응답 바디(detail·message)에 실리지 않는다.
  const err = stack({ agentReply: (b) => ({ jsonrpc: '2.0', id: b.id, error: { code: -32000, message: `boom ${DELEGATION_TOKEN}` } }) });
  await assert.rejects(() => invokeSharedAgent(opts(err.f), request), (e: AinContractError) => {
    const body = JSON.stringify(e.toBody());
    return e.code === 'temporary_failure' && e.retryable && e.status === 503 && e.detail === 'agent_rpc_error' && !body.includes(DELEGATION_TOKEN) && !body.includes('boom') && !e.message.includes(DELEGATION_TOKEN);
  });
  const msg = stack({ agentReply: (b) => ({ jsonrpc: '2.0', id: b.id, result: { kind: 'message', messageId: 'm-1', parts: [{ kind: 'text', text: '바로 답' }] } }) });
  const m = await invokeSharedAgent(opts(msg.f), request);
  assert.equal(m.task.status, 'completed');
  assert.equal(m.task.taskId, 'm-1');
  assert.equal(m.text, '바로 답');
  assert.equal(textOfTask({ id: 'x', status: { state: 'completed' }, history: [{ role: 'user', parts: [{ kind: 'text', text: 'q' }] }, { role: 'agent', parts: [{ kind: 'text', text: 'h' }] }] }), 'h');
});

test('buildA2aMessage: 위임이 없으면 part 2개, 파일도 없으면 1개', () => {
  const scope = { account: 'a', org: 'org_1', product: 'ainspace' as const, room: 'r', conversation: 'c' };
  assert.equal(buildA2aMessage({ text: 't', files: [rootFolder], scope, idempotencyKey: 'k' }).parts.length, 2);
  assert.equal(buildA2aMessage({ text: 't', files: [], scope, idempotencyKey: 'k' }).contextId, 'ctx:a:org_1:ainspace:r:c');
});

test('requestDelegation: reused 응답(토큰 없음)은 unsupported_input, invalid_client 는 auth_required', async () => {
  const f = fakeFetch({ '/api/delegations/resource': () => jsonResponse({ jti: 'rdlg_1', expiresAt: '2026-09-29T06:15:00Z', reused: true }, 200) });
  const file = { ...rootFolder, kind: 'file' as const, fileId: FILE_ID, legacy: { path: FILE_PATH } };
  await assert.rejects(() => requestDelegation({ issuer: SSO, clientId: 'c', clientSecret: 's', fetch: f }, { sessionProof: SESSION_PROOF, agent: agentRef(), files: [file], idempotencyKey: 'k' }), (e: AinContractError) => e.code === 'unsupported_input');
  const s = stack({ ssoRejects: 'client' });
  await assert.rejects(() => invokeSharedAgent(opts(s.f), request), (e: AinContractError) => e.code === 'auth_required');
});

test('parseInvokeBody: 모양 검증', () => {
  assert.equal(parseInvokeBody(null).ok, false);
  assert.equal(parseInvokeBody({ agentKey: 'nohash', text: 't', conversation: 'c' }).ok, false);
  assert.equal(parseInvokeBody({ agentKey: AGENT_KEY, text: '   ', conversation: 'c' }).ok, false);
  assert.equal(parseInvokeBody({ agentKey: AGENT_KEY, text: 't', conversation: 'has space' }).ok, false);
  assert.equal(parseInvokeBody({ agentKey: AGENT_KEY, text: 't', conversation: 'c', fileKeys: ['bad'] }).ok, false);
  assert.equal(parseInvokeBody({ agentKey: AGENT_KEY, text: 't', conversation: 'c', room: 'a/b' }).ok, false);
  const ok = parseInvokeBody({ agentKey: AGENT_KEY, text: 't', conversation: 'c', fileKeys: [FILE_KEY, FILE_KEY], room: 'village-1' });
  assert.ok(ok.ok);
  assert.deepEqual(ok.req, { agentKey: AGENT_KEY, text: 't', fileKeys: [FILE_KEY], conversation: 'c', room: 'village-1' });
  const noFiles = parseInvokeBody({ agentKey: AGENT_KEY, text: 't', conversation: 'c' });
  assert.ok(noFiles.ok && noFiles.req.fileKeys.length === 0);
});

test('20.1 C: requestId(차례 id) — 모양 검증, 있을 때만 idempotencyKey 에 들어간다(없으면 예전 키 그대로)', () => {
  const base = { agentKey: AGENT_KEY, text: 't', conversation: 'c' };
  for (const bad of ['', 'has space', 'a/b', 'x'.repeat(129), 42, {}]) assert.equal(parseInvokeBody({ ...base, requestId: bad }).ok, false, String(bad));
  const ok = parseInvokeBody({ ...base, requestId: 'turn_0b1c-2d:3.e_f' });
  assert.ok(ok.ok && ok.req.requestId === 'turn_0b1c-2d:3.e_f');
  const none = parseInvokeBody({ ...base, requestId: null });
  assert.ok(none.ok && !('requestId' in none.req));

  const k = { account: 'u', agentKey: 'a#b', fileKeys: ['k'], text: 't', conversation: 'c', room: 'r' };
  assert.equal(deriveIdempotencyKey({ ...k, requestId: undefined }), deriveIdempotencyKey(k));
  assert.equal(deriveIdempotencyKey({ ...k, requestId: 'turn_1' }), deriveIdempotencyKey({ ...k, requestId: 'turn_1' }), '같은 차례의 재시도 = 같은 키');
  assert.notEqual(deriveIdempotencyKey({ ...k, requestId: 'turn_1' }), deriveIdempotencyKey({ ...k, requestId: 'turn_2' }), '다음 차례의 같은 질문 = 다른 키');
  assert.notEqual(deriveIdempotencyKey({ ...k, requestId: 'turn_1' }), deriveIdempotencyKey(k));
});
