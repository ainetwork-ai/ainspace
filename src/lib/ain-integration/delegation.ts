/**
 * 제품 측 위임 클라이언트 (docs/08-agent-delegation.md §4, adapter-invoke-spec §3).
 *
 * 로그인한 사용자를 대신해 AIN SSO 에 에이전트의 PoP 키에 묶인 `ain-rdlg+jwt` 를 요청한다.
 *   POST {issuer}/api/delegations/resource  (client_secret_basic)
 *   { sessionProof, agent, resources:[{resource, actions}], audience, ttlSeconds, idempotencyKey, cnf:{jwk} }
 *   → 201 { jti, token, expiresAt, reused:false } | 200 { jti, expiresAt, reused:true } (토큰은 한 번만 준다)
 *
 * `sessionProof` 는 제품이 가진 **사용자의 AIN SSO ID 토큰**뿐이다. 다른 토큰(Google/NextAuth/backend JWT)을
 * 대신 보내지 않는다 — 그런 것밖에 없으면 호출부가 `auth_required` 로 끝낸다.
 * 토큰(세션 증명·위임)은 헤더/바디로만 나가고 응답·로그·오류 메시지에 절대 싣지 않는다.
 */
import type { FetchLike } from './http';
import { AinContractError, agentKey, fileKey, isErrorBody, type AgentRef, type DelegationPart, type FileRef } from './types';

export interface SsoDelegationOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  fetch?: FetchLike;
}

export interface DelegationInput {
  sessionProof: string;
  agent: AgentRef;
  files: FileRef[];
  actions?: ('read' | 'list')[];
  ttlSeconds?: number;
  /** 요청마다 새 값. SSO 는 같은 키의 재요청에 토큰 없이 `reused:true` 만 돌려준다. */
  idempotencyKey: string;
}

export interface IssuedDelegation { jti: string; token: string; expiresAt: string; reused: boolean }

const toIso = (v: string | number): string => {
  const d = typeof v === 'number' ? new Date(v * (v < 1e12 ? 1000 : 1)) : new Date(v);
  return d.toISOString();
};

export async function requestDelegation(opts: SsoDelegationOptions, input: DelegationInput): Promise<IssuedDelegation> {
  if (!input.agent.popJwk) {
    throw new AinContractError('unsupported_input', '이 에이전트는 PoP 키를 광고하지 않아 파일 위임을 받을 수 없습니다.', { status: 415 });
  }
  if (!input.files.length) throw new AinContractError('unsupported_input', '위임할 파일이 없습니다.', { status: 400 });
  const f = opts.fetch ?? fetch;
  const issuer = opts.issuer.replace(/\/+$/, '');
  const audience = [...new Set(input.files.map((x) => x.issuer))];
  const body = {
    sessionProof: input.sessionProof,
    agent: agentKey(input.agent),
    resources: input.files.map((x) => ({ resource: fileKey(x), actions: input.actions ?? ['read'] })),
    audience,
    ttlSeconds: input.ttlSeconds ?? 900,
    idempotencyKey: input.idempotencyKey,
    cnf: { jwk: input.agent.popJwk },
  };
  const basic = Buffer.from(`${encodeURIComponent(opts.clientId)}:${encodeURIComponent(opts.clientSecret)}`).toString('base64');
  const res = await f(`${issuer}/api/delegations/resource`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Basic ${basic}` },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  let json: { jti?: string; token?: string; expiresAt?: string | number; reused?: boolean; error?: unknown; error_description?: unknown } | null = null;
  try { json = await res.json(); } catch { /* not json */ }
  if (!res.ok) {
    if (isErrorBody(json)) throw new AinContractError(json.error.code, json.error.message, { status: res.status, retryable: json.error.retryable });
    const errCode = json && typeof json.error === 'string' ? json.error : '';
    // SSO 오류 코드: invalid_client(401) · session_proof_invalid(400) · idempotency_conflict(409) · invalid_request(400)
    if (res.status === 401 || res.status === 403 || errCode === 'session_proof_invalid') {
      throw new AinContractError('auth_required', 'AIN SSO 세션 증명이 유효하지 않습니다. 다시 로그인해 주세요.', { status: 401, detail: errCode || undefined });
    }
    if (res.status === 400 || res.status === 409 || res.status === 422) {
      throw new AinContractError('unsupported_input', 'AIN SSO 가 위임 요청을 거절했습니다.', { status: res.status, detail: errCode || undefined });
    }
    if (res.status === 429) throw new AinContractError('rate_limited', 'AIN SSO 요청이 너무 많습니다.', { status: 429 });
    throw new AinContractError('temporary_failure', `${res.status} from AIN SSO delegations`, { status: res.status, retryable: true });
  }
  if (!json?.jti || json.expiresAt === undefined) throw new AinContractError('temporary_failure', 'AIN SSO 위임 응답이 올바르지 않습니다.', { status: 502, retryable: true });
  if (json.reused && !json.token) {
    throw new AinContractError('unsupported_input', '이 idempotencyKey 의 위임은 이미 발급되었고 토큰은 한 번만 돌려줍니다.', { status: 409 });
  }
  return { jti: json.jti, token: json.token as string, expiresAt: toIso(json.expiresAt), reused: !!json.reused };
}

/** `ai.ain/file-refs` 옆에 붙이는 data part. */
export const delegationPartOf = (d: IssuedDelegation, audience: string[]): DelegationPart =>
  ({ token: d.token, audience, expiresAt: d.expiresAt, jti: d.jti });
