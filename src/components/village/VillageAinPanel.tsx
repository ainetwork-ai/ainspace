'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, Landmark, RefreshCw, ShieldAlert, Trash2, UserMinus, UserPlus, X } from 'lucide-react';
import SharedFilePicker, { type SharedFilePick } from '@/components/chat/SharedFilePicker';
import { isAinIntegrationEnabledClient } from '@/lib/ain-integration/config';
import { followActionUrl } from '@/lib/ain-integration/connect-client';
import { fileKey } from '@/lib/ain-integration/types';
import {
  AVAILABILITY_LABEL, addExhibit, addMember, confirmVillageAgent, getExhibition, getMembers, getVillageAgents, removeExhibit, removeMember,
  type ExhibitItem, type ExhibitionView, type MembersView, type VillageAgentItem, type VillageFetcher,
} from '@/lib/ain-integration/village-client';

/**
 * 마을 AIN 패널 — 마을 화면의 "전시" 진입점(17.4)과 마을 소유자용 관리(멤버 17.5, 소유권 변경 재확인 17.3).
 *
 *  - 누구나(로그인): 이 마을의 전시 자료를 **자기 aindrive 기준 가용성**과 함께 본다(삭제됨·볼 수 없음·오프라인·확인 불가).
 *  - 마을 소유자: 기존 "공유 파일" 선택기로 전시 자료를 붙이고 뗀다, 멤버를 넣고 뺀다, 소유자가 바뀐 배치 에이전트를 재확인한다.
 * 플래그 off 거나 마을 밖(slug 없음)·로그아웃이면 렌더링하지 않는다.
 */

const defaultFetcher: VillageFetcher = (input, init) => import('@/lib/backend/bff-fetch').then((m) => m.bffAuthFetch(input, init));

interface VillageAinPanelProps {
  slug: string | null;
  villageName?: string;
  loggedIn: boolean;
  enabled?: boolean;
  fetcher?: VillageFetcher;
  /** 테스트용: 처음부터 열어 둔다. */
  initialOpen?: boolean;
}

const badgeClass = 'ml-auto shrink-0 rounded px-1 text-[10px]';

