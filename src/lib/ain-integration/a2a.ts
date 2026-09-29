/**
 * A2A 0.3 호출기 — `message/send` 한 번으로 task 를 받아 계약 TaskRef 로 옮긴다 (adapter-invoke-spec §4·5).
 *
 * message.parts 순서와 type 은 고정이다:
 *   1. `{ kind:'text', text }`
 *   2. `{ kind:'data', data:{ refs: FileRef[] }, metadata:{ type:'ai.ain/file-refs' } }`   (파일이 있을 때)
 *   3. `{ kind:'data', data:{ token, audience, expiresAt, jti }, metadata:{ type:'ai.ain/delegation' } }` (위임이 있을 때)
 * `messageId = idempotencyKey` — 같은 논리 요청의 재시도는 같은 messageId 를 보내고 노드는 같은 task 를 돌려준다.
 *
 * 위임 토큰은 data part 에만 있다. 텍스트 part·응답·로그에는 넣지 않으며, 에이전트 답변에 토큰 문자열이
 * 섞여 돌아와도(있어서는 안 되지만) 응답에 싣기 전에 지운다. JSON-RPC error 의 `message` 도 에이전트가 만든
 * 문자열이므로 응답(`detail`)에 싣지 않는다 — 고정 코드만 주고, 원문은 토큰을 지운 뒤 서버 로그에만 남긴다.
 */
import { A2A_TIMEOUT_MS, fetchUpstream, type FetchLike } from './http';
import {
  AIN_CONTRACT_VERSION, AinContractError, DELEGATION_PART_TYPE, FILE_REFS_PART_TYPE, agentKey, conversationContextId,
  type AgentRef, type ConversationScope, type DelegationPart, type FileRef, type TaskRef, type TaskStatus,
} from './types';

export type A2aPart =
  | { kind: 'text'; text: string }
  | { kind: 'data'; data: Record<string, unknown>; metadata?: Record<string, unknown> }
  | { kind: 'file'; file: Record<string, unknown> };

export interface A2aTask {
  id: string;
  contextId?: string;
  status: { state: string; message?: { parts?: A2aPart[] } };
  artifacts?: { parts?: A2aPart[] }[];
  history?: { role: string; parts?: A2aPart[] }[];
}

