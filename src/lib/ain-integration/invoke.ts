/**
 * 공유 에이전트 호출 오케스트레이션 (adapter-invoke-spec §POST /api/ain/invoke).
 *
 *  1. 에이전트: 1단계 어댑터의 public 목록에서 `agentKey` 를 찾는다(Space 는 Ainize 세션이 없다).
 *     없으면 `resource_deleted`, `canInvoke=false` 또는 `status!=='active'` 면 `agent_stopped`.
 *  2. 파일: `fileKeys` 를 1단계 목록(shared_with_me·mine)에서 찾고, 없으면 같은 드라이브의 공유 뿌리를
 *     탐색(MCP list_files)해 경로 해시가 맞는 항목을 찾는다. 못 찾으면 `forbidden`(볼 수 없는 파일의 이름은
 *     응답에 넣지 않는다).
 *  3. 위임 전제: 파일이 있으면 **aindrive 를 훑기 전에** 위임이 가능한지 먼저 본다 — 에이전트에 popJwk 가 없으면
 *     `unsupported_input`, SSO 클라이언트 설정이 없으면(배포 문제) `temporary_failure`, `getSessionProof` 가 사용자의
 *     AIN SSO ID 토큰을 못 주면(사용자 문제) `auth_required` + actionUrl(AIN SSO 연결). 어차피 넘길 수 없는 파일을
 *     찾느라 원본을 부르지 않는다.
 *  4. 위임: SSO 에 `ain-rdlg+jwt` 를 요청한다. SSO 가 증명을 거절하면 `auth_required` 에도 AIN SSO 연결 actionUrl 을
 *     싣는다(aindrive 연결 URL 은 계정 토큰이 없을 때만 — 둘을 바꿔 싣지 않는다).
 *  5. 호출: A2A `message/send`. `idempotencyKey` 는 (account, agentKey, fileKeys 정렬, text, conversation, room)
 *     에서 결정적으로 유도해 재시도가 같은 messageId 를 보내게 한다 — contextId 에 들어가는 것(room 포함)이
 *     모두 들어가므로 다른 방의 같은 요청이 같은 messageId 로 다른 contextId 를 보내는 일이 없다. 위임의 idempotencyKey 는
 *     시도마다 새 무작위 접미(randomUUID)다 — 시각이 아니다(같은 ms 의 재시도도 달라야 하고, SSO 는 토큰을 한 번만 돌려준다).
 *
 * 순수 함수 + fetch 주입. 토큰(세션 증명·위임·계정)은 응답·로그·오류 메시지에 절대 싣지 않는다.
 * 원본 호출은 모두 타임아웃이 있다(a2a/delegation/files 가 각자 건다).
 */
import { createHash, randomUUID } from 'node:crypto';
import { invokeAgent, type InvokeAgentOptions } from './a2a';
import { listSharedAgents } from './agents';
import { delegationPartOf, requestDelegation, type SsoDelegationOptions } from './delegation';
import { findInFolder, listSharedFiles, type FilesSourceOptions } from './files';
import type { FetchLike } from './http';
import {
  AinContractError, agentKey, fileKey, parseAgentKey, parseFileKey,
  type AgentListItem, type AgentRef, type ConversationScope, type DelegationPart, type FileRef, type TaskRef,
} from './types';

export interface InvokeRequest {
  agentKey: string;
  text: string;
  fileKeys: string[];
  conversation: string;
  room?: string;
}

export interface InvokeOptions {
  aindriveUrl: string;
  ainizeUrl: string;
  /** 사용자의 aindrive 계정 토큰. 파일이 있는 요청에서 없으면 `auth_required`. */
  aindriveToken: string | null;
  aindriveConnectUrl?: string;
  /** null 이면 파일이 있는 요청은 `auth_required` + `ssoConnectUrl`. */
  sso: (SsoDelegationOptions & { connectUrl?: string }) | null;
  /** 사용자의 AIN SSO ID 토큰을 돌려주는 주입 함수. null → `auth_required`. */
  getSessionProof: () => Promise<string | null>;
  scope: Omit<ConversationScope, 'conversation' | 'room'>;
  fetch?: FetchLike;
  a2a?: Omit<InvokeAgentOptions, 'fetch'>;
  now?: () => Date;
}

export interface InvokeResult { task: TaskRef; text: string }

export const INVOKE_LIMITS = { text: 20_000, fileKeys: 64, conversation: 256, room: 256, key: 1024 } as const;

/**
 * 결정적 idempotencyKey — 계약 opaqueId(공백·슬래시 없음). fileKeys 는 순서와 무관하게(정렬), room 은
 * contextId 와 같은 경계로(없으면 null) 들어간다.
 */
export function deriveIdempotencyKey(input: { account: string; agentKey: string; fileKeys: string[]; text: string; conversation: string; room?: string | null }): string {
  const fileKeys = [...new Set(input.fileKeys)].sort();
  const h = createHash('sha256').update(JSON.stringify([input.account, input.agentKey, fileKeys, input.text, input.conversation, input.room ?? null])).digest('hex');
  return `idem_${h.slice(0, 40)}`;
}