/** 전시 자료 목록 — 가용성 배지(삭제됨·볼 수 없음·오프라인·확인 불가). 열 수 있는 것만 링크. */
export function ExhibitList({ items, isOwner, busy = false, onRemove }: { items: ExhibitItem[]; isOwner: boolean; busy?: boolean; onRemove?: (fileKey: string) => void }) {
  return (
    <ul className="flex flex-col gap-0.5" data-testid="village-exhibits">
      {items.map((it) => {
        const key = fileKey(it.ref);
        const label = AVAILABILITY_LABEL[it.availability];
        const Icon = it.ref.mimeType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(it.ref.displayName) ? ImageIcon : FileText;
        const openable = it.availability === 'available' && !!it.ref.sourceUrl;
        return (
          <li key={key} className="flex items-center gap-2 rounded px-1 py-1 text-sm" data-availability={it.availability}>
            <Icon className="h-4 w-4 shrink-0" />
            {openable
              ? <a href={it.ref.sourceUrl} target="_blank" rel="noopener noreferrer" className="truncate underline-offset-2 hover:underline">{it.ref.displayName}</a>
              : <span className="truncate opacity-70">{it.ref.displayName}</span>}
            {it.audience === 'members' && <span className={`${badgeClass} bg-[#2F333B] text-[#CAD0D7]`}>멤버</span>}
            {label && <span className={`${badgeClass} ${it.availability === 'deleted' || it.availability === 'forbidden' ? 'bg-[#5A2A2A] text-[#FFB4B4]' : 'bg-[#4A3F1F] text-[#FFB020]'}`}>{label}</span>}
            {isOwner && onRemove && (
              <button type="button" aria-label={`${it.ref.displayName} 전시에서 빼기`} disabled={busy} onClick={() => onRemove(key)} className="shrink-0 disabled:opacity-60">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** 마을 소유자의 멤버 관리 — 목록(소유자 표시), 사용자 id 로 추가, 빼기(소유자 자신은 뺄 수 없다). */
export function MembersSection({ view, busy = false, onAdd, onRemove }: { view: MembersView | null; busy?: boolean; onAdd: (userId: string) => void; onRemove: (userId: string) => void }) {
  const [newMember, setNewMember] = useState('');
  return (
    <section className="flex flex-col gap-1" data-testid="village-members">
      <p className="text-xs text-[#CAD0D7]">멤버</p>
      <ul className="flex flex-col gap-0.5">
        {(view?.members ?? []).map((m) => (
          <li key={m} className="flex items-center gap-2 text-xs">
            <span className="truncate font-mono">{m}</span>
            {m === view?.owner
              ? <span className={`${badgeClass} bg-[#2F333B] text-[#C0A9F1]`}>소유자</span>
              : (
                <button type="button" aria-label={`${m} 멤버에서 빼기`} disabled={busy} onClick={() => onRemove(m)} className="ml-auto shrink-0 disabled:opacity-60">
                  <UserMinus className="h-3.5 w-3.5" />
                </button>
              )}
          </li>
        ))}
      </ul>
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => { e.preventDefault(); const id = newMember.trim(); if (!id) return; setNewMember(''); onAdd(id); }}
      >
        <input
          value={newMember}
          onChange={(e) => setNewMember(e.target.value)}
          placeholder="사용자 id"
          aria-label="추가할 멤버의 사용자 id"
          className="min-w-0 flex-1 rounded bg-[#2F333B] px-2 py-1 text-xs outline-none"
        />
        <button type="submit" disabled={busy || !newMember.trim()} aria-label="멤버 추가" className="rounded bg-[#7F4FE8] p-1 disabled:opacity-60">
          <UserPlus className="h-3.5 w-3.5" />
        </button>
      </form>
    </section>
  );
}

export default function VillageAinPanel({
  slug, villageName, loggedIn, enabled = isAinIntegrationEnabledClient(), fetcher = defaultFetcher, initialOpen = false,
}: VillageAinPanelProps) {
  const [open, setOpen] = useState(initialOpen);
  const [exhibition, setExhibition] = useState<ExhibitionView | null>(null);
  const [members, setMembers] = useState<MembersView | null>(null);
  const [agents, setAgents] = useState<VillageAgentItem[] | null>(null);
  const [error, setError] = useState<{ message: string; actionUrl?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    setBusy(true);
    setError(null);
    const ex = await getExhibition(fetcher, slug);
    if (!ex.ok) { setError({ message: ex.message, actionUrl: ex.actionUrl }); setExhibition(null); setBusy(false); return; }
    setExhibition(ex.data);
    if (ex.data.isOwner) {
      const [m, a] = await Promise.all([getMembers(fetcher, slug), getVillageAgents(fetcher, slug)]);
      setMembers(m.ok ? m.data : null);
      setAgents(a.ok ? a.data.items : null);
    } else {
      setMembers(null);
      setAgents(null);
    }
    setBusy(false);
  }, [fetcher, slug]);

  // 마을이 바뀌면 닫고 비운다(다른 마을의 목록을 보여 주지 않게).
  useEffect(() => { setExhibition(null); setMembers(null); setAgents(null); setError(null); if (!initialOpen) setOpen(false); }, [slug, initialOpen]);
  useEffect(() => { if (open && slug && loggedIn) void load(); }, [open, slug, loggedIn, load]);

  const run = useCallback(async (fn: () => Promise<{ ok: boolean; message?: string; actionUrl?: string }>) => {
    setBusy(true);
    const r = await fn();
    if (!r.ok) setError({ message: r.message ?? '요청에 실패했습니다.', actionUrl: r.actionUrl });
    setBusy(false);
    await load();
  }, [load]);

  const connect = useCallback(async (actionUrl: string) => {
    const message = await followActionUrl(actionUrl, {
      fetcher, navigate: (u) => window.location.assign(u), openTab: (u) => window.open(u, '_blank', 'noopener,noreferrer'), location: window.location,
    });
    if (message) setError({ message });
  }, [fetcher]);

  if (!enabled || !slug || !loggedIn) return null;

  const isOwner = exhibition?.isOwner === true;
  const onPick = (pick: SharedFilePick) => { void run(() => addExhibit(fetcher, slug, fileKey(pick.ref))); };
  const pending = (agents ?? []).filter((a) => a.ownerChange);

  return (
    <div className="pointer-events-auto relative text-white" data-testid="village-ain-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg bg-black/50 px-3 py-1.5 text-xs font-bold backdrop-blur-[6px]"
      >
        <Landmark className="h-4 w-4 text-[#C0A9F1]" />
        <span>전시·마을</span>
        {pending.length > 0 && <span className="rounded-full bg-[#FFB020] px-1.5 text-[10px] text-black">{pending.length}</span>}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 flex max-h-[70vh] w-80 max-w-[calc(100vw-32px)] flex-col gap-3 overflow-y-auto rounded-lg border border-[#4A4E56] bg-[#222529] p-3 shadow-lg">
          <div className="flex items-center justify-between">
            <p className="truncate text-sm font-bold">{villageName || slug}</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void load()} disabled={busy} aria-label="새로고침" className="disabled:opacity-60"><RefreshCw className="h-4 w-4" /></button>
              <button type="button" onClick={() => setOpen(false)} aria-label="닫기"><X className="h-4 w-4" /></button>
            </div>
          </div>

          {error && (
            <p className="text-xs text-[#FFB020]">
              {error.message}
              {error.actionUrl && <> <button type="button" onClick={() => void connect(error.actionUrl!)} className="underline">연결</button></>}
            </p>
          )}

          <section className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs text-[#CAD0D7]">
              <span>전시 자료</span>
              {isOwner && <SharedFilePicker onPick={onPick} disabled={busy} enabled placement="down" />}
            </div>
            {exhibition?.actionUrl && (
              <p className="text-[11px] text-[#CAD0D7]">
                aindrive 를 연결하면 작품을 열 수 있는지 확인할 수 있습니다.{' '}
                <button type="button" onClick={() => void connect(exhibition.actionUrl!)} className="underline">aindrive 연결</button>
              </p>
            )}
            {exhibition && exhibition.items.length === 0 && <p className="py-1 text-center text-xs text-[#CAD0D7]">전시 중인 자료가 없습니다.</p>}
            <ExhibitList items={exhibition?.items ?? []} isOwner={isOwner} busy={busy} onRemove={(key) => void run(() => removeExhibit(fetcher, slug, key))} />
          </section>

          {isOwner && (
            <MembersSection
              view={members}
              busy={busy}
              onAdd={(id) => void run(() => addMember(fetcher, slug, id))}
              onRemove={(id) => void run(() => removeMember(fetcher, slug, id))}
            />
          )}

          {isOwner && pending.length > 0 && (
            <section className="flex flex-col gap-1" data-testid="village-agent-reconfirm">
              <p className="text-xs text-[#CAD0D7]">소유자가 바뀐 에이전트</p>
              {pending.map((a) => (
                <div key={a.url} className="flex items-center gap-2 text-xs">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-[#FFB020]" />
                  <span className="truncate" title={a.ownerChange?.to}>{a.name}</span>
                  <button type="button" disabled={busy} onClick={() => void run(() => confirmVillageAgent(fetcher, slug, a.commonAgentId))} className="ml-auto shrink-0 rounded bg-[#7F4FE8] px-2 py-0.5 disabled:opacity-60">
                    재확인
                  </button>
                </div>
              ))}
              <p className="text-[11px] text-[#CAD0D7]">재확인 전까지 배치는 유지되지만 마을 자료는 넘기지 않습니다. 원하지 않으면 배치를 해제하세요.</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