export interface InvokeAgentInput {
  agent: AgentRef;
  text: string;
  files: FileRef[];
  delegation?: DelegationPart;
  scope: ConversationScope;
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface InvokeAgentOptions {
  fetch?: FetchLike;
  /** 노드가 요구할 때만(Space 는 Ainize 세션이 없어 보통 비어 있다). */
  authorization?: string;
  now?: () => Date;
  /** `message/send` 타임아웃(기본 A2A_TIMEOUT_MS). 초과하면 `temporary_failure` agent_timeout. */
  timeoutMs?: number;
}

const STATE: Record<string, TaskStatus> = {
  submitted: 'submitted', working: 'working', 'input-required': 'input_required', completed: 'completed',
  failed: 'failed', canceled: 'canceled', rejected: 'failed', 'auth-required': 'input_required',
};

const SUPPORTED_PROTOCOL = '0.3.0';
const majorMinor = (v: string) => v.split('.').slice(0, 2).join('.');

/** 세 part 를 규칙대로 조립한다(테스트가 순서·type 을 본다). */
export function buildA2aMessage(input: Omit<InvokeAgentInput, 'agent' | 'signal'>): { role: 'user'; messageId: string; contextId: string; parts: A2aPart[] } {
  const parts: A2aPart[] = [{ kind: 'text', text: input.text }];
  if (input.files.length) parts.push({ kind: 'data', data: { refs: input.files }, metadata: { type: FILE_REFS_PART_TYPE } });
  if (input.delegation) parts.push({ kind: 'data', data: { ...input.delegation }, metadata: { type: DELEGATION_PART_TYPE } });
  return { role: 'user', messageId: input.idempotencyKey, contextId: conversationContextId(input.scope), parts };
}

const textParts = (parts: A2aPart[] | undefined) =>
  (parts ?? []).filter((p): p is Extract<A2aPart, { kind: 'text' }> => p.kind === 'text').map((p) => p.text).join('\n').trim();

/** artifacts 가 답이다. 없으면 status.message, 그것도 없으면 history 의 마지막 agent 메시지. */
export function textOfTask(task: A2aTask): string {
  const artifactText = (task.artifacts ?? []).flatMap((a) => a.parts ?? []).filter((p): p is Extract<A2aPart, { kind: 'text' }> => p.kind === 'text').map((p) => p.text).join('\n').trim();
  if (artifactText) return artifactText;
  const statusText = textParts(task.status.message?.parts);
  if (statusText) return statusText;
  const lastAgent = [...(task.history ?? [])].reverse().find((m) => m.role === 'agent');
  return textParts(lastAgent?.parts);
}

/** 응답·로그에 실리기 전에 위임 토큰을 지운다. */
const redactor = (delegation: DelegationPart | undefined) => (s: string) =>
  delegation && s.includes(delegation.token) ? s.split(delegation.token).join('[redacted]') : s;

function unwrap(r: { result?: unknown; error?: { message?: string; code?: number } }, redact: (s: string) => string): A2aTask {
  if (r.error) {
    // 에이전트가 만든 message 는 신뢰하지 않는다: 클라이언트에는 고정 detail, 서버 로그에는 토큰을 지운 원문만.
    console.error('A2A message/send JSON-RPC error:', { code: r.error.code, message: redact(String(r.error.message ?? '')).slice(0, 500) });
    throw new AinContractError('temporary_failure', '에이전트가 요청을 처리하지 못했습니다.', { retryable: true, detail: 'agent_rpc_error' });
  }
  const t = r.result as (A2aTask & { kind?: string }) | { kind: 'message'; parts: A2aPart[]; messageId: string; contextId?: string } | undefined;
  if (!t || typeof t !== 'object') throw new AinContractError('temporary_failure', '에이전트 응답이 비어 있습니다.', { retryable: true });
  if ((t as { kind?: string }).kind === 'message') {
    const m = t as { parts: A2aPart[]; messageId: string; contextId?: string };
    return { id: m.messageId, contextId: m.contextId, status: { state: 'completed', message: { parts: m.parts } } };
  }
  const task = t as A2aTask;
  if (typeof task.id !== 'string' || !task.status || typeof task.status.state !== 'string') {
    throw new AinContractError('temporary_failure', '에이전트 응답이 A2A task 모양이 아닙니다.', { retryable: true });
  }
  return task;
}

export async function invokeAgent(opts: InvokeAgentOptions, input: InvokeAgentInput): Promise<{ task: TaskRef; text: string }> {
  const { agent } = input;
  if (agent.status !== 'active') throw new AinContractError('agent_stopped', '이 에이전트는 지금 호출할 수 없습니다.');
  if (!agent.supportedProtocolVersions.some((v) => majorMinor(v) === majorMinor(SUPPORTED_PROTOCOL))) {
    throw new AinContractError('unsupported_input', '이 에이전트와 맞는 A2A 버전이 없습니다.');
  }
  const f = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  const message = buildA2aMessage(input);
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  if (opts.authorization) headers.authorization = opts.authorization;
  const createdAt = now().toISOString();
  const res = await fetchUpstream(f, agent.endpoint, {
    method: 'POST', headers, cache: 'no-store',
    body: JSON.stringify({ jsonrpc: '2.0', id: input.idempotencyKey, method: 'message/send', params: { message } }),
  }, { timeoutMs: opts.timeoutMs ?? A2A_TIMEOUT_MS, signal: input.signal, target: 'agent' });
  if (!res.ok) {
    // 원본 status 는 코드로만 옮기고 응답 status 로 되비추지 않는다(코드 표가 정한다). 숫자는 로그에만.
    const code = res.status === 401 ? 'auth_required' : res.status === 403 ? 'forbidden' : res.status === 404 ? 'resource_deleted' : res.status === 429 ? 'rate_limited' : 'temporary_failure';
    console.error('A2A message/send HTTP error:', { status: res.status });
    throw new AinContractError(code, '에이전트 엔드포인트가 요청을 받지 않았습니다.', { retryable: res.status >= 500 || res.status === 429, detail: 'agent_http_error', upstreamStatus: res.status });
  }
  let rpc: { result?: unknown; error?: { message?: string } };
  try { rpc = await res.json(); } catch { throw new AinContractError('temporary_failure', '에이전트 응답을 읽을 수 없습니다.', { retryable: true }); }
  const redact = redactor(input.delegation);
  const a2aTask = unwrap(rpc, redact);
  const text = redact(textOfTask(a2aTask));
  const status = STATE[a2aTask.status.state] ?? 'working';
  const task: TaskRef = {
    contract: AIN_CONTRACT_VERSION,
    taskId: a2aTask.id,
    contextId: a2aTask.contextId ?? message.contextId,
    agent: agentKey(agent),
    idempotencyKey: input.idempotencyKey,
    status,
    createdAt,
    updatedAt: now().toISOString(),
    sources: input.files.map((file) => ({ file, citations: [] })),
    outputs: [],
    ...(status === 'failed' ? { error: { code: 'temporary_failure' as const, message: text || '에이전트가 실패했습니다.', retryable: true } } : {}),
  };
  return { task, text };
}