const AGENT_PAGE_LIMIT = 200;
const AGENT_MAX_PAGES = 5;

export async function resolveAgent(opts: Pick<InvokeOptions, 'ainizeUrl' | 'fetch'>, key: string): Promise<AgentListItem> {
  const parsed = parseAgentKey(key);
  if (!parsed) throw new AinContractError('unsupported_input', 'agentKey 는 `registryIssuer#agentId` 모양이어야 합니다.');
  const issuer = opts.ainizeUrl.replace(/\/+$/, '');
  if (parsed.registryIssuer !== issuer) throw new AinContractError('unsupported_input', '이 배포가 연결된 레지스트리의 에이전트만 호출할 수 있습니다.');
  let cursor: string | undefined;
  for (let page = 0; page < AGENT_MAX_PAGES; page++) {
    const res = await listSharedAgents({ ainizeUrl: issuer, sessionToken: null, fetch: opts.fetch }, { scope: 'public', limit: AGENT_PAGE_LIMIT, ...(cursor ? { cursor } : {}) });
    const hit = res.items.find((i) => agentKey(i.ref) === `${parsed.registryIssuer}#${parsed.agentId}`);
    if (hit) return hit;
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  throw new AinContractError('resource_deleted', '그 에이전트를 목록에서 찾을 수 없습니다.');
}

const FILE_PAGE_LIMIT = 200;
const FILE_MAX_PAGES = 5;

/** 1단계 목록(shared_with_me → mine)을 모두 모은다. 같은 fileKey 가 두 범위에 있으면 먼저 본 것이 남는다. */
async function collectListedFiles(files: FilesSourceOptions): Promise<Map<string, FileRef>> {
  const byKey = new Map<string, FileRef>();
  for (const scope of ['shared_with_me', 'mine'] as const) {
    let cursor: string | undefined;
    for (let page = 0; page < FILE_MAX_PAGES; page++) {
      const res = await listSharedFiles(files, { scope, limit: FILE_PAGE_LIMIT, ...(cursor ? { cursor } : {}) });
      for (const i of res.items) { const k = fileKey(i.ref); if (!byKey.has(k)) byKey.set(k, i.ref); }
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
  }
  return byKey;
}

export async function resolveFiles(files: FilesSourceOptions, keys: string[]): Promise<FileRef[]> {
  if (!keys.length) return [];
  const issuer = files.aindriveUrl.replace(/\/+$/, '');
  const wanted = keys.map((k) => {
    const p = parseFileKey(k);
    if (!p) throw new AinContractError('unsupported_input', 'fileKey 는 `issuer#driveId#fileId` 모양이어야 합니다.');
    if (p.issuer !== issuer) throw new AinContractError('unsupported_input', '이 배포가 연결된 aindrive 의 파일만 넘길 수 있습니다.');
    return { key: `${p.issuer}#${p.driveId}#${p.fileId}`, ...p };
  });
  const listed = await collectListedFiles(files);
  const out: FileRef[] = [];
  for (const w of wanted) {
    let ref = listed.get(w.key) ?? null;
    if (!ref) {
      // 공유 뿌리(같은 드라이브의 폴더)를 탐색한다. 뿌리가 여럿이면 차례로.
      const roots = [...listed.values()].filter((r) => r.driveId === w.driveId && r.kind === 'folder');
      for (const root of roots) { ref = await findInFolder(files, root, w.fileId); if (ref) break; }
    }
    // 볼 수 없는 파일은 "없다"가 아니라 "권한 없음"으로: 목록에 없으면 원본이 우리에게 허락하지 않은 것이다.
    if (!ref) throw new AinContractError('forbidden', '넘기려는 파일 중 이 계정이 볼 수 없는 것이 있습니다.');
    if (ref.availability.state === 'deleted') throw new AinContractError('resource_deleted', '넘기려는 파일이 삭제되었습니다.');
    out.push(ref);
  }
  return out;
}

/** 파일을 넘기려면 갖춰야 할 것 — aindrive 를 훑기 전에 확인한다. 통과하면 세션 증명(사용자의 AIN SSO ID 토큰). */
async function requireDelegationPrerequisites(opts: InvokeOptions, agent: AgentRef): Promise<{ sso: NonNullable<InvokeOptions['sso']>; sessionProof: string }> {
  if (!agent.popJwk) throw new AinContractError('unsupported_input', '이 에이전트는 PoP 키를 광고하지 않아 파일을 넘길 수 없습니다.');
  // 배포 설정 문제(SSO 클라이언트 없음)를 사용자 인증 문제로 보이게 하지 않는다: 설정을 먼저 본다.
  if (!opts.sso) throw new AinContractError('temporary_failure', 'AIN SSO 클라이언트가 이 배포에 설정되어 있지 않습니다.', { retryable: false, detail: 'ain_sso_client_missing' });
  const sessionProof = await opts.getSessionProof();
  if (!sessionProof) {
    throw new AinContractError('auth_required', 'AIN SSO 계정이 연결되어 있지 않습니다. 연결하면 파일을 에이전트에게 넘길 수 있습니다.', {
      ...(opts.sso.connectUrl ? { actionUrl: opts.sso.connectUrl } : {}),
    });
  }
  return { sso: opts.sso, sessionProof };
}

export async function invokeSharedAgent(opts: InvokeOptions, req: InvokeRequest): Promise<InvokeResult> {
  const agent = await resolveAgent(opts, req.agentKey);
  if (!agent.canInvoke || agent.ref.status !== 'active') throw new AinContractError('agent_stopped', '이 에이전트는 지금 호출할 수 없습니다.');

  // 파일이 있으면 popJwk·SSO 설정·세션 증명을 먼저 본다 — 넘길 수 없는 파일을 찾느라 aindrive 를 부르지 않는다.
  const prereq = req.fileKeys.length ? await requireDelegationPrerequisites(opts, agent.ref) : null;

  const files = await resolveFiles({ aindriveUrl: opts.aindriveUrl, token: opts.aindriveToken, connectUrl: opts.aindriveConnectUrl, fetch: opts.fetch, now: opts.now }, req.fileKeys);

  const scope: ConversationScope = { ...opts.scope, room: req.room ?? null, conversation: req.conversation };
  const idempotencyKey = deriveIdempotencyKey({ account: scope.account, agentKey: agentKey(agent.ref), fileKeys: files.map(fileKey), text: req.text, conversation: req.conversation, room: scope.room });

  let delegation: DelegationPart | undefined;
  if (files.length && prereq) {
    let issued;
    try {
      issued = await requestDelegation({ ...prereq.sso, fetch: opts.fetch }, {
        sessionProof: prereq.sessionProof, agent: agent.ref, files,
        idempotencyKey: `${idempotencyKey}-dlg-${randomUUID()}`,
      });
    } catch (e) {
      // SSO 가 증명을 거절했다 = 사용자가 AIN SSO 를 다시 연결해야 한다. actionUrl 은 AIN SSO 연결(aindrive 가 아니다).
      if (e instanceof AinContractError && e.code === 'auth_required' && !e.actionUrl && prereq.sso.connectUrl) {
        throw new AinContractError('auth_required', e.message, { actionUrl: prereq.sso.connectUrl, detail: e.detail, upstreamStatus: e.upstreamStatus });
      }
      throw e;
    }
    delegation = delegationPartOf(issued, [...new Set(files.map((f) => f.issuer))]);
  }

  return invokeAgent({ ...opts.a2a, fetch: opts.fetch, now: opts.now }, { agent: agent.ref, text: req.text, files, delegation, scope, idempotencyKey });
}

/** 라우트 경계의 바디 검증. 통과하면 정규화된 요청, 아니면 사용자에게 보여도 되는 이유. */
export function parseInvokeBody(body: unknown): { ok: true; req: InvokeRequest } | { ok: false; message: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: '요청 바디는 JSON 객체여야 합니다.' };
  const b = body as Record<string, unknown>;
  const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
  const agentKeyRaw = str(b.agentKey, INVOKE_LIMITS.key);
  if (!agentKeyRaw || !parseAgentKey(agentKeyRaw)) return { ok: false, message: 'agentKey 는 `registryIssuer#agentId` 문자열이어야 합니다.' };
  const text = typeof b.text === 'string' && b.text.trim().length > 0 && b.text.length <= INVOKE_LIMITS.text ? b.text : null;
  if (!text) return { ok: false, message: `text 는 1..${INVOKE_LIMITS.text}자 문자열이어야 합니다.` };
  const fileKeysRaw = b.fileKeys === undefined ? [] : b.fileKeys;
  if (!Array.isArray(fileKeysRaw) || fileKeysRaw.length > INVOKE_LIMITS.fileKeys || !fileKeysRaw.every((k) => typeof k === 'string' && k.length <= INVOKE_LIMITS.key && parseFileKey(k))) {
    return { ok: false, message: `fileKeys 는 \`issuer#driveId#fileId\` 문자열 최대 ${INVOKE_LIMITS.fileKeys}개의 배열이어야 합니다.` };
  }
  const conversation = str(b.conversation, INVOKE_LIMITS.conversation);
  if (!conversation || /[\s/\\]/.test(conversation)) return { ok: false, message: 'conversation 은 공백·슬래시 없는 식별자여야 합니다.' };
  let room: string | undefined;
  if (b.room !== undefined && b.room !== null && b.room !== '') {
    const r = str(b.room, INVOKE_LIMITS.room);
    if (!r || /[\s/\\]/.test(r)) return { ok: false, message: 'room 은 공백·슬래시 없는 식별자여야 합니다.' };
    room = r;
  }
  return { ok: true, req: { agentKey: agentKeyRaw, text, fileKeys: [...new Set(fileKeysRaw as string[])], conversation, ...(room ? { room } : {}) } };
}
