/**
 * 공통 항목 B (Space) — 위임을 **Teams 가 대신 발급**한다. 서버 전용.
 *
 * Space 는 AIN SSO 로 로그인하지 않아 봉인해 둘 ID 토큰(세션 증명)이 없다. 대신 Space 사용자가 들고 있는 세션은
 * Teams(ainteams backend) access JWT 이고, Teams 는 같은 사용자의 AIN SSO ID 토큰을 봉인해 두고 있다(#1316). 그래서
 * Space 서버는 사용자의 Teams JWT 로 Teams 에 위임을 청하고, Teams 가 자기 invoke 경로와 똑같이 AIN SSO 에서
 * `ain-rdlg+jwt` 를 받아 돌려준다. 계약(양쪽이 정확히 맞아야 한다):
 *
 *   POST {AIN_TEAMS_DELEGATION_URL}            (Teams **web** 앱의 `/api/ain/delegation`)
 *   Authorization: Bearer <Space 클라이언트가 이미 든 Teams backend access JWT — iss a2a-backend, aud client-access>
 *     Teams web 은 이 토큰을 backend `/auth/me` 로 확인한다(ainteams web `lib/ain-integration/space-caller-auth.ts`).
 *   { agentRef: AgentRef, fileKeys: string[], conversationContextId: string, requestId?: string, actions?: ['read'] }
 *     requestId — Space 의 한 차례(turn) id(클라이언트가 만든다, invoke 바디의 `requestId`). 같은 차례의 재시도는 같은 값.
 *     Teams 는 유료 셈의 멱등 키에 넣는다 — 있으면 차례마다 한 번, 없으면 발급마다 센다(ainteams #1318).
 *   → 200 { delegation: { token, exp, jti } }
 *   → 401 { error: { code: 'auth_required', actionUrl } }   연결 필요 — 저장된 세션 증명 없음(AIN SSO 연결) 또는 aindrive 연결 없음.
 *                                                           actionUrl 이 상대 경로면 Teams origin 기준으로 푼다(연결은 Teams 에서 한다).
 *   → 401 그 밖(actionUrl 없는 auth_required · 계약 본문 없음)  Teams 가 이 Bearer 를 받지 않았다(만료·무효·발급자 불일치)
 *                                                           → `auth_required` detail `teams_session_invalid`, actionUrl 없음(다시 로그인)
 *   → 403 forbidden                                         사용자가 자기 aindrive 연결로 볼 수 없는 fileKey
 *   → 404                                                   Teams 쪽 AIN_INTEGRATION_ENABLED off
 *   → 429 rate_limited                                      사용자별 한도
 *
 * env 가 없으면 이 경로를 쓰지 않는다 → 예전처럼 `getSessionProof`(항상 null) → `auth_required`.
 * Teams JWT·위임 토큰은 헤더/바디로만 오가고 로그·응답·오류 메시지에 절대 싣지 않는다. Teams 가 준 문장도 되비추지
 * 않는다(고정 문구 + 코드). actionUrl 은 Teams origin 기준으로 푼 http(s) URL 만 전달한다(사용자가 연결하러 갈 곳).
 */
import { UPSTREAM_TIMEOUT_MS, fetchUpstream, type FetchLike } from './http';
import { AinContractError, fileKey, isErrorCode, type AgentRef, type FileRef } from './types';
import type { IssuedDelegation } from './delegation';

/** Teams 위임 엔드포인트. 없으면 null(= B 미적용). http 는 localhost 에서만 받는다(Teams JWT 가 평문으로 나가지 않게). */
export function getTeamsDelegationUrl(): string | null {
  const raw = process.env.AIN_TEAMS_DELEGATION_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1' || u.hostname === '[::1]';
    if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return u.toString();
  } catch { /* fallthrough */ }
  console.error('AIN_TEAMS_DELEGATION_URL is not an https URL; Teams delegation disabled');
  return null;
}

