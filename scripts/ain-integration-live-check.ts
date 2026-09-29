/**
 * AIN 통합 어댑터 라이브 점검 — 실제 aindrive / Ainize 노드에 제품의 어댑터를 그대로 붙여 본다.
 *
 * 실행:
 *   AINDRIVE_TOKEN_FILE=/path/to/bob-aat npx tsx scripts/ain-integration-live-check.ts [--invoke] [--events]
 *
 * env (모두 선택, 기본은 로컬 스택):
 *   AINDRIVE_URL            (기본 http://127.0.0.1:3737)
 *   AINIZE_URL              (기본 http://127.0.0.1:3499)
 *   AINDRIVE_TOKEN_FILE     aindrive 계정 토큰(aind_aat_…)이 든 파일. 없으면 AINDRIVE_ACCOUNT_TOKEN 을 그대로 쓴다.
 *   EXPECT_FILE_KEY         shared_with_me 목록에 있어야 할 fileKey  (issuer#driveId#fileId)
 *   EXPECT_AGENT_KEY        public 목록에 있어야 할 agentKey        (registryIssuer#agentId)
 *   SKIP_ROUTE_CHECK=1      라우트 핸들러 in-process 호출을 건너뛴다
 *
 * --invoke (2단계, adapter-invoke-spec §라이브 체크):
 *   AIN_LIVE_SESSION_PROOF_FILE  사용자 B 의 AIN SSO ID 토큰(세션 증명)이 든 파일 (필수)
 *   AIN_SSO_ISSUER               (기본 http://127.0.0.1:3910)
 *   AIN_SSO_CLIENT_FILE          1행 client_id, 2행 client_secret 인 파일 — 또는 AIN_SSO_CLIENT_ID / AIN_SSO_CLIENT_SECRET
 *   EXPECT_INVOKE_FILE_KEY       에이전트에게 넘길 fileKey (기본 …#TOIUVmRbXUWS#p1:9a6888… = 전시 안내.md)
 *   INVOKE_TEXT                  (기본 "이 문서를 두 줄로 요약하고 Sources를 남겨줘")
 *   기대: task.status==='completed', 답변에 "Sources" 와 파일의 사실("김작가" 또는 "12점"), 두 번째 호출은 같은 taskId,
 *         라우트(/api/ain/invoke)도 같은 taskId. 토큰(세션 증명·위임·계정)은 응답·출력 어디에도 없다.
 * --events: /api/ain/events?source=aindrive|ainize 를 어댑터와 라우트로 불러 이벤트 수를 찍는다.
 *
 * 1) 순수 어댑터(`lib/ain-integration/{files,agents}`)를 fetch=globalThis.fetch 로 직접 호출한다.
 * 2) `/api/ain/shared-files`, `/api/ain/shared-agents` 라우트 핸들러를 가짜 세션으로 in-process 호출한다
 *    (AIN_INTEGRATION_ENABLED=1, 토큰은 AINDRIVE_ACCOUNT_TOKEN env 로 — 이 프로세스 안에서만 설정).
 *    세션 JWT 는 `sub` 없이 만들어 Redis 조회를 건너뛰고 env 토큰 경로만 탄다.
 *
 * 토큰은 출력·오류 메시지에 절대 싣지 않는다. 불일치가 있으면 종료 코드 1.
 */
import { readFileSync } from 'node:fs';
import { listSharedFiles } from '../src/lib/ain-integration/files';
import { listSharedAgents } from '../src/lib/ain-integration/agents';
import { fetchEvents } from '../src/lib/ain-integration/events';
import { findSecretKey } from '../src/lib/ain-integration/http';
import { invokeSharedAgent, type InvokeResult } from '../src/lib/ain-integration/invoke';
import { agentKey, fileKey, isEventPage, isTaskRef, type AgentListResponse, type EventPage, type FileListResponse } from '../src/lib/ain-integration/types';

const ARGS = new Set(process.argv.slice(2));
const DO_INVOKE = ARGS.has('--invoke');
const DO_EVENTS = ARGS.has('--events');

const stripSlash = (u: string) => u.replace(/\/+$/, '');
const AINDRIVE_URL = stripSlash(process.env.AINDRIVE_URL?.trim() || 'http://127.0.0.1:3737');
const AINIZE_URL = stripSlash(process.env.AINIZE_URL?.trim() || 'http://127.0.0.1:3499');
const EXPECT_FILE_KEY = process.env.EXPECT_FILE_KEY?.trim()
  || 'http://127.0.0.1:3737#TOIUVmRbXUWS#p1:7f37e4c34c7cd17b2e4047679025957a';
