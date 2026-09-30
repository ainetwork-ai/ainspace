/**
 * 사용자별 aindrive 계정 연결(OAuth 2.1 authorization code + PKCE) — 서버 전용.
 *
 * aindrive 는 계정 grant 용 OAuth 서버를 이미 운영한다(aindrive web/lib/oauth.ts·account-tokens.ts):
 *   `{AINDRIVE_URL}/oauth/authorize` (resource 없이 계정 스코프만) → code → `POST {AINDRIVE_URL}/api/oauth/token`
 *   → `aind_aat_…`(access) + `aind_art_…`(refresh, 매 갱신마다 회전). public client — client_secret 없음.
 * (토큰 엔드포인트는 AS 메타데이터의 `token_endpoint` = `/api/oauth/token` 이다. `/oauth/token` 은 없다.)
 *
 * 흐름
 *   1) 시작 `beginAindriveConnect`: state·PKCE verifier 를 만들고, state 레코드(사용자 id·verifier·redirect_uri·
 *      돌아갈 경로)를 **봉인해** KV 에 10분 둔다. 브라우저에는 state 를 HttpOnly 쿠키로 준다(라우트가).
 *   2) 콜백 `completeAindriveConnect`: 쿼리 state 가 쿠키의 state 와 같아야 하고(다른 브라우저로 넘긴 콜백 URL 거절),
 *      KV 레코드를 한 번만 꺼낸다(getDel). code 를 교환하고 토큰 쌍을 사용자별로 **봉인해** 저장한다.
 *   3) 사용 `getAindriveAccountToken`: 봉인을 열어 만료 60초 전까지는 access 를, 그 뒤에는 refresh 로 갱신해 새 쌍을
 *      저장하고 돌려준다. refresh 가 거절되면(invalid_grant) 연결을 지우고 null → 라우트가 `auth_required` + 연결 URL.
 *   4) 해제 `disconnectAindrive`: 사용자 레코드를 지운다.
 *
 * 저장: KV `ain:aindrive_account:<userId>` = seal(JSON{accessToken, refreshToken, expiresAt, scope, connectedAt}),
 * AES-256-GCM, 키 = HKDF(env `AINDRIVE_TOKEN_KEY`), AAD = 사용자 id. 키가 없으면 연결을 시작하지 않는다(평문 저장 없음).
 * 예전 평문 키 `ain:aindrive_token:<userId>` 는 더 읽지 않는다(연결을 다시 하면 된다).
 *
 * env `AINDRIVE_ACCOUNT_TOKEN`(배포 단위 토큰)은 **개발(NODE_ENV=development)에서만**, 그리고 사용자 레코드가
 * **아예 없을 때만** 쓴다. 운영에서는 쓰지 않는다 — 쓰면 "그 사용자의 aindrive 로 해석·저장" 이라는 경로가 조용히
 * 공용 계정으로 바뀐다. 레코드가 있는데 봉인을 못 열면(키 회전·변조) 어느 환경에서도 공용 토큰으로 물러서지 않고 null
 * (→ `auth_required`, 다시 연결).
 *
 * 토큰 값은 절대 로그·응답·오류 메시지에 싣지 않는다.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AINDRIVE_OAUTH_SCOPES, getAindriveOAuthClientId, getAindriveUrl } from './config';
import { UPSTREAM_TIMEOUT_MS, fetchUpstream, type FetchLike } from './http';
import { redisKv, type KvStore } from './kv';
import { deriveKey, getTokenKeyMaterial, seal, unseal } from './sealed';
import { AinContractError } from './types';

export const STATE_TTL_SEC = 600;
/** 만료 이만큼 전부터는 갱신한다(시계 차이·요청 시간). */
export const REFRESH_MARGIN_MS = 60_000;
/** 연결 레코드 보관 기한(refresh 토큰 수명과 비슷하게) — 쓰지 않는 연결이 영원히 남지 않게. */
export const CONNECTION_TTL_SEC = 86400 * 90;

const connectionKey = (userId: string) => `ain:aindrive_account:${userId}`;
const stateKey = (state: string) => `ain:aindrive_oauth_state:${createHash('sha256').update(state).digest('hex')}`;

export interface AindriveConnection {
  accessToken: string;
  refreshToken: string | null;
  /** epoch ms */
  expiresAt: number;
  scope: string;
  connectedAt: number;
}