export interface TeamsDelegationOptions {
  url: string;
  /** 사용자의 Teams JWT(Space 세션 그대로). */
  teamsJwt: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface TeamsDelegationInput {
  agent: AgentRef;
  files: FileRef[];
  conversationContextId: string;
  /** 차례 id. 있으면 그대로 싣는다(없으면 키 자체를 빼서 예전 바디와 같다). */
  requestId?: string;
}

const MSG_AUTH = 'AIN SSO 계정이 연결되어 있지 않습니다. Teams 에서 AIN SSO 로 로그인하면 파일을 에이전트에게 넘길 수 있습니다.';
const MSG_AINDRIVE = 'Teams 에 aindrive 계정이 연결되어 있지 않습니다. Teams 에서 aindrive 를 연결하면 파일을 에이전트에게 넘길 수 있습니다.';
const MSG_SESSION = 'Teams 가 이 로그인 세션을 받지 않았습니다. 다시 로그인한 뒤 시도해 주세요.';
const MSG_FORBIDDEN = 'Teams 가 이 파일들의 위임을 거절했습니다(연결된 aindrive 에서 볼 수 없는 파일).';
const MSG_DISABLED = 'Teams 쪽 AIN 통합이 꺼져 있어 위임을 받을 수 없습니다.';
const MSG_FAILED = 'Teams 가 위임을 발급하지 못했습니다. 잠시 후 다시 시도해 주세요.';

/** Teams 가 준 actionUrl 을 Teams origin 기준으로 푼다(상대 경로 허용). http(s) 가 아니면 null. */
export function resolveTeamsActionUrl(v: unknown, teamsUrl: string): string | null {
  if (typeof v !== 'string' || !v || v.length > 2048) return null;
  try {
    const u = new URL(v, teamsUrl);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch { return null; }
}

/** Teams 의 aindrive 연결 안내인가(`/api/ain/aindrive/connect` — Teams `AINDRIVE_CONNECT_PATH`). 아니면 AIN SSO 연결로 본다. */
const isAindriveConnect = (url: string): boolean => { try { return /\/aindrive\/connect\/?$/.test(new URL(url).pathname); } catch { return false; } };

const toIso = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v * (v < 1e12 ? 1000 : 1)).toISOString();
  if (typeof v === 'string' && v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  return null;
};

export async function requestTeamsDelegation(opts: TeamsDelegationOptions, input: TeamsDelegationInput): Promise<IssuedDelegation> {
  if (!input.files.length) throw new AinContractError('unsupported_input', '위임할 파일이 없습니다.');
  const f = opts.fetch ?? fetch;
  const body = {
    agentRef: input.agent,
    fileKeys: input.files.map(fileKey),
    conversationContextId: input.conversationContextId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    actions: ['read'],
  };
  const res = await fetchUpstream(f, opts.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${opts.teamsJwt}` },
    body: JSON.stringify(body),
    cache: 'no-store',
  }, { timeoutMs: opts.timeoutMs ?? UPSTREAM_TIMEOUT_MS, target: 'teams_delegation' });

  let json: { delegation?: { token?: unknown; exp?: unknown; jti?: unknown }; error?: { code?: unknown; actionUrl?: unknown } } | null = null;
  try { json = await res.json(); } catch { /* not json */ }
  const upstream = { upstreamStatus: res.status };

  if (!res.ok) {
    const code = isErrorCode(json?.error?.code) ? json.error.code : null;
    // 코드와 status 만 남긴다(Teams 문장·토큰은 남기지 않는다).
    console.error('Teams delegation refused:', { status: res.status, code });
    if (res.status === 401 || code === 'auth_required') {
      const actionUrl = code === 'auth_required' ? resolveTeamsActionUrl(json?.error?.actionUrl, opts.url) : null;
      // actionUrl 이 없으면 연결 문제가 아니라 Teams 가 Bearer 자체를 거절한 것(requireAuth 401) — 연결 안내를 붙이지 않는다.
      if (!actionUrl) throw new AinContractError('auth_required', MSG_SESSION, { detail: 'teams_session_invalid', ...upstream });
      if (isAindriveConnect(actionUrl)) throw new AinContractError('auth_required', MSG_AINDRIVE, { actionUrl, detail: 'teams_aindrive_not_connected', ...upstream });
      throw new AinContractError('auth_required', MSG_AUTH, { actionUrl, detail: 'teams_session_proof_missing', ...upstream });
    }
    if (res.status === 403 || code === 'forbidden') throw new AinContractError('forbidden', MSG_FORBIDDEN, { detail: 'teams_delegation_forbidden', ...upstream });
    if (res.status === 404) throw new AinContractError('temporary_failure', MSG_DISABLED, { retryable: false, detail: 'teams_delegation_disabled', ...upstream });
    if (res.status === 429 || code === 'rate_limited') throw new AinContractError('rate_limited', 'Teams 위임 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', upstream);
    if (code === 'unsupported_input' || code === 'agent_stopped' || code === 'resource_deleted') {
      throw new AinContractError(code, MSG_FAILED, { retryable: false, detail: `teams_${code}`, ...upstream });
    }
    throw new AinContractError('temporary_failure', MSG_FAILED, { retryable: true, detail: 'teams_delegation_http_error', ...upstream });
  }

  const d = json?.delegation;
  const expiresAt = toIso(d?.exp);
  if (!d || typeof d.token !== 'string' || !d.token || typeof d.jti !== 'string' || !d.jti || !expiresAt) {
    throw new AinContractError('temporary_failure', MSG_FAILED, { retryable: true, detail: 'teams_delegation_bad_response' });
  }
  return { token: d.token, jti: d.jti, expiresAt, reused: false };
}