const EXPECT_AGENT_KEY = process.env.EXPECT_AGENT_KEY?.trim() || 'http://127.0.0.1:3499#doc-summary';
const EXPECT_INVOKE_FILE_KEY = process.env.EXPECT_INVOKE_FILE_KEY?.trim()
  || 'http://127.0.0.1:3737#TOIUVmRbXUWS#p1:9a6888b347a36e18ab4e8f8bdf11f22e';
const INVOKE_TEXT = process.env.INVOKE_TEXT?.trim() || '이 문서를 두 줄로 요약하고 Sources를 남겨줘';
const AIN_SSO_ISSUER = stripSlash(process.env.AIN_SSO_ISSUER?.trim() || 'http://127.0.0.1:3910');

function loadToken(): string {
  const file = process.env.AINDRIVE_TOKEN_FILE?.trim();
  const token = file ? readFileSync(file, 'utf8').trim() : (process.env.AINDRIVE_ACCOUNT_TOKEN?.trim() ?? '');
  if (!token) throw new Error('aindrive token missing: set AINDRIVE_TOKEN_FILE or AINDRIVE_ACCOUNT_TOKEN');
  if (!token.startsWith('aind_aat_')) throw new Error('aindrive token has unexpected prefix (expected aind_aat_)');
  return token;
}

/** --invoke 의 비밀들. 파일에서만 읽고 값은 절대 출력하지 않는다. */
function loadInvokeSecrets(): { sessionProof: string; clientId: string; clientSecret: string; sessionProofFile: string } {
  const sessionProofFile = process.env.AIN_LIVE_SESSION_PROOF_FILE?.trim();
  if (!sessionProofFile) throw new Error('--invoke needs AIN_LIVE_SESSION_PROOF_FILE (user B AIN SSO ID token file)');
  const sessionProof = readFileSync(sessionProofFile, 'utf8').trim();
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(sessionProof)) throw new Error('session proof file does not hold a JWT');
  let clientId = process.env.AIN_SSO_CLIENT_ID?.trim() ?? '';
  let clientSecret = process.env.AIN_SSO_CLIENT_SECRET?.trim() ?? '';
  const clientFile = process.env.AIN_SSO_CLIENT_FILE?.trim();
  if (clientFile) {
    const [id, secret] = readFileSync(clientFile, 'utf8').split(/\r?\n/).map((l) => l.trim());
    clientId = clientId || id || ''; clientSecret = clientSecret || secret || '';
  }
  if (!clientId || !clientSecret) throw new Error('--invoke needs AIN_SSO_CLIENT_FILE or AIN_SSO_CLIENT_ID + AIN_SSO_CLIENT_SECRET');
  return { sessionProof, clientId, clientSecret, sessionProofFile };
}

const failures: string[] = [];
const fail = (msg: string) => { failures.push(msg); console.log(`  FAIL ${msg}`); };
const ok = (msg: string) => console.log(`  ok   ${msg}`);
const check = (cond: boolean, msg: string) => (cond ? ok(msg) : fail(msg));

/** 오류 메시지에 토큰이 섞여도 밖으로 나가지 않게. */
const SECRETS: string[] = [];
const redact = (token: string, e: unknown) => {
  const s = e instanceof Error ? `${e.name}: ${e.message}${(e as { code?: string }).code ? ` (${(e as { code?: string }).code})` : ''}` : String(e);
  return [token, ...SECRETS].reduce((acc, t) => (t ? acc.split(t).join('[redacted]') : acc), s);
};
const leaks = (v: unknown): boolean => { const s = JSON.stringify(v) ?? ''; return SECRETS.some((t) => t && s.includes(t)); };

const isP256Jwk = (v: unknown): boolean =>
  !!v && typeof v === 'object' && (v as { kty?: unknown }).kty === 'EC' && (v as { crv?: unknown }).crv === 'P-256'
  && typeof (v as { x?: unknown }).x === 'string' && typeof (v as { y?: unknown }).y === 'string';

function checkFiles(label: string, res: FileListResponse): string[] {
  const keys = res.items.map((i) => fileKey(i.ref));
  console.log(`  ${label} fileKeys (${keys.length}):`, keys);
  const hit = res.items.find((i) => fileKey(i.ref) === EXPECT_FILE_KEY);
  check(!!hit, `${label}: contains ${EXPECT_FILE_KEY}`);
  if (hit) {
    check(hit.role === 'viewer', `${label}: role=viewer (got ${hit.role})`);
    check(hit.ref.availability.state === 'online', `${label}: availability=online (got ${hit.ref.availability.state})`);
    check(hit.ref.kind === 'folder', `${label}: kind=folder (got ${hit.ref.kind})`);
  }
  check(findSecretKey(res) === null, `${label}: no secret-looking keys in response`);
  return keys;
}

