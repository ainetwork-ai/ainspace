/**
 * AIN 통합 계약 (contract 1.0) — 제품 안에 재선언한 최소 형태.
 *
 * 원본: ain-integration/packages/contracts/src/{file-ref,agent-ref,list,errors}.ts.
 * 외부 패키지를 import 하지 않는다(어댑터 사양 §계약). 타입은 구조만 옮기고, 검증은
 * 라우트 경계에서 필요한 최소한(식별 필드·contract 버전)만 한다 — 권한 판단은 원본
 * (aindrive/Ainize)이 하므로 여기서는 모양만 지킨다.
 *
 * 참조는 토큰·서명 URL·비밀을 절대 담지 않는다. 접근은 사용 시점에 호출자 컨텍스트로 얻는다.
 */

export const AIN_CONTRACT_VERSION = '1.0' as const;
export type ContractVersion = typeof AIN_CONTRACT_VERSION;

// ---------------------------------------------------------------------------------------------- common

export interface OwnerRef {
  kind: 'account' | 'org' | 'wallet' | 'principal';
  issuer: string;
  subject: string;
  /** 표시 전용. 매칭에 쓰지 않는다. */
  displayName?: string;
}

// ---------------------------------------------------------------------------------------------- files

export type FileKind = 'file' | 'folder';
export type AvailabilityState = 'online' | 'offline' | 'deleted' | 'unknown';

export interface FileAvailability {
  state: AvailabilityState;
  lastSeenAt?: string;
}

/** 식별은 `issuer + driveId + fileId`. `legacy.path` 는 호환용이며 영구 식별자가 아니다. */
export interface FileRef {
  contract: ContractVersion;
  issuer: string;
  driveId: string;
  fileId: string;
  revision: string;
  kind: FileKind;
  mimeType?: string;
  displayName: string;
  ownerRef: OwnerRef;
  availability: FileAvailability;
  /** 원본 제품에서 여는 위치. 자격증명 없음. */
  sourceUrl?: string;
  legacy?: { path: string };
  size?: number;
  sha256?: string;
}

export type FileAccessRole = 'owner' | 'editor' | 'viewer' | 'none';
export type ShareOrigin = 'own' | 'direct' | 'org' | 'link' | 'paid';

export interface FileListItem {
  ref: FileRef;
  role: FileAccessRole;
  shareOrigin: ShareOrigin;
  paid?: { entitled: boolean; pricingRef?: string };
  modifiedAt?: string;
  sharedAt?: string;
}

// ---------------------------------------------------------------------------------------------- agents

export type AgentVisibility = 'public' | 'org' | 'private' | 'unlisted';
export type AgentStatus = 'active' | 'disabled' | 'stopped' | 'deleted';
export type UiCapability =
  | 'streaming' | 'cancel' | 'image_in' | 'image_out' | 'audio_in' | 'audio_out'
  | 'ainui' | 'a2ui_basic' | 'file_refs_out';

export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  examples?: string[];
}

/** 식별은 `registryIssuer + agentId`. 실행 정의가 바뀌면 새 `releaseId`. */
export interface AgentRef {
  contract: ContractVersion;
  registryIssuer: string;
  agentId: string;
  releaseId: string;
  ownerRef: OwnerRef;
  visibility: AgentVisibility;
  orgRef?: OwnerRef;
  agentCardUrl: string;
  /** A2A JSON-RPC 엔드포인트. 카드 URL 오리진과 다를 수 있다(노드 릴레이). */
  endpoint: string;
  supportedProtocolVersions: string[];
  skills: AgentSkill[];
  inputModes: string[];
  outputModes: string[];
  uiCapabilities: UiCapability[];
  pricingRef?: string;
  /**
   * v1.1: 에이전트의 PoP 공개키(JWK). 제품은 위임을 이 키에 묶어(`cnf.jwk`) 그 에이전트만 쓸 수 있게 한다
   * (docs/08-agent-delegation.md). 공개키이므로 `d` 는 절대 없다.
   */
  popJwk?: PopJwk;
  status: AgentStatus;
  displayName: string;
  description?: string;
  updatedAt: string;
}

