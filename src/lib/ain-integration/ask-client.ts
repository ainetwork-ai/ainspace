/**
 * 브라우저 쪽 "공유 에이전트에게 묻기" 흐름 (20.1 결함 C) — 마을 채팅에서 공유 에이전트(또는 이 마을에 배치된 에이전트)에게
 * 고른 파일·마을 자료를 넘겨 `POST /api/ain/invoke` 를 부르고, 결과 카드(답 + Sources + 작업 상태)를 그릴 상태를 만든다.
 *
 *  - 차례(turn): "묻기"를 누를 때마다 새 `requestId` 를 만든다. **같은 차례의 재시도는 같은 `requestId`** 를 보낸다 —
 *    서버는 그 값을 Teams 위임(`/api/ain/delegation`, ainteams #1318)에 실어 유료 셈이 차례마다 한 번이 되게 하고,
 *    A2A idempotencyKey 에도 넣어 같은 차례의 재시도가 같은 작업이 된다.
 *  - 취소: 진행 중 요청을 끊는다(AbortController). Space 의 invoke 는 동기(`message/send`)라 서버에 따로 취소할 작업 id 가
 *    아직 없다 — 이미 시작된 원본 작업은 끝까지 갈 수 있고, 카드는 `canceled` 로 남는다(결과는 버린다).
 *  - 원본 열기 링크는 http(s) `sourceUrl` 만 쓴다(그 밖은 글자로만).
 *
 * 모든 호출은 주입한 fetcher(기본 `bffAuthFetch` — 세션 bearer 를 헤더로)로 같은 오리진 라우트만 부른다. 토큰을 다루지 않는다.
 */
import type { ErrorCode, FileRef, TaskRef, TaskStatus } from './types';
import { fileKey } from './types';

export type AskFetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** 물을 에이전트. `placedIn` 이 있으면 그 마을에 배치된 에이전트(마을 자료를 넘길 수 있다). */
export interface AskTarget { agentKey: string; name: string; placedIn?: string | null }

export interface AskInput {
  target: AskTarget;
  text: string;
  files: FileRef[];
  conversation: string;
  /** 지금 있는 마을 slug. */
  room?: string | null;
  /** 이 마을의 에이전트용 자료(public·agent)를 함께 넘긴다 — 배치된 에이전트에게만. */
  villageMaterials?: boolean;
}

export interface InvokeBody {
  agentKey: string;
  text: string;
  fileKeys: string[];
  conversation: string;
  requestId: string;
  room?: string;
  villageMaterials?: true;
}

export type AskPhase = 'pending' | TaskStatus;

export interface AskTurn {
  requestId: string;
  target: AskTarget;
  question: string;
  body: InvokeBody;
  phase: AskPhase;
  task?: TaskRef;
  text?: string;
  error?: { code: ErrorCode | 'canceled' | 'network'; message: string; retryable: boolean; actionUrl?: string };
}

const uuid = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

/** 한 차례의 id — invoke 의 `requestId` 모양(영숫자·._:-, 128자 이하). */
export const newTurnId = (): string => `turn_${uuid()}`;
/** 묻기 대화 id — 패널이 열려 있는 동안 이어진다(같은 contextId). 공백·슬래시 없음. */
export const newAskConversationId = (): string => `ask_${uuid()}`;

/** 마을 자료는 지금 있는 마을에 배치된 에이전트에게만 넘길 수 있다(서버도 다시 확인한다). */
export const canUseVillageMaterials = (target: AskTarget | null, room: string | null | undefined): boolean =>
  !!target && !!room && target.placedIn === room;

export function buildInvokeBody(input: AskInput, requestId: string): InvokeBody {
  const room = input.room || undefined;
  const materials = !!input.villageMaterials && canUseVillageMaterials(input.target, room);
  return {
    agentKey: input.target.agentKey,
    text: input.text.trim(),
    fileKeys: [...new Set(input.files.map(fileKey))],
    conversation: input.conversation,
    requestId,
    ...(room ? { room } : {}),
    ...(materials ? { villageMaterials: true as const } : {}),
  };
}

/** 새 차례 — 새 requestId, 상태 pending. */
export function startTurn(input: AskInput, requestId: string = newTurnId()): AskTurn {
  return { requestId, target: input.target, question: input.text.trim(), body: buildInvokeBody(input, requestId), phase: 'pending' };
}

