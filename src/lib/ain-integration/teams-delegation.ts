/**
 * 공통 항목 B (Space) — 위임을 **Teams 가 대신 발급**한다. 서버 전용.
 *
 * Space 는 AIN SSO 로 로그인하지 않아 봉인해 둘 ID 토큰(세션 증명)이 없다. 대신 Space 사용자가 들고 있는 세션은
 * Teams(ainteams backend) JWT 이고, Teams 는 같은 사용자의 AIN SSO ID 토큰을 봉인해 두고 있다(#1316). 그래서
 * Space 서버는 사용자의 Teams JWT 로 Teams 에 위임을 청하고, Teams 가 자기 invoke 경로와 똑같이 AIN SSO 에서
 * `ain-rdlg+jwt` 를 받아 돌려준다. 계약(양쪽이 정확히 맞아야 한다):
 *
 *   POST {AIN_TEAMS_DELEGATION_URL}            (Teams backend `/api/ain/delegation`)
 *   Authorization: Bearer <Space 클라이언트가 이미 든 Teams JWT>
 *   { agentRef: AgentRef, fileKeys: string[], conversationContextId: string, actions?: ['read'] }
 *   → 200 { delegation: { token, exp, jti } }
 *   → 401 { error: { code: 'auth_required', actionUrl } }   저장된 세션 증명 없음(AIN SSO 연결 필요)
 *   → 403 forbidden                                         사용자가 자기 aindrive 연결로 볼 수 없는 fileKey
 *   → 404                                                   Teams 쪽 AIN_INTEGRATION_ENABLED off
 *   → 429 rate_limited                                      사용자별 한도
 *
 * env 가 없으면 이 경로를 쓰지 않는다 → 예전처럼 `getSessionProof`(항상 null) → `auth_required`.
 * Teams JWT·위임 토큰은 헤더/바디로만 오가고 로그·응답·오류 메시지에 절대 싣지 않는다. Teams 가 준 문장도 되비추지
 * 않는다(고정 문구 + 코드). actionUrl 만 http(s) 절대 URL 일 때 그대로 전달한다(사용자가 AIN SSO 를 연결하러 갈 곳).
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
}

const MSG_AUTH = 'AIN SSO 계정이 연결되어 있지 않습니다. Teams 에서 AIN SSO 로 로그인하면 파일을 에이전트에게 넘길 수 있습니다.';
const MSG_FORBIDDEN = 'Teams 가 이 파일들의 위임을 거절했습니다(연결된 aindrive 에서 볼 수 없는 파일).';
const MSG_DISABLED = 'Teams 쪽 AIN 통합이 꺼져 있어 위임을 받을 수 없습니다.';
const MSG_FAILED = 'Teams 가 위임을 발급하지 못했습니다. 잠시 후 다시 시도해 주세요.';

const isHttpUrl = (v: unknown): v is string => {
  if (typeof v !== 'string' || v.length > 2048) return false;
  try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
};

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
      const actionUrl = isHttpUrl(json?.error?.actionUrl) ? json.error.actionUrl : undefined;
      throw new AinContractError('auth_required', MSG_AUTH, { ...(actionUrl ? { actionUrl } : {}), detail: 'teams_session_proof_missing', ...upstream });
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