export interface PopJwk { kty: string; crv?: string; x?: string; y?: string; kid?: string; alg?: string; [k: string]: unknown }

export interface AgentListItem {
  ref: AgentRef;
  canInvoke: boolean;
}

// ---------------------------------------------------------------------------------------------- list

export const FILE_LIST_SCOPES = ['mine', 'shared_with_me', 'shared_with_org', 'recent'] as const;
export const AGENT_LIST_SCOPES = ['mine', 'shared_with_me', 'shared_with_org', 'public'] as const;
export type FileListScope = (typeof FILE_LIST_SCOPES)[number];
export type AgentListScope = (typeof AGENT_LIST_SCOPES)[number];

export const LIST_LIMIT_DEFAULT = 50;
export const LIST_LIMIT_MAX = 200;

interface ListRequestBase {
  /** displayName 부분 일치(대소문자 무시). */
  q?: string;
  cursor?: string;
  limit: number;
  org?: string;
}
export interface FileListRequest extends ListRequestBase { scope: FileListScope; folder?: string }
export interface AgentListRequest extends ListRequestBase { scope: AgentListScope }

interface ListResponseBase {
  contract: ContractVersion;
  /** 원본이 이 페이지의 권한을 평가한 시각("as of"). */
  asOf: string;
  nextCursor: string | null;
  cursorExpired?: boolean;
}
export interface FileListResponse extends ListResponseBase { items: FileListItem[] }
export interface AgentListResponse extends ListResponseBase { items: AgentListItem[] }

// ---------------------------------------------------------------------------------------------- errors

export const ERROR_CODES = [
  'auth_required', 'forbidden', 'entitlement_required', 'unsupported_input', 'source_offline',
  'resource_deleted', 'agent_stopped', 'rate_limited', 'temporary_failure',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const HTTP_STATUS_FOR: Record<ErrorCode, number> = {
  auth_required: 401, forbidden: 403, entitlement_required: 402, unsupported_input: 415,
  source_offline: 503, resource_deleted: 410, agent_stopped: 409, rate_limited: 429, temporary_failure: 503,
};

export const RETRYABLE: Record<ErrorCode, boolean> = {
  auth_required: false, forbidden: false, entitlement_required: false, unsupported_input: false,
  source_offline: true, resource_deleted: false, agent_stopped: false, rate_limited: true, temporary_failure: true,
};

export interface ErrorBody {
  error: {
    code: ErrorCode;
    /** 사용자에게 보여도 되는 문장. 볼 수 없는 리소스의 이름을 담지 않는다. */
    message: string;
    retryable: boolean;
    retryAfterSeconds?: number;
    /** entitlement_required → 구매 위치, auth_required → 로그인/연결 위치. */
    actionUrl?: string;
    detail?: string;
  };
}

/** `retryable` 도 덮어쓸 수 있다(기본은 코드별 RETRYABLE). */
type ErrorExtra = Partial<Omit<ErrorBody['error'], 'code' | 'message'>>;

export const isErrorCode = (v: unknown): v is ErrorCode =>
  typeof v === 'string' && (ERROR_CODES as readonly string[]).includes(v);

export const makeError = (code: ErrorCode, message: string, extra: ErrorExtra = {}): ErrorBody =>
  ({ error: { code, message, retryable: RETRYABLE[code], ...extra } });

/**
 * 어댑터가 던지는 유일한 오류 타입. 라우트가 `toErrorBody` 로 계약 바디로 바꾼다.
 * `status` 는 **항상 코드 표(HTTP_STATUS_FOR)** 에서 온다 — 원본(aindrive/Ainize/SSO/에이전트)의 HTTP status 는
 * 응답 status 로 새지 않고 `upstreamStatus` 에만 남는다(네이티브 라우트 404 → fallback 판단용).
 */
export class AinContractError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly actionUrl?: string;
  readonly detail?: string;
  readonly upstreamStatus?: number;

  constructor(code: ErrorCode, message: string, opts: { retryable?: boolean; actionUrl?: string; detail?: string; upstreamStatus?: number } = {}) {
    super(message);
    this.name = 'AinContractError';
    this.code = code;
    this.status = HTTP_STATUS_FOR[code];
    this.retryable = opts.retryable ?? RETRYABLE[code];
    this.actionUrl = opts.actionUrl;
    this.detail = opts.detail;
    this.upstreamStatus = opts.upstreamStatus;
  }

  toBody(): ErrorBody {
    return makeError(this.code, this.message, {
      retryable: this.retryable,
      ...(this.actionUrl ? { actionUrl: this.actionUrl } : {}),
      ...(this.detail ? { detail: this.detail } : {}),
    });
  }
}