export interface AindriveOAuthDeps {
  kv: KvStore;
  fetch?: FetchLike;
  now?: () => Date;
}

/** 라우트가 쓰는 기본 의존성 — 테스트가 kv·fetch·now 를 바꿔 끼운다(`deps.ts` 의 `aindriveConnectDeps`). */
export const defaultOAuthDeps: AindriveOAuthDeps = { kv: redisKv };

const nowMs = (d: AindriveOAuthDeps) => (d.now ?? (() => new Date()))().getTime();

function keys(): { conn: Buffer; state: Buffer } | null {
  const m = getTokenKeyMaterial();
  return m ? { conn: deriveKey(m, 'aindrive-account-token'), state: deriveKey(m, 'aindrive-oauth-state') } : null;
}

const notConfigured = (what: string) =>
  new AinContractError('temporary_failure', 'aindrive 계정 연결이 이 배포에 설정되어 있지 않습니다.', { retryable: false, detail: `aindrive_connect_${what}_missing` });

// ------------------------------------------------------------------------------- PKCE

export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
const randomToken = () => randomBytes(32).toString('base64url');

/** 돌아갈 경로: 같은 오리진의 절대 경로만(`/x`), `//host`·`/\\host`·스킴은 거절 → `/`. */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || raw.length > 512 || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || /[\u0000-\u001f]/.test(raw)) return '/';
  return raw;
}

// ------------------------------------------------------------------------------- store

type ConnectionRead = { state: 'none' } | { state: 'unreadable' } | { state: 'ok'; conn: AindriveConnection };

async function readConnectionState(userId: string, d: AindriveOAuthDeps): Promise<ConnectionRead> {
  const k = keys();
  const sealed = await d.kv.get(connectionKey(userId));
  if (!sealed) return { state: 'none' };
  if (!k) return { state: 'unreadable' };
  const json = unseal(k.conn, sealed, userId);
  if (!json) {
    console.error('aindrive connection record could not be opened (key rotated or tampered); treating as not connected');
    return { state: 'unreadable' };
  }
  try {
    const v = JSON.parse(json) as AindriveConnection;
    return typeof v.accessToken === 'string' && v.accessToken ? { state: 'ok', conn: v } : { state: 'unreadable' };
  } catch { return { state: 'unreadable' }; }
}

export async function readConnection(userId: string, d: AindriveOAuthDeps = defaultOAuthDeps): Promise<AindriveConnection | null> {
  const r = await readConnectionState(userId, d);
  return r.state === 'ok' ? r.conn : null;
}

export async function writeConnection(userId: string, conn: AindriveConnection, d: AindriveOAuthDeps = defaultOAuthDeps): Promise<void> {
  const k = keys();
  if (!k) throw notConfigured('token_key');
  await d.kv.set(connectionKey(userId), seal(k.conn, JSON.stringify(conn), userId), { ttlSec: CONNECTION_TTL_SEC });
}

export async function disconnectAindrive(userId: string, d: AindriveOAuthDeps = defaultOAuthDeps): Promise<void> {
  await d.kv.del(connectionKey(userId));
}

export async function isAindriveConnected(userId: string, d: AindriveOAuthDeps = defaultOAuthDeps): Promise<boolean> {
  return (await readConnection(userId, d)) !== null;
}

// ------------------------------------------------------------------------------- token endpoint

interface TokenResponse { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown; error?: unknown }

/**
 * `POST {aindrive}/api/oauth/token` (form). 성공이면 새 연결, `invalid_grant`/`invalid_client` 면 'rejected',
 * 그 밖(네트워크·5xx·이상한 응답)은 temporary_failure 를 던진다. 응답 본문은 로그에도 싣지 않는다.
 */
