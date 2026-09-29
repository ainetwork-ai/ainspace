/**
 * AIN 통합 어댑터 라이브 점검 — 실제 aindrive / Ainize 노드에 제품의 어댑터를 그대로 붙여 본다.
 *
 * 실행:
 *   AINDRIVE_TOKEN_FILE=/path/to/bob-aat npx tsx scripts/ain-integration-live-check.ts
 *
 * env (모두 선택, 기본은 로컬 스택):
 *   AINDRIVE_URL            (기본 http://127.0.0.1:3737)
 *   AINIZE_URL              (기본 http://127.0.0.1:3499)
 *   AINDRIVE_TOKEN_FILE     aindrive 계정 토큰(aind_aat_…)이 든 파일. 없으면 AINDRIVE_ACCOUNT_TOKEN 을 그대로 쓴다.
 *   EXPECT_FILE_KEY         shared_with_me 목록에 있어야 할 fileKey  (issuer#driveId#fileId)
 *   EXPECT_AGENT_KEY        public 목록에 있어야 할 agentKey        (registryIssuer#agentId)
 *   SKIP_ROUTE_CHECK=1      라우트 핸들러 in-process 호출을 건너뛴다
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
import { findSecretKey } from '../src/lib/ain-integration/http';
import { agentKey, fileKey, type AgentListResponse, type FileListResponse } from '../src/lib/ain-integration/types';

const stripSlash = (u: string) => u.replace(/\/+$/, '');
const AINDRIVE_URL = stripSlash(process.env.AINDRIVE_URL?.trim() || 'http://127.0.0.1:3737');
const AINIZE_URL = stripSlash(process.env.AINIZE_URL?.trim() || 'http://127.0.0.1:3499');
const EXPECT_FILE_KEY = process.env.EXPECT_FILE_KEY?.trim()
  || 'http://127.0.0.1:3737#TOIUVmRbXUWS#p1:7f37e4c34c7cd17b2e4047679025957a';
const EXPECT_AGENT_KEY = process.env.EXPECT_AGENT_KEY?.trim() || 'http://127.0.0.1:3499#doc-summary';

function loadToken(): string {
  const file = process.env.AINDRIVE_TOKEN_FILE?.trim();
  const token = file ? readFileSync(file, 'utf8').trim() : (process.env.AINDRIVE_ACCOUNT_TOKEN?.trim() ?? '');
  if (!token) throw new Error('aindrive token missing: set AINDRIVE_TOKEN_FILE or AINDRIVE_ACCOUNT_TOKEN');
  if (!token.startsWith('aind_aat_')) throw new Error('aindrive token has unexpected prefix (expected aind_aat_)');
  return token;
}

const failures: string[] = [];
const fail = (msg: string) => { failures.push(msg); console.log(`  FAIL ${msg}`); };
const ok = (msg: string) => console.log(`  ok   ${msg}`);
const check = (cond: boolean, msg: string) => (cond ? ok(msg) : fail(msg));

/** 오류 메시지에 토큰이 섞여도 밖으로 나가지 않게. */
const redact = (token: string, e: unknown) => {
  const s = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return s.split(token).join('[redacted]');
};

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
  summary.ok = failures.length === 0;
  summary.failures = failures;

  console.log('\nSUMMARY ' + JSON.stringify(summary));
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((e) => { console.error('live check crashed:', e instanceof Error ? e.message : e); process.exitCode = 1; });