export const isErrorBody = (v: unknown): v is ErrorBody => {
  if (!v || typeof v !== 'object') return false;
  const e = (v as { error?: unknown }).error;
  return !!e && typeof e === 'object'
    && isErrorCode((e as { code?: unknown }).code)
    && typeof (e as { message?: unknown }).message === 'string'
    && typeof (e as { retryable?: unknown }).retryable === 'boolean';
};

/** 알 수 없는 실패는 `temporary_failure` — 소비자가 사용자를 탓하는 대신 재시도하게. 내부 메시지는 노출하지 않는다. */
export const toErrorBody = (e: unknown): ErrorBody => {
  if (e instanceof AinContractError) return e.toBody();
  if (isErrorBody(e)) return e;
  return makeError('temporary_failure', '원본 서비스 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.');
};

// ---------------------------------------------------------------------------------------------- keys

/** 제품 간 공통 에이전트 식별자. StoredAgent.commonAgentId 에 이 값이 들어간다. */
export const agentKey = (r: Pick<AgentRef, 'registryIssuer' | 'agentId'>) => `${r.registryIssuer}#${r.agentId}`;
export const fileKey = (r: Pick<FileRef, 'issuer' | 'driveId' | 'fileId'>) => `${r.issuer}#${r.driveId}#${r.fileId}`;

// ---------------------------------------------------------------------------------------------- guards
// 원본 응답이 "계약 모양"인지 판단하는 최소 검사. 통과하면 그대로 전달하고, 아니면 fallback 으로 간다.

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

const isListEnvelope = (v: unknown): v is Record<string, unknown> & { items: unknown[] } =>
  isObj(v) && v.contract === AIN_CONTRACT_VERSION && isStr(v.asOf)
  && (v.nextCursor === null || isStr(v.nextCursor)) && Array.isArray(v.items);

export const isFileRef = (v: unknown): v is FileRef =>
  isObj(v) && v.contract === AIN_CONTRACT_VERSION && isStr(v.issuer) && isStr(v.driveId) && isStr(v.fileId)
  && isStr(v.revision) && (v.kind === 'file' || v.kind === 'folder') && isStr(v.displayName)
  && isObj(v.ownerRef) && isObj(v.availability) && isStr(v.availability.state);

export const isAgentRef = (v: unknown): v is AgentRef =>
  isObj(v) && v.contract === AIN_CONTRACT_VERSION && isStr(v.registryIssuer) && isStr(v.agentId)
  && isStr(v.releaseId) && isStr(v.agentCardUrl) && isStr(v.endpoint) && isStr(v.displayName)
  && isStr(v.status) && isObj(v.ownerRef) && Array.isArray(v.skills) && Array.isArray(v.uiCapabilities)
  && Array.isArray(v.supportedProtocolVersions)
  // popJwk 는 선택이지만 있으면 공개 JWK 여야 한다(비밀 스칼라 `d` 가 실려 오면 계약 위반 → 그대로 전달하지 않는다).
  && (v.popJwk === undefined || (isObj(v.popJwk) && isStr(v.popJwk.kty) && !('d' in v.popJwk)));

