'use client';

import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { AGENT_SCOPE_HEADER, isAinIntegrationEnabledClient } from '@/lib/ain-integration/config';
import { agentKey, type AgentListItem, type AgentListScope, type AgentRef } from '@/lib/ain-integration/types';

/**
 * "공유 에이전트에서 선택" — 에이전트 import 진입점 (어댑터 사양 §제품에 넣을 것 3).
 * `/api/ain/shared-agents` 목록에서 하나를 고르면 기존 import 흐름(`handleImportAgent`)에
 * AgentRef 의 URL 과 commonAgentId(`agentKey`)를 넘긴다. 마을 배치는 그대로 Space 가 한다.
 * 플래그 off 면 아무것도 렌더링하지 않는다.
 */

export interface SharedAgentPick {
  /** 기존 import 흐름에 넣을 URL — Teams 가 이 URL 로 카드를 찾고 a2aUrl 로 식별한다. */
  agentUrl: string;
  /** `"<registryIssuer>#<agentId>"` — StoredAgent.commonAgentId 에 저장된다. */
  commonAgentId: string;
  ref: AgentRef;
}

/** Teams import 는 a2aUrl 을 식별자로 쓰므로 endpoint 를 우선하고, 없을 때만 카드 URL. */
export const agentUrlForImport = (ref: Pick<AgentRef, 'endpoint' | 'agentCardUrl'>): string => ref.endpoint || ref.agentCardUrl;

type Fetcher = (input: string) => Promise<Response>;

interface ListError { message: string; actionUrl?: string }

export interface AgentListLoad {
  items: AgentListItem[];
  asOf: string | null;
  /** 서버가 실제로 물은 범위(`x-ain-agent-scope`). 모르면 null. */
  scope: AgentListScope | null;
  error: ListError | null;
}

const SCOPE_TITLE: Record<AgentListScope, string> = {
  public: '공개 에이전트', shared_with_org: '조직에 공유된 에이전트', shared_with_me: '나에게 공유된 에이전트', mine: '내 에이전트',
};
export const agentListTitle = (scope: AgentListScope | null): string => (scope ? SCOPE_TITLE[scope] : '공유 에이전트');

const isScope = (v: string | null): v is AgentListScope => v === 'public' || v === 'shared_with_org' || v === 'shared_with_me' || v === 'mine';

/**
 * 목록을 불러온다(20.1 결함 B). `scope` 를 주지 않으면 서버가 고른다 — Space 에는 사용자별 Ainize 세션이 없으므로
 * 서버는 조직 키가 있으면 `shared_with_org`, 없으면 `public` 을 묻는다(Teams·Memory 와 같다). 범위를 명시했는데
 * 원본이 401 `auth_required`(연결 안내 없음 = "로그인해야 볼 수 있다")를 주면 기본 범위로 한 번 다시 묻는다.
 */
export async function loadSharedAgents(fetcher: Fetcher, scope?: AgentListScope): Promise<AgentListLoad> {
  const once = async (sc?: AgentListScope): Promise<AgentListLoad & { status: number; code?: string }> => {
    try {
      const res = await fetcher(sc ? `/api/ain/shared-agents?scope=${encodeURIComponent(sc)}` : '/api/ain/shared-agents');
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const e = body?.error as { code?: string; message?: string; actionUrl?: string } | undefined;
        return { status: res.status, code: e?.code, items: [], asOf: null, scope: null, error: { message: e?.message ?? `공유 에이전트 목록을 불러오지 못했습니다 (${res.status})`, ...(e?.actionUrl ? { actionUrl: e.actionUrl } : {}) } };
      }
      const used = res.headers?.get?.(AGENT_SCOPE_HEADER) ?? null;
      return {
        status: res.status,
        items: Array.isArray(body?.items) ? (body.items as AgentListItem[]) : [],
        asOf: typeof body?.asOf === 'string' ? body.asOf : null,
        scope: isScope(used) ? used : (sc ?? null),
        error: null,
      };
    } catch {
      return { status: 0, items: [], asOf: null, scope: null, error: { message: '공유 에이전트 목록을 불러오지 못했습니다.' } };
    }
  };
  const first = await once(scope);
  if (scope && first.status === 401 && first.code === 'auth_required' && !first.error?.actionUrl) {
    const second = await once(undefined);
    return { items: second.items, asOf: second.asOf, scope: second.scope, error: second.error };
  }
  return { items: first.items, asOf: first.asOf, scope: first.scope, error: first.error };
}
const defaultFetcher: Fetcher = (input) => import('@/lib/backend/bff-fetch').then((m) => m.bffAuthFetch(input));

