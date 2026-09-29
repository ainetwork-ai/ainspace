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
  status: AgentStatus;
  displayName: string;
  description?: string;
  updatedAt: string;
}

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

/** 어댑터가 던지는 유일한 오류 타입. 라우트가 `toErrorBody` 로 계약 바디로 바꾼다. */
export class AinContractError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly actionUrl?: string;
  readonly detail?: string;

  constructor(code: ErrorCode, message: string, opts: { status?: number; retryable?: boolean; actionUrl?: string; detail?: string } = {}) {
    super(message);
    this.name = 'AinContractError';
    this.code = code;
    this.status = opts.status ?? HTTP_STATUS_FOR[code];
    this.retryable = opts.retryable ?? RETRYABLE[code];
    this.actionUrl = opts.actionUrl;
    this.detail = opts.detail;
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
  && isStr(v.status) && isObj(v.ownerRef) && Array.isArray(v.skills) && Array.isArray(v.uiCapabilities);

export const isFileListResponse = (v: unknown): v is FileListResponse =>
  isListEnvelope(v) && v.items.every((i) => isObj(i) && isFileRef(i.ref) && isStr(i.role) && isStr(i.shareOrigin));

export const isAgentListResponse = (v: unknown): v is AgentListResponse =>
  isListEnvelope(v) && v.items.every((i) => isObj(i) && isAgentRef(i.ref) && typeof i.canInvoke === 'boolean');