export const isFileListResponse = (v: unknown): v is FileListResponse =>
  isListEnvelope(v) && v.items.every((i) => isObj(i) && isFileRef(i.ref) && isStr(i.role) && isStr(i.shareOrigin));

export const isAgentListResponse = (v: unknown): v is AgentListResponse =>
  isListEnvelope(v) && v.items.every((i) => isObj(i) && isAgentRef(i.ref) && typeof i.canInvoke === 'boolean');

// ---------------------------------------------------------------------------------------------- 2단계: 호출·이벤트
// 원본: ain-integration/packages/contracts/src/{task,events,a2a-parts,agent-ref(conversationScope),delegation}.ts.
// 마찬가지로 구조만 옮기고 검증은 경계에서 최소한만 한다.

/** A2A task 상태 + 제품이 자체 기록용으로 더하는 `disconnected`. */
export type TaskStatus = 'submitted' | 'working' | 'input_required' | 'completed' | 'failed' | 'canceled' | 'disconnected';

export interface TaskCitation { locator: string; excerpt?: string }

/** 계약 `task-ref`. 토큰·비밀을 절대 담지 않는다. */
export interface TaskRef {
  contract: ContractVersion;
  taskId: string;
  contextId: string;
  /** `agentKey(ref)`. */
  agent: string;
  /** 같은 논리 요청의 재시도는 같은 키를 쓴다(같은 messageId → 노드가 같은 답을 돌려준다). */
  idempotencyKey: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  /** 답변이 읽은 파일과 인용 위치. */
  sources: { file: FileRef; citations: TaskCitation[] }[];
  outputs: { file: FileRef; overwrote: boolean }[];
  error?: ErrorBody['error'];
}

/**
 * 대화 컨텍스트 경계(계획 §4.3): 같은 에이전트라도 `account + org + product + room + conversation` 이
 다르면 메모리를 공유하지 않는다. 제품은 여기서 A2A `contextId` 를 만든다.
 */
export interface ConversationScope {
  account: string;
  org: string | null;
  product: 'ainteams' | 'ainmem' | 'aina' | 'ainspace' | 'afan' | 'aindrive' | 'ainize' | 'reference';
  room: string | null;
  conversation: string;
}

/** 결정적 contextId: 같은 scope → 같은 id. `ctx:<account>:<org|->:<product>:<room|->:<conversation>` (URL 인코딩). */
export const conversationContextId = (s: ConversationScope): string =>
  ['ctx', s.account, s.org ?? '-', s.product, s.room ?? '-', s.conversation].map(encodeURIComponent).join(':');

// A2A data part 의 `metadata.type` (docs/08-agent-delegation.md §3)
export const FILE_REFS_PART_TYPE = 'ai.ain/file-refs';
export const DELEGATION_PART_TYPE = 'ai.ain/delegation';

/** `ai.ain/delegation` part — 에이전트의 PoP 키에 묶인 `ain-rdlg+jwt`. 메시지 밖(응답·로그·저장)으로는 절대 나가지 않는다. */
export interface DelegationPart {
  token: string;
  audience: string[];
  expiresAt: string;
  jti: string;
}

// ---------------------------------------------------------------------------------------------- events

export const FILE_EVENT_TYPES = ['file.shared', 'file.updated', 'file.renamed', 'file.moved', 'file.deleted', 'file.revoked', 'file.availability'] as const;
export const AGENT_EVENT_TYPES = ['agent.published', 'agent.updated', 'agent.unpublished', 'agent.disabled', 'agent.moved', 'agent.deleted', 'agent.revoked'] as const;
export type FileEventType = (typeof FILE_EVENT_TYPES)[number];
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