interface SharedAgentPickerProps {
  onPick: (pick: SharedAgentPick) => void;
  disabled?: boolean;
  isDarkMode?: boolean;
  /** 기본은 `NEXT_PUBLIC_AIN_INTEGRATION_ENABLED`. 테스트용 override. */
  enabled?: boolean;
  /** 주지 않으면 서버 기본(조직 키가 있으면 shared_with_org, 없으면 public). */
  scope?: AgentListScope;
  fetcher?: Fetcher;
  /** 진입 버튼 문구. 기본 "공유 에이전트에서 선택". */
  label?: string;
}

export default function SharedAgentPicker({
  onPick,
  disabled = false,
  isDarkMode = false,
  enabled = isAinIntegrationEnabledClient(),
  scope,
  fetcher = defaultFetcher,
  label = '공유 에이전트에서 선택',
}: SharedAgentPickerProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AgentListItem[] | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [usedScope, setUsedScope] = useState<AgentListScope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ListError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await loadSharedAgents(fetcher, scope);
      setItems(r.items);
      setAsOf(r.asOf);
      setUsedScope(r.scope);
      setError(r.error);
    } finally {
      setLoading(false);
    }
  }, [fetcher, scope]);

  if (!enabled) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && items === null) void load();
  };

  const muted = isDarkMode ? 'text-[#CAD0D7]' : 'text-[#838D9D]';

  return (
    <div className="flex flex-col gap-2" data-testid="shared-agent-picker">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        className={cn(
          'w-full rounded-sm border px-3 py-2 text-sm font-semibold disabled:opacity-60',
          isDarkMode ? 'border-[#4A4E56] text-[#C0A9F1] hover:bg-[#3A3050]' : 'border-[#cdd3de] text-[#7F4FE8] hover:bg-[#EAE0FF]'
        )}
      >
        {label} {open ? '▲' : '▼'}
      </button>

      {open && (
        <div className={cn('flex flex-col gap-1 rounded-sm border p-2', isDarkMode ? 'border-[#4A4E56] bg-[#1A1D22]' : 'border-[#E6EAEF] bg-[#f3f4f5]')}>
          <div className={cn('flex items-center justify-between text-xs', muted)}>
            <span>{agentListTitle(usedScope)}{asOf ? ` · 기준 ${new Date(asOf).toLocaleString()}` : ''}</span>
            <button type="button" onClick={() => void load()} disabled={loading} className="underline disabled:opacity-60">
              {loading ? '불러오는 중…' : '새로고침'}
            </button>
          </div>

          {error && (
            <p className="text-xs text-[#B78213]">
              {error.message}
              {error.actionUrl && (
                <> <a href={error.actionUrl} target="_blank" rel="noreferrer" className="underline">연결하기</a></>
              )}
            </p>
          )}

          {!error && items && items.length === 0 && !loading && (
            <p className={cn('py-2 text-center text-xs', muted)}>불러올 에이전트가 없습니다.</p>
          )}

          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {(items ?? []).map(({ ref, canInvoke }) => {
              const pickable = canInvoke && ref.status === 'active' && !disabled;
              return (
                <li key={agentKey(ref)}>
                  <button
                    type="button"
                    disabled={!pickable}
                    onClick={() => onPick({ agentUrl: agentUrlForImport(ref), commonAgentId: agentKey(ref), ref })}
                    className={cn(
                      'flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50',
                      isDarkMode ? 'text-white hover:bg-[#2F333B]' : 'text-black hover:bg-white'
                    )}
                    title={ref.endpoint}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{ref.displayName}</span>
                      <span className={cn('shrink-0 text-[10px]', muted)}>{ref.status}{ref.releaseId ? ` · ${ref.releaseId}` : ''}</span>
                    </span>
                    {ref.description && <span className={cn('line-clamp-2 text-xs', muted)}>{ref.description}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