function checkAgents(label: string, res: AgentListResponse): { keys: string[]; popJwkPresent: boolean } {
  const keys = res.items.map((i) => agentKey(i.ref));
  console.log(`  ${label} agentKeys (${keys.length}):`, keys);
  const hit = res.items.find((i) => agentKey(i.ref) === EXPECT_AGENT_KEY);
  check(!!hit, `${label}: contains ${EXPECT_AGENT_KEY}`);
  const popJwk = hit ? (hit.ref as unknown as { popJwk?: unknown }).popJwk : undefined;
  const popJwkPresent = isP256Jwk(popJwk);
  console.log(`  ${label} popJwk present:`, popJwkPresent, popJwk ? `(kty=${(popJwk as { kty?: string }).kty}, crv=${(popJwk as { crv?: string }).crv}, kid=${(popJwk as { kid?: string }).kid ?? '-'})` : '');
  check(popJwkPresent, `${label}: popJwk is an EC P-256 JWK`);
  if (hit) check(hit.canInvoke === true && hit.ref.status === 'active', `${label}: agent active / canInvoke`);
  check(findSecretKey(res) === null, `${label}: no secret-looking keys in response`);
  return { keys, popJwkPresent };
}

async function main() {
  const token = loadToken();
  const summary: Record<string, unknown> = { aindriveUrl: AINDRIVE_URL, ainizeUrl: AINIZE_URL };

  // ---------------------------------------------------------------- 1. 순수 어댑터 직접 호출
  console.log(`\n[1] adapter: listSharedFiles(scope=shared_with_me) @ ${AINDRIVE_URL}`);
  try {
    const res = await listSharedFiles({ aindriveUrl: AINDRIVE_URL, token, fetch: globalThis.fetch }, { scope: 'shared_with_me', limit: 50 });
    summary.fileKeys = checkFiles('adapter', res);
  } catch (e) { fail(`adapter listSharedFiles threw: ${redact(token, e)}`); }

  console.log(`\n[1] adapter: listSharedAgents(scope=public) @ ${AINIZE_URL}`);
  try {
    const res = await listSharedAgents({ ainizeUrl: AINIZE_URL, sessionToken: null, fetch: globalThis.fetch }, { scope: 'public', limit: 50 });
    const r = checkAgents('adapter', res);
    summary.agentKeys = r.keys; summary.popJwkPresent = r.popJwkPresent;
  } catch (e) { fail(`adapter listSharedAgents threw: ${redact(token, e)}`); }

  // ---------------------------------------------------------------- 2. 라우트 핸들러 in-process
  let routeChecked = false;
  if (process.env.SKIP_ROUTE_CHECK === '1') {
    console.log('\n[2] route check skipped (SKIP_ROUTE_CHECK=1)');
  } else {
    console.log('\n[2] routes in-process: GET /api/ain/shared-files, /api/ain/shared-agents');
    process.env.AIN_INTEGRATION_ENABLED = '1';
    process.env.AINDRIVE_ACCOUNT_TOKEN = token;      // 이 프로세스 안에서만
    process.env.AINDRIVE_URL = AINDRIVE_URL;
    process.env.AINIZE_URL = AINIZE_URL;
    try {
      const { NextRequest } = await import('next/server');
      const files = await import('../src/app/api/ain/shared-files/route');
      const agents = await import('../src/app/api/ain/shared-agents/route');
      // sub 없는 JWT 모양 → decodeUserId=null → Redis 를 건너뛰고 env 토큰만 쓴다.
      const session = `h.${Buffer.from('{}').toString('base64url')}.s`;
      const req = (path: string) => new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${session}` } });

      const fr = await files.GET(req('/api/ain/shared-files?scope=shared_with_me&limit=50'));
      const fb = await fr.json();
      check(fr.status === 200, `route shared-files: status 200 (got ${fr.status}${fr.status !== 200 ? ` ${JSON.stringify(fb)}` : ''})`);
      check(fr.headers.get('cache-control') === 'private, no-store', 'route shared-files: cache-control private, no-store');
      if (fr.status === 200) {
        const keys = checkFiles('route', fb as FileListResponse);
        check(JSON.stringify(keys) === JSON.stringify(summary.fileKeys), 'route shared-files: same fileKeys as adapter');
      }
      check(!JSON.stringify(fb).includes(token), 'route shared-files: token not in body');

      const ar = await agents.GET(req('/api/ain/shared-agents?scope=public&limit=50'));
      const ab = await ar.json();
      check(ar.status === 200, `route shared-agents: status 200 (got ${ar.status}${ar.status !== 200 ? ` ${JSON.stringify(ab)}` : ''})`);
      if (ar.status === 200) {
        const r = checkAgents('route', ab as AgentListResponse);
        check(JSON.stringify(r.keys) === JSON.stringify(summary.agentKeys), 'route shared-agents: same agentKeys as adapter');
        check(r.popJwkPresent === summary.popJwkPresent, 'route shared-agents: popJwk survives okResponse/stripSecretKeys');
      }
      check(!JSON.stringify(ab).includes(session), 'route shared-agents: session token not in body');
      routeChecked = true;
    } catch (e) { fail(`route check threw: ${redact(token, e)}`); }
  }
  summary.routeChecked = routeChecked;

  // ---------------------------------------------------------------- 3. --invoke: 파일을 넘겨 공유 에이전트 호출
  if (DO_INVOKE) {
    console.log(`\n[3] invoke: ${EXPECT_AGENT_KEY} with ${EXPECT_INVOKE_FILE_KEY} via SSO ${AIN_SSO_ISSUER}`);
    try {
      const secrets = loadInvokeSecrets();
      SECRETS.push(secrets.sessionProof, secrets.clientSecret);
      const checkInvoke = (label: string, r: InvokeResult) => {
        const t = r.task;
        console.log(`  ${label} task=${t.taskId} status=${t.status} contextId=${t.contextId} sources=${t.sources.length}`);
        console.log(`  ${label} text (${r.text.length} chars): ${r.text.replace(/\s+/g, ' ').slice(0, 300)}`);
        check(isTaskRef(t), `${label}: task is a contract TaskRef`);
        check(t.status === 'completed', `${label}: task.status completed (got ${t.status})`);
        check(t.agent === EXPECT_AGENT_KEY, `${label}: task.agent = ${EXPECT_AGENT_KEY}`);
        check(t.sources.length === 1 && fileKey(t.sources[0].file) === EXPECT_INVOKE_FILE_KEY, `${label}: sources[0] is the file`);
        check(/Sources/.test(r.text), `${label}: text contains "Sources"`);
        check(/김작가|12점/.test(r.text), `${label}: text contains a fact from the file (김작가 | 12점)`);
        check(!leaks(r) && findSecretKey(r) === null, `${label}: no session proof / client secret / secret keys in result`);
        check(!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(JSON.stringify(r)), `${label}: no JWT-looking string in result`);
      };
      // 라우트가 쓰는 것과 같은 scope(세션 JWT 에 sub 가 없으므로 account=anonymous) → 세 호출의 messageId 가 같다.
      const scope = { account: 'anonymous', org: null, product: 'ainspace' as const };
      const opts = {
        aindriveUrl: AINDRIVE_URL, ainizeUrl: AINIZE_URL, aindriveToken: token,
        sso: { issuer: AIN_SSO_ISSUER, clientId: secrets.clientId, clientSecret: secrets.clientSecret, connectUrl: `${AIN_SSO_ISSUER}/` },
        getSessionProof: async () => secrets.sessionProof, scope, fetch: globalThis.fetch,
      };
      const req = { agentKey: EXPECT_AGENT_KEY, text: INVOKE_TEXT, fileKeys: [EXPECT_INVOKE_FILE_KEY], conversation: 'live-check' };
      const first = await invokeSharedAgent(opts, req);
      checkInvoke('adapter#1', first);
      const second = await invokeSharedAgent(opts, req);
      check(second.task.taskId === first.task.taskId, `adapter#2: same taskId on retry (${second.task.taskId})`);
      check(second.task.idempotencyKey === first.task.idempotencyKey, 'adapter#2: same idempotencyKey');
      summary.invokeTaskId = first.task.taskId; summary.invokeStatus = first.task.status; summary.invokeTextLength = first.text.length;

      if (process.env.SKIP_ROUTE_CHECK !== '1') {
        process.env.AIN_INTEGRATION_ENABLED = '1';
        process.env.AINDRIVE_ACCOUNT_TOKEN = token;
        process.env.AINDRIVE_URL = AINDRIVE_URL; process.env.AINIZE_URL = AINIZE_URL;
        process.env.AIN_SSO_ISSUER = AIN_SSO_ISSUER;
        process.env.AIN_SSO_CLIENT_ID = secrets.clientId; process.env.AIN_SSO_CLIENT_SECRET = secrets.clientSecret;
        process.env.AIN_SESSION_PROOF_FILE = secrets.sessionProofFile;   // dev-only fallback 경로(이 프로세스 안에서만)
        const { NextRequest } = await import('next/server');
        const invoke = await import('../src/app/api/ain/invoke/route');
        const session = `h.${Buffer.from('{}').toString('base64url')}.s`;
        const res = await invoke.POST(new NextRequest('http://localhost/api/ain/invoke', { method: 'POST', headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json' }, body: JSON.stringify(req) }));
        const body = await res.json();
        check(res.status === 200, `route invoke: status 200 (got ${res.status}${res.status !== 200 ? ` ${JSON.stringify(body)}` : ''})`);
        check(res.headers.get('cache-control') === 'private, no-store', 'route invoke: cache-control private, no-store');
        if (res.status === 200) {
          checkInvoke('route', body as InvokeResult);
          check((body as InvokeResult).task.taskId === first.task.taskId, 'route invoke: same taskId as adapter (same idempotencyKey)');
        }
        check(!JSON.stringify(body).includes(session) && !JSON.stringify(body).includes(token), 'route invoke: no session/aindrive token in body');
        summary.invokeRouteStatus = res.status;
      }
    } catch (e) { fail(`invoke threw: ${redact(token, e)}`); }
  }

  // ---------------------------------------------------------------- 4. --events: 변경 이벤트 피드
  if (DO_EVENTS) {
    console.log('\n[4] events: aindrive /api/oauth/events, ainize /api/shared-agents/events');
    const counts: Record<string, unknown> = {};
    try {
      const a = await fetchEvents({ source: 'aindrive', baseUrl: AINDRIVE_URL, token, fetch: globalThis.fetch }, null);
      console.log(`  adapter aindrive: ${a.events.length} event(s), nextCursor=${a.nextCursor}, gap=${a.gap}, types=${[...new Set(a.events.map((e) => e.type))].join(',')}`);
      check(isEventPage(a), 'adapter aindrive: contract event-page');
      check(!JSON.stringify(a).includes(token), 'adapter aindrive: token not in page');
      counts.adapterAindrive = a.events.length;
      const z = await fetchEvents({ source: 'ainize', baseUrl: AINIZE_URL, token: null, fetch: globalThis.fetch }, null);
      console.log(`  adapter ainize: ${z.events.length} event(s), nextCursor=${z.nextCursor}, gap=${z.gap}`);
      check(isEventPage(z), 'adapter ainize: contract event-page');
      counts.adapterAinize = z.events.length;
    } catch (e) { fail(`events adapter threw: ${redact(token, e)}`); }
    if (process.env.SKIP_ROUTE_CHECK !== '1') {
      try {
        process.env.AIN_INTEGRATION_ENABLED = '1';
        process.env.AINDRIVE_ACCOUNT_TOKEN = token;
        process.env.AINDRIVE_URL = AINDRIVE_URL; process.env.AINIZE_URL = AINIZE_URL;
        const { NextRequest } = await import('next/server');
        const events = await import('../src/app/api/ain/events/route');
        const session = `h.${Buffer.from('{}').toString('base64url')}.s`;
        for (const source of ['aindrive', 'ainize'] as const) {
          const res = await events.GET(new NextRequest(`http://localhost/api/ain/events?source=${source}`, { headers: { authorization: `Bearer ${session}` } }));
          const body = (await res.json()) as EventPage;
          check(res.status === 200, `route events ${source}: status 200 (got ${res.status}${res.status !== 200 ? ` ${JSON.stringify(body)}` : ''})`);
          if (res.status === 200) {
            console.log(`  route ${source}: ${body.events.length} event(s), nextCursor=${body.nextCursor}, gap=${body.gap}`);
            check(isEventPage(body), `route events ${source}: contract event-page`);
            check(findSecretKey(body) === null && !JSON.stringify(body).includes(token), `route events ${source}: no secrets in body`);
            counts[`route_${source}`] = body.events.length;
          }
        }
      } catch (e) { fail(`events route threw: ${redact(token, e)}`); }
    }
    summary.eventCounts = counts;
  }

  summary.ok = failures.length === 0;
  summary.failures = failures;

  console.log('\nSUMMARY ' + JSON.stringify(summary));
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((e) => { console.error('live check crashed:', e instanceof Error ? e.message : e); process.exitCode = 1; });
