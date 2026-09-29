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
 * 섞여 돌아와도(있어서는 안 되지만) 응답에 싣기 전에 지운다.
 */
import type { FetchLike } from './http';
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

function unwrap(r: { result?: unknown; error?: { message?: string; code?: number } }): A2aTask {
  if (r.error) throw new AinContractError('temporary_failure', '에이전트가 요청을 처리하지 못했습니다.', { status: 502, retryable: true, detail: r.error.message });
  const t = r.result as (A2aTask & { kind?: string }) | { kind: 'message'; parts: A2aPart[]; messageId: string; contextId?: string } | undefined;
  if (!t || typeof t !== 'object') throw new AinContractError('temporary_failure', '에이전트 응답이 비어 있습니다.', { status: 502, retryable: true });
  if ((t as { kind?: string }).kind === 'message') {
    const m = t as { parts: A2aPart[]; messageId: string; contextId?: string };
    return { id: m.messageId, contextId: m.contextId, status: { state: 'completed', message: { parts: m.parts } } };
  }
  const task = t as A2aTask;
  if (typeof task.id !== 'string' || !task.status || typeof task.status.state !== 'string') {
    throw new AinContractError('temporary_failure', '에이전트 응답이 A2A task 모양이 아닙니다.', { status: 502, retryable: true });
  }
  return task;
}

export async function invokeAgent(opts: InvokeAgentOptions, input: InvokeAgentInput): Promise<{ task: TaskRef; text: string }> {
  const { agent } = input;
  if (agent.status !== 'active') throw new AinContractError('agent_stopped', '이 에이전트는 지금 호출할 수 없습니다.', { status: 409 });
  if (!agent.supportedProtocolVersions.some((v) => majorMinor(v) === majorMinor(SUPPORTED_PROTOCOL))) {
    throw new AinContractError('unsupported_input', '이 에이전트와 맞는 A2A 버전이 없습니다.', { status: 415 });
  }
  const f = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  const message = buildA2aMessage(input);
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  if (opts.authorization) headers.authorization = opts.authorization;
  const createdAt = now().toISOString();
  const res = await f(agent.endpoint, {
    method: 'POST', headers, cache: 'no-store', signal: input.signal,
    body: JSON.stringify({ jsonrpc: '2.0', id: input.idempotencyKey, method: 'message/send', params: { message } }),
  });
  if (!res.ok) {
    const code = res.status === 401 ? 'auth_required' : res.status === 403 ? 'forbidden' : res.status === 404 ? 'resource_deleted' : res.status === 429 ? 'rate_limited' : 'temporary_failure';
    throw new AinContractError(code, `${res.status} from agent endpoint`, { status: res.status, retryable: res.status >= 500 || res.status === 429 });
  }
  let rpc: { result?: unknown; error?: { message?: string } };
  try { rpc = await res.json(); } catch { throw new AinContractError('temporary_failure', '에이전트 응답을 읽을 수 없습니다.', { status: 502, retryable: true }); }
  const a2aTask = unwrap(rpc);
  let text = textOfTask(a2aTask);
  if (input.delegation && text.includes(input.delegation.token)) text = text.split(input.delegation.token).join('[redacted]');
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