interface ResourceEventBase {
  eventId: string;
  /** `fileKey()` 또는 `agentKey()`. */
  resourceId: string;
  /** 원본에서 리소스별로 단조 증가. */
  version: number;
  occurredAt: string;
  recipient?: string;
}
export interface FileEvent extends ResourceEventBase { kind: 'file'; type: FileEventType; revision?: string }
export interface AgentEvent extends ResourceEventBase { kind: 'agent'; type: AgentEventType; releaseId?: string }
export type ResourceEvent = FileEvent | AgentEvent;

/** `cursor` 이후의 이벤트 한 페이지. `gap: true` 면 원본이 그만큼 오래된 이벤트를 더는 갖고 있지 않다 → 전체 재목록. */
export interface EventPage {
  contract: ContractVersion;
  events: ResourceEvent[];
  nextCursor: string | null;
  gap: boolean;
}

/** "숨기고 캐시된 바이트·컨텍스트 사용을 멈춰라" 를 뜻하는 이벤트 종류(작업 10). 목록에서는 숨기지 않고 "접근 불가"로 표시한다. */
export const REVOKING_TYPES: ReadonlySet<string> = new Set(['file.deleted', 'file.revoked', 'agent.unpublished', 'agent.disabled', 'agent.deleted', 'agent.revoked']);

export const EVENT_SOURCES = ['aindrive', 'ainize'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

// ---------------------------------------------------------------------------------------------- guards (2단계)

const isTaskStatus = (v: unknown): v is TaskStatus =>
  v === 'submitted' || v === 'working' || v === 'input_required' || v === 'completed' || v === 'failed' || v === 'canceled' || v === 'disconnected';

export const isTaskRef = (v: unknown): v is TaskRef =>
  isObj(v) && v.contract === AIN_CONTRACT_VERSION && isStr(v.taskId) && isStr(v.contextId) && isStr(v.agent)
  && isStr(v.idempotencyKey) && isTaskStatus(v.status) && isStr(v.createdAt) && isStr(v.updatedAt)
  && Array.isArray(v.sources) && v.sources.every((s) => isObj(s) && isFileRef(s.file) && Array.isArray(s.citations))
  && Array.isArray(v.outputs) && v.outputs.every((o) => isObj(o) && isFileRef(o.file) && typeof o.overwrote === 'boolean');

export const isResourceEvent = (v: unknown): v is ResourceEvent =>
  isObj(v) && isStr(v.eventId) && isStr(v.resourceId) && typeof v.version === 'number' && Number.isInteger(v.version) && v.version >= 0
  && isStr(v.occurredAt) && isStr(v.type)
  && ((v.kind === 'file' && (FILE_EVENT_TYPES as readonly string[]).includes(v.type))
    || (v.kind === 'agent' && (AGENT_EVENT_TYPES as readonly string[]).includes(v.type)));

export const isEventPage = (v: unknown): v is EventPage =>
  isObj(v) && v.contract === AIN_CONTRACT_VERSION && Array.isArray(v.events) && v.events.every(isResourceEvent)
  && (v.nextCursor === null || isStr(v.nextCursor)) && typeof v.gap === 'boolean';

/** `issuer#driveId#fileId` → 세 조각. 모양이 아니면 null. */
export function parseFileKey(key: string): { issuer: string; driveId: string; fileId: string } | null {
  const parts = key.split('#');
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  return { issuer: parts[0].replace(/\/+$/, ''), driveId: parts[1], fileId: parts[2] };
}

/** `registryIssuer#agentId` → 두 조각. */
export function parseAgentKey(key: string): { registryIssuer: string; agentId: string } | null {
  const hash = key.indexOf('#');
  if (hash <= 0 || hash === key.length - 1) return null;
  return { registryIssuer: key.slice(0, hash).replace(/\/+$/, ''), agentId: key.slice(hash + 1) };
}