/** 같은 차례를 다시 — **같은 requestId·같은 바디**, 결과만 지운다. */
export const retryTurn = (turn: AskTurn): AskTurn => ({ requestId: turn.requestId, target: turn.target, question: turn.question, body: turn.body, phase: 'pending' });

export const isAbortError = (e: unknown): boolean =>
  !!e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError';

/** `POST /api/ain/invoke` 한 번 → 끝난 차례. 던지지 않는다. */
export async function runTurn(fetcher: AskFetcher, turn: AskTurn, signal?: AbortSignal): Promise<AskTurn> {
  try {
    const res = await fetcher('/api/ain/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(turn.body),
      ...(signal ? { signal } : {}),
    });
    const json = await res.json().catch(() => null) as { task?: TaskRef; text?: unknown; error?: { code?: ErrorCode; message?: string; retryable?: boolean; actionUrl?: string } } | null;
    if (signal?.aborted) return cancelTurn(turn);
    if (!res.ok || !json?.task) {
      const e = json?.error;
      return {
        ...turn, phase: 'failed',
        error: {
          code: e?.code ?? 'temporary_failure',
          message: e?.message ?? `에이전트를 부르지 못했습니다 (${res.status})`,
          retryable: e?.retryable ?? res.status >= 500,
          ...(e?.actionUrl && isHttpUrl(e.actionUrl) ? { actionUrl: e.actionUrl } : {}),
        },
      };
    }
    const task = json.task;
    const text = typeof json.text === 'string' ? json.text : '';
    return {
      ...turn, phase: task.status, task, text,
      ...(task.error ? { error: { code: task.error.code, message: task.error.message, retryable: task.error.retryable, ...(task.error.actionUrl && isHttpUrl(task.error.actionUrl) ? { actionUrl: task.error.actionUrl } : {}) } } : {}),
    };
  } catch (e) {
    if (isAbortError(e) || signal?.aborted) return cancelTurn(turn);
    return { ...turn, phase: 'failed', error: { code: 'network', message: '서버에 연결할 수 없습니다.', retryable: true } };
  }
}

export const cancelTurn = (turn: AskTurn): AskTurn => ({
  ...turn, phase: 'canceled',
  error: { code: 'canceled', message: '요청을 취소했습니다. 이미 시작된 에이전트 작업은 끝까지 갈 수 있지만 결과는 표시하지 않습니다.', retryable: true },
});

export const isActive = (turn: AskTurn): boolean => turn.phase === 'pending' || turn.phase === 'submitted' || turn.phase === 'working';

export const STATUS_LABEL: Record<AskPhase, string> = {
  pending: '요청 중', submitted: '접수됨', working: '작업 중', input_required: '입력 필요', completed: '완료', failed: '실패', canceled: '취소됨', disconnected: '연결 끊김',
};

export function isHttpUrl(v: string | undefined | null): v is string {
  if (!v) return false;
  try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
}

export interface SourceItem { key: string; name: string; href: string | null; citations: string[] }

/** 결과 카드의 Sources — 파일 이름, 원본 열기 링크(http(s)만), 인용 위치. */
export function sourceItems(task: TaskRef | undefined): SourceItem[] {
  if (!task) return [];
  return task.sources.map(({ file, citations }) => ({
    key: fileKey(file),
    name: file.displayName,
    href: isHttpUrl(file.sourceUrl) ? file.sourceUrl : null,
    citations: (citations ?? []).map((c) => (c.excerpt ? `${c.locator} — ${c.excerpt}` : c.locator)),
  }));
}

/**
 * 이 마을에 배치된 공유 에이전트 → 묻기 대상. `commonAgentId` 가 있는(공유 목록에서 가져온) 에이전트만, agentKey 로 중복 제거.
 * 마을 밖(slug 없음)이면 빈 목록.
 */
export function placedAskTargets(agents: { name: string; commonAgentId?: string; mapName?: string | null }[], slug: string | null): AskTarget[] {
  if (!slug) return [];
  const out = new Map<string, AskTarget>();
  for (const a of agents) {
    if (!a.commonAgentId || a.mapName !== slug || out.has(a.commonAgentId)) continue;
    out.set(a.commonAgentId, { agentKey: a.commonAgentId, name: a.name, placedIn: slug });
  }
  return [...out.values()];
}
