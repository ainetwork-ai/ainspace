'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, ExternalLink, FileText, RotateCcw, Square, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import SharedAgentPicker, { type SharedAgentPick } from '@/components/agent-builder/SharedAgentPicker';
import SharedFilePicker, { type SharedFilePick } from '@/components/chat/SharedFilePicker';
import { isAinIntegrationEnabledClient } from '@/lib/ain-integration/config';
import { followActionUrl } from '@/lib/ain-integration/connect-client';
import {
  STATUS_LABEL, canUseVillageMaterials, cancelTurn, isActive, newAskConversationId, retryTurn, runTurn, sourceItems, startTurn,
  type AskFetcher, type AskTarget, type AskTurn,
} from '@/lib/ain-integration/ask-client';
import { fileKey, type FileRef } from '@/lib/ain-integration/types';

/**
 * 마을 채팅의 "공유 에이전트에게 묻기" (20.1 결함 C).
 *
 * 공유 에이전트(목록에서) 또는 이 마을에 배치된 공유 에이전트를 고르고, 선택으로 공유 파일·이 마을의 자료를 붙여
 * `POST /api/ain/invoke` 를 부른다 → 결과 카드: 작업 상태(요청 중·완료·실패·취소됨…), 답, **Sources**(원본 열기),
 * 진행 중이면 취소, 실패·취소면 같은 차례로 다시 시도. 차례마다 새 `requestId`, 재시도는 같은 값(ask-client.ts).
 * Space 에는 AIN-UI 가 들어와 있지 않아 기존 채팅 카드 스타일로 그린다.
 * 플래그 off·로그아웃이면 렌더링하지 않는다.
 */

const defaultFetcher: AskFetcher = (input, init) => import('@/lib/backend/bff-fetch').then((m) => m.bffAuthFetch(input, init));

const PHASE_CLASS: Record<string, string> = {
  completed: 'bg-[#1F4A33] text-[#8FE3B0]',
  failed: 'bg-[#5A2A2A] text-[#FFB4B4]',
  canceled: 'bg-[#2F333B] text-[#CAD0D7]',
  input_required: 'bg-[#4A3F1F] text-[#FFB020]',
  disconnected: 'bg-[#4A3F1F] text-[#FFB020]',
};

interface ResultCardProps {
  turn: AskTurn;
  onCancel?: () => void;
  onRetry?: () => void;
  onConnect?: (actionUrl: string) => void;
}