async function tokenRequest(aindriveUrl: string, params: Record<string, string>, d: AindriveOAuthDeps): Promise<AindriveConnection | 'rejected'> {
  const f = d.fetch ?? fetch;
  const res = await fetchUpstream(f, `${aindriveUrl.replace(/\/+$/, '')}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
    cache: 'no-store',
  }, { timeoutMs: UPSTREAM_TIMEOUT_MS, target: 'aindrive_oauth_token' });
  let body: TokenResponse | null = null;
  try { body = (await res.json()) as TokenResponse; } catch { body = null; }
  if (!res.ok) {
    const err = typeof body?.error === 'string' ? body.error : '';
    console.error(`aindrive token endpoint returned ${res.status}${err ? ` (${err.slice(0, 40)})` : ''}`);
    if (res.status === 400 || res.status === 401) {
      if (err === 'invalid_grant' || err === 'invalid_client' || res.status === 401) return 'rejected';
    }
    throw new AinContractError('temporary_failure', 'aindrive 연결을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.', { retryable: true, detail: 'aindrive_oauth_token_failed' });
  }
  const access = typeof body?.access_token === 'string' ? body.access_token : '';
  if (!access.startsWith('aind_aat_')) {
    // 계정 grant 가 아닌 토큰(드라이브 MCP 토큰 등)이나 빈 응답은 받지 않는다.
    throw new AinContractError('temporary_failure', 'aindrive 가 예상하지 못한 토큰을 돌려주었습니다.', { retryable: false, detail: 'aindrive_oauth_unexpected_token' });
  }
  const refresh = typeof body?.refresh_token === 'string' && body.refresh_token.startsWith('aind_art_') ? body.refresh_token : null;
  const expiresIn = typeof body?.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600;
  const now = nowMs(d);
  return { accessToken: access, refreshToken: refresh, expiresAt: now + expiresIn * 1000, scope: typeof body?.scope === 'string' ? body.scope : '', connectedAt: now };
}

// ------------------------------------------------------------------------------- connect flow

export interface BeginConnectInput { userId: string; aindriveUrl: string; clientId: string; redirectUri: string; returnTo?: string | null }
export interface BeginConnectResult { authorizeUrl: string; state: string }

interface StateRecord { userId: string; verifier: string; redirectUri: string; returnTo: string; createdAt: number }

export async function beginAindriveConnect(input: BeginConnectInput, d: AindriveOAuthDeps = defaultOAuthDeps): Promise<BeginConnectResult> {
  const k = keys();
  if (!k) throw notConfigured('token_key');
  const state = randomToken();
  const verifier = randomToken();
  const rec: StateRecord = { userId: input.userId, verifier, redirectUri: input.redirectUri, returnTo: safeReturnTo(input.returnTo), createdAt: nowMs(d) };
  await d.kv.set(stateKey(state), seal(k.state, JSON.stringify(rec), state), { ttlSec: STATE_TTL_SEC });
  const u = new URL(`${input.aindriveUrl.replace(/\/+$/, '')}/oauth/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', input.clientId);
  u.searchParams.set('redirect_uri', input.redirectUri);
  u.searchParams.set('scope', AINDRIVE_OAUTH_SCOPES);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', pkceChallenge(verifier));
  u.searchParams.set('code_challenge_method', 'S256');
  return { authorizeUrl: u.toString(), state };
}

export interface CompleteConnectInput {
  aindriveUrl: string;
  clientId: string;
  /** 쿼리의 state */
  state: string | null;
  /** 이 브라우저의 쿠키에 든 state */
  cookieState: string | null;
  code: string | null;
  /** aindrive 가 돌려준 `error`(사용자가 거절 등). */
  error?: string | null;
}

export type CompleteConnectResult =
  | { ok: true; userId: string; returnTo: string }
  | { ok: false; reason: 'state_mismatch' | 'state_expired' | 'denied' | 'rejected'; returnTo: string | null };

const sameState = (a: string, b: string) => {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function completeAindriveConnect(input: CompleteConnectInput, d: AindriveOAuthDeps = defaultOAuthDeps): Promise<CompleteConnectResult> {
  const k = keys();
  if (!k) throw notConfigured('token_key');
  // 쿠키와 쿼리가 다르면 다른 브라우저(또는 공격자)가 만든 콜백이다: state 레코드도 건드리지 않는다.
  if (!input.state || !input.cookieState || !sameState(input.state, input.cookieState)) return { ok: false, reason: 'state_mismatch', returnTo: null };
  const sealed = await d.kv.getDel(stateKey(input.state));
  const json = sealed ? unseal(k.state, sealed, input.state) : null;
  let rec: StateRecord | null = null;
  try { rec = json ? (JSON.parse(json) as StateRecord) : null; } catch { rec = null; }
  if (!rec || nowMs(d) - rec.createdAt > STATE_TTL_SEC * 1000) return { ok: false, reason: 'state_expired', returnTo: null };
  if (input.error || !input.code) return { ok: false, reason: 'denied', returnTo: rec.returnTo };
  const conn = await tokenRequest(input.aindriveUrl, {
    grant_type: 'authorization_code', code: input.code, redirect_uri: rec.redirectUri, client_id: input.clientId, code_verifier: rec.verifier,
  }, d);
  if (conn === 'rejected') return { ok: false, reason: 'rejected', returnTo: rec.returnTo };
  await writeConnection(rec.userId, conn, d);
  return { ok: true, userId: rec.userId, returnTo: rec.returnTo };
}

// ------------------------------------------------------------------------------- use (+ refresh)

export interface TokenLookupOptions extends AindriveOAuthDeps { aindriveUrl: string; clientId: string | null }

/** 같은 사용자의 동시 갱신을 한 번으로(refresh 토큰이 회전하므로 두 번 쓰면 두 번째가 거절된다). */
const inflight = new Map<string, Promise<string | null>>();

async function refreshConnection(userId: string, conn: AindriveConnection, o: TokenLookupOptions): Promise<string | null> {
  // client_id 가 없는 것은 배포 설정 문제다 — 연결을 지우지 않고 temporary_failure(설정을 고치면 그대로 다시 쓴다).
  if (!o.clientId) throw notConfigured('client_id');
  if (!conn.refreshToken) { await disconnectAindrive(userId, o); return null; }
  const next = await tokenRequest(o.aindriveUrl, { grant_type: 'refresh_token', refresh_token: conn.refreshToken, client_id: o.clientId }, o);
  if (next === 'rejected') {
    // 다른 인스턴스가 먼저 회전시켰을 수 있다: 저장본이 바뀌었으면 그것을 쓴다.
    const again = await readConnection(userId, o);
    if (again && again.refreshToken !== conn.refreshToken && again.expiresAt - REFRESH_MARGIN_MS > nowMs(o)) return again.accessToken;
    await disconnectAindrive(userId, o);
    return null;
  }
  await writeConnection(userId, { ...next, connectedAt: conn.connectedAt, refreshToken: next.refreshToken ?? conn.refreshToken }, o);
  return next.accessToken;
}

/** 배포 단위 토큰은 개발에서만 쓴다(운영·테스트에서는 없음과 같다). */
export function getSharedAindriveToken(): string | null {
  if (process.env.NODE_ENV !== 'development') return null;
  return process.env.AINDRIVE_ACCOUNT_TOKEN?.trim() || null;
}

/**
 * 사용자의 aindrive 계정 access 토큰(필요하면 갱신). 사용자 레코드가 없으면 개발에서만 배포 단위 토큰(env), 아니면 null.
 * 레코드가 있는데 열 수 없으면 null(공용 토큰으로 물러서지 않는다). 갱신 중 원본 장애·설정 누락은 temporary_failure 로
 * 던진다(연결을 지우지 않는다).
 */
export async function getAindriveAccountTokenFrom(userId: string | null, o: TokenLookupOptions): Promise<string | null> {
  if (userId) {
    let r: ConnectionRead;
    try { r = await readConnectionState(userId, o); } catch (error) {
      // 저장소 장애를 "연결 없음"으로 보지 않는다(배포 토큰으로 물러서면 다른 계정으로 원본을 부르게 된다).
      console.error('aindrive connection lookup failed:', error instanceof Error ? error.message : 'unknown');
      throw new AinContractError('temporary_failure', 'aindrive 연결 정보를 읽을 수 없습니다. 잠시 후 다시 시도해 주세요.', { retryable: true, detail: 'aindrive_connection_store_unavailable' });
    }
    if (r.state === 'unreadable') return null;
    if (r.state === 'ok') {
      const conn = r.conn;
      if (conn.expiresAt - REFRESH_MARGIN_MS > nowMs(o)) return conn.accessToken;
      const running = inflight.get(userId);
      if (running) return running;
      const p = refreshConnection(userId, conn, o).finally(() => inflight.delete(userId));
      inflight.set(userId, p);
      return p;
    }
  }
  return getSharedAindriveToken();
}

/** 라우트용: 설정(env)과 기본 의존성으로 조회한다. */
export async function getAindriveAccountToken(userId: string | null): Promise<string | null> {
  return getAindriveAccountTokenFrom(userId, { ...defaultOAuthDeps, aindriveUrl: getAindriveUrl(), clientId: getAindriveOAuthClientId() });
}