/** 결과 카드 — 상태, 질문, 답, Sources(원본 열기), 저장된 파일, 오류(연결 안내), 취소·다시 시도. */
export function AskResultCard({ turn, onCancel, onRetry, onConnect }: ResultCardProps) {
  const sources = sourceItems(turn.task);
  const active = isActive(turn);
  const outputs = turn.task?.outputs ?? [];
  return (
    <article
      className="flex flex-col gap-2 rounded-lg border border-[#4A4E56] bg-[#1A1D22] p-3 text-sm text-white"
      data-testid="ask-result-card"
      data-status={turn.phase}
      data-request-id={turn.requestId}
    >
      <header className="flex items-center gap-2">
        <Bot className="h-4 w-4 shrink-0 text-[#C0A9F1]" />
        <span className="truncate font-semibold">{turn.target.name}</span>
        <span className={cn('ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px]', PHASE_CLASS[turn.phase] ?? 'bg-[#2A3550] text-[#9CC3FF]')} data-testid="ask-status">
          {STATUS_LABEL[turn.phase]}
        </span>
      </header>
      <p className="text-xs text-[#CAD0D7]">Q. {turn.question}</p>

      {turn.text ? <div className="whitespace-pre-wrap break-words leading-5" data-testid="ask-answer">{turn.text}</div> : null}

      {sources.length > 0 && (
        <section className="flex flex-col gap-1" data-testid="ask-sources">
          <p className="text-xs font-semibold text-[#CAD0D7]">Sources</p>
          <ul className="flex flex-col gap-1">
            {sources.map((s) => (
              <li key={s.key} className="flex flex-col gap-0.5 text-xs">
                <span className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{s.name}</span>
                  {s.href && (
                    <a href={s.href} target="_blank" rel="noopener noreferrer" className="ml-auto flex shrink-0 items-center gap-0.5 text-[#C0A9F1] underline-offset-2 hover:underline">
                      원본 열기 <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </span>
                {s.citations.map((c, i) => <span key={i} className="pl-5 text-[#838D9D]">{c}</span>)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {outputs.length > 0 && (
        <p className="text-xs text-[#CAD0D7]">
          저장됨: {outputs.map((o) => o.file.displayName).join(', ')}
        </p>
      )}

      {turn.error && (
        <p className={cn('text-xs', turn.phase === 'canceled' ? 'text-[#CAD0D7]' : 'text-[#FFB020]')} data-testid="ask-error">
          {turn.error.message}
          {turn.error.actionUrl && onConnect && (
            <> <button type="button" className="underline" onClick={() => onConnect(turn.error!.actionUrl!)}>연결하기</button></>
          )}
        </p>
      )}

      {(active || (turn.error?.retryable && !active)) && (
        <footer className="flex gap-2">
          {active && onCancel && (
            <button type="button" onClick={onCancel} className="flex items-center gap-1 rounded border border-[#4A4E56] px-2 py-0.5 text-xs">
              <Square className="h-3 w-3" /> 취소
            </button>
          )}
          {!active && turn.error?.retryable && onRetry && (
            <button type="button" onClick={onRetry} className="flex items-center gap-1 rounded border border-[#4A4E56] px-2 py-0.5 text-xs">
              <RotateCcw className="h-3 w-3" /> 다시 시도
            </button>
          )}
        </footer>
      )}
    </article>
  );
}

interface AskSharedAgentPanelProps {
  /** 지금 있는 마을 slug(마을 밖이면 null). */
  slug: string | null;
  /** 이 마을에 배치된, 공유 에이전트 id(commonAgentId)가 있는 에이전트. */
  placedAgents: AskTarget[];
  loggedIn: boolean;
  enabled?: boolean;
  fetcher?: AskFetcher;
  /** 테스트용. */
  initialOpen?: boolean;
  initialTurns?: AskTurn[];
  initialTarget?: AskTarget | null;
}

export default function AskSharedAgentPanel({
  slug,
  placedAgents,
  loggedIn,
  enabled = isAinIntegrationEnabledClient(),
  fetcher = defaultFetcher,
  initialOpen = false,
  initialTurns = [],
  initialTarget = null,
}: AskSharedAgentPanelProps) {
  const [open, setOpen] = useState(initialOpen);
  const [target, setTarget] = useState<AskTarget | null>(initialTarget);
  const [files, setFiles] = useState<FileRef[]>([]);
  const [materials, setMaterials] = useState(false);
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<AskTurn[]>(initialTurns);
  const [notice, setNotice] = useState<string | null>(null);
  const [conversation, setConversation] = useState<string>(() => newAskConversationId());
  const controllers = useRef(new Map<string, AbortController>());

  // 마을을 옮기면 대화를 새로 시작한다(다른 방의 문맥이 섞이지 않게). 진행 중 요청은 끊는다.
  useEffect(() => {
    setConversation(newAskConversationId());
    setMaterials(false);
    setTarget((t) => (t?.placedIn && t.placedIn !== slug ? null : t));
  }, [slug]);
  useEffect(() => {
    const map = controllers.current;
    return () => { for (const c of map.values()) c.abort(); map.clear(); };
  }, []);

  const replace = (next: AskTurn) => setTurns((ts) => ts.map((t) => (t.requestId === next.requestId ? next : t)));

  const execute = useCallback(async (turn: AskTurn) => {
    controllers.current.get(turn.requestId)?.abort();
    const ctl = new AbortController();
    controllers.current.set(turn.requestId, ctl);
    const done = await runTurn(fetcher, turn, ctl.signal);
    if (controllers.current.get(turn.requestId) === ctl) controllers.current.delete(turn.requestId);
    // 취소 뒤에 도착한 응답은 버린다(카드는 canceled 로 남는다).
    if (ctl.signal.aborted && done.phase !== 'canceled') return;
    replace(done);
  }, [fetcher]);

  const ask = () => {
    if (!target || !text.trim()) return;
    const turn = startTurn({ target, text, files, conversation, room: slug, villageMaterials: materials });
    setTurns((ts) => [...ts, turn]);
    setText('');
    void execute(turn);
  };

  const cancel = (turn: AskTurn) => {
    controllers.current.get(turn.requestId)?.abort();
    controllers.current.delete(turn.requestId);
    replace(cancelTurn(turn));
  };

  const retry = (turn: AskTurn) => {
    const again = retryTurn(turn);
    replace(again);
    void execute(again);
  };

  const connect = useCallback(async (actionUrl: string) => {
    const message = await followActionUrl(actionUrl, {
      fetcher,
      navigate: (u) => window.location.assign(u),
      openTab: (u) => window.open(u, '_blank', 'noopener,noreferrer'),
      location: window.location,
    });
    if (message) setNotice(message);
  }, [fetcher]);

  const pickShared = ({ commonAgentId, ref }: SharedAgentPick) => {
    const placed = placedAgents.find((a) => a.agentKey === commonAgentId);
    setTarget({ agentKey: commonAgentId, name: ref.displayName, placedIn: placed?.placedIn ?? null });
  };

  const addFile = ({ ref }: SharedFilePick) => {
    setFiles((fs) => (fs.some((f) => fileKey(f) === fileKey(ref)) ? fs : [...fs, ref]));
  };

  if (!enabled || !loggedIn) return null;

  const materialsAllowed = canUseVillageMaterials(target, slug);
  const busy = turns.some(isActive);

  return (
    <div className="flex flex-col gap-2 px-3 pb-2" data-testid="ask-shared-agent-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="self-start rounded-full border border-[#4A4E56] bg-black/30 px-3 py-1 text-xs font-semibold text-[#C0A9F1]"
        aria-expanded={open}
      >
        공유 에이전트에게 묻기 {open ? '▲' : '▼'}
      </button>

      {turns.length > 0 && (
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto" data-testid="ask-results">
          {turns.map((t) => (
            <AskResultCard key={t.requestId} turn={t} onCancel={() => cancel(t)} onRetry={() => retry(t)} onConnect={(u) => void connect(u)} />
          ))}
        </div>
      )}

      {open && (
        <div className="flex flex-col gap-2 rounded-lg border border-[#4A4E56] bg-[#222529] p-3 text-sm text-white" data-testid="ask-form">
          <section className="flex flex-col gap-1">
            <p className="text-xs text-[#CAD0D7]">에이전트</p>
            {placedAgents.length > 0 && (
              <ul className="flex flex-wrap gap-1" data-testid="ask-placed-agents">
                {placedAgents.map((a) => (
                  <li key={a.agentKey}>
                    <button
                      type="button"
                      onClick={() => setTarget(a)}
                      aria-pressed={target?.agentKey === a.agentKey}
                      className={cn('rounded-full border px-2 py-0.5 text-xs', target?.agentKey === a.agentKey ? 'border-[#7F4FE8] bg-[#3A3050]' : 'border-[#4A4E56]')}
                    >
                      {a.name} <span className="text-[10px] text-[#838D9D]">이 마을</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <SharedAgentPicker onPick={pickShared} isDarkMode enabled label="다른 공유 에이전트 고르기" />
            {target && <p className="text-xs" data-testid="ask-target">선택: <span className="font-semibold">{target.name}</span></p>}
          </section>

          <section className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <p className="text-xs text-[#CAD0D7]">함께 넘길 파일(선택)</p>
              <SharedFilePicker onPick={addFile} enabled placement="down" fetcher={fetcher} />
            </div>
            {files.length > 0 && (
              <ul className="flex flex-wrap gap-1" data-testid="ask-files">
                {files.map((f) => (
                  <li key={fileKey(f)} className="flex items-center gap-1 rounded-full bg-[#2F333B] px-2 py-0.5 text-xs">
                    <FileText className="h-3 w-3" /> <span className="max-w-[10rem] truncate">{f.displayName}</span>
                    <button type="button" aria-label={`${f.displayName} 빼기`} onClick={() => setFiles((fs) => fs.filter((x) => fileKey(x) !== fileKey(f)))}>
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {slug && (
              <label className={cn('flex items-center gap-1.5 text-xs', !materialsAllowed && 'opacity-50')}>
                <input type="checkbox" checked={materials && materialsAllowed} disabled={!materialsAllowed} onChange={(e) => setMaterials(e.target.checked)} />
                이 마을의 자료도 넘기기
                {!materialsAllowed && <span className="text-[10px] text-[#838D9D]">(이 마을에 배치된 에이전트만)</span>}
              </label>
            )}
          </section>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="무엇을 물을까요?"
            rows={2}
            className="w-full resize-none rounded bg-black/30 p-2 text-sm text-white placeholder:text-[#FFFFFF66]"
          />
          {notice && <p className="text-xs text-[#FFB020]">{notice}</p>}
          <button
            type="button"
            onClick={ask}
            disabled={!target || !text.trim() || busy}
            className="self-end rounded bg-[#7F4FE8] px-3 py-1 text-xs font-semibold disabled:opacity-50"
          >
            묻기
          </button>
        </div>
      )}
    </div>
  );
}
