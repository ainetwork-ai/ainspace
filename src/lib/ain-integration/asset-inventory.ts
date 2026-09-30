/**
 * 17.7 자산 인벤토리 — 순수 분류 규칙. `scripts/ain-asset-inventory.ts` 가 Redis 키·Vercel Blob·Firebase/GCS 객체의
 * **이름만** 모아 여기서 종류(kind)로 나누고, 종류마다 이관 계획(disposition)을 붙인다. 값(Redis value·객체 바이트)은
 * 읽지 않는다. 비밀을 담는 종류(`secret: true`)는 샘플 이름도 접두어까지만 보인다.
 *
 * 이관 계획(docs/ain-asset-migration.md 와 같은 표):
 *   - stays        : Space 가 계속 원본 — 타일 업로드, 마을 맵/타일셋, 에이전트 스프라이트, 게임 상태.
 *   - reference    : 이미 Aindrive 참조(fileKey·FileRef)만 담는다 — 마을 자료, TaskRef.
 *   - moves        : Aindrive 로 옮긴다 — 채팅 첨부(새 첨부는 사용자의 aindrive 폴더로, 옛 것은 그대로 열린다).
 *   - ephemeral    : 수명이 짧은 상태 — 접속자·heartbeat·OAuth state.
 *   - secret       : 봉인된 자격(연결 토큰) — 옮기지 않고, 값을 읽지 않는다.
 *   - delete-legacy: 더는 읽지 않는 평문 자격 — 지워도 된다(연결을 다시 하면 된다).
 */

export type Disposition = 'stays' | 'reference' | 'moves' | 'ephemeral' | 'secret' | 'delete-legacy' | 'unknown';
export type AssetStore = 'redis' | 'blob' | 'bucket' | 'backend';

export interface AssetKind { kind: string; store: AssetStore; disposition: Disposition; secret?: boolean; note: string }

const K = (kind: string, store: AssetStore, disposition: Disposition, note: string, secret = false): AssetKind => ({ kind, store, disposition, note, ...(secret ? { secret } : {}) });

/** Redis 키 규칙 — 위에서부터 첫 일치. */
const REDIS_RULES: [RegExp, AssetKind][] = [
  [/^ain:aindrive_account:/, K('ain-aindrive-connection', 'redis', 'secret', '봉인된 aindrive 계정 토큰 쌍(AES-GCM)', true)],
  [/^ain:aindrive_oauth_state:/, K('ain-oauth-state', 'redis', 'ephemeral', 'aindrive 연결 state(10분, 봉인)', true)],
  [/^ain:aindrive_token:/, K('legacy-aindrive-token', 'redis', 'delete-legacy', '예전 평문 aindrive 토큰 — 더는 읽지 않음', true)],
  [/^ain:sso_id_token:/, K('legacy-sso-id-token', 'redis', 'delete-legacy', '예전 평문 AIN SSO ID 토큰 — 더는 읽지 않음', true)],
  [/^village:grid:/, K('village-grid', 'redis', 'stays', '격자 → 마을 역인덱스')],
  [/^villages:all$/, K('village-index', 'redis', 'stays', '마을 목록')],
  [/^village:[^:]+:ain_materials$/, K('village-materials', 'redis', 'reference', '마을 자료(Aindrive 참조 + audience)')],
  [/^village:[^:]+:members$/, K('village-members', 'redis', 'stays', '마을 멤버(backend 사용자 id)')],
  [/^village:[^:]+:(players|heartbeat|events)$/, K('village-presence', 'redis', 'ephemeral', '접속자·heartbeat·이벤트')],
  [/^village:[^:]+$/, K('village-metadata', 'redis', 'stays', '마을 메타데이터(맵 URL 등)')],
  [/^user:[^:]+:threads$/, K('chat-threads', 'redis', 'stays', '스레드 목록(본문은 backend)')],
  [/^user:[^:]+:(ain_tasks|ain_task_by_conversation)$/, K('ain-task-refs', 'redis', 'reference', 'TaskRef(토큰 없음)')],
  [/^user:[^:]+:(agent_combos|placed_agents)$/, K('user-agents', 'redis', 'stays', '사용자 에이전트 조합·배치')],
  [/^user:[^:]+$/, K('user-permissions', 'redis', 'stays', '사용자 권한(auth 목록)')],
  [/^auth:/, K('auth-definition', 'redis', 'stays', '권한 정의')],
  [/^agents_sync:/, K('agents-sync', 'redis', 'stays', 'backend 에이전트 동기화 상태')],
  [/^agents:/, K('agents', 'redis', 'stays', '배치된 에이전트')],
  [/^custom-tiles:/, K('custom-tiles', 'redis', 'stays', '사용자 타일 레이어')],
  [/^global-tiles$/, K('global-tiles', 'redis', 'stays', '공용 타일 레이어')],
  [/^orch-thread:/, K('orchestration-thread', 'redis', 'ephemeral', 'A2A 오케스트레이션 스레드 상태')],
];

export function classifyRedisKey(key: string): AssetKind {
  for (const [re, k] of REDIS_RULES) if (re.test(key)) return k;
  return K('unknown', 'redis', 'unknown', '규칙 없음 — 확인 필요');
}

/** Vercel Blob pathname. */
export function classifyBlobPath(pathname: string): AssetKind {
  if (/^tiles\//.test(pathname)) return K('tile-upload', 'blob', 'stays', 'Build 탭 타일 이미지(public)');
  if (/^(chat|attachments)\//.test(pathname)) return K('chat-attachment', 'blob', 'moves', '채팅 첨부 — Aindrive 로');
  return K('unknown', 'blob', 'unknown', '규칙 없음 — 확인 필요');
}

/** Firebase Storage(= GCS) 객체 이름. */
export function classifyBucketPath(name: string): AssetKind {
  if (/^villages\/[^/]+\/map\.tmj$/.test(name)) return K('village-map', 'bucket', 'stays', '마을 맵(TMJ)');
  if (/^villages\/[^/]+\/tilesets\//.test(name)) return K('village-tileset', 'bucket', 'stays', '마을 타일셋');
  if (/^villages\/[^/]+$/.test(name)) return K('shared-tileset', 'bucket', 'stays', '공용 타일셋');
  if (/^[^/]+\/sprites\//.test(name)) return K('agent-sprite', 'bucket', 'stays', '에이전트 스프라이트');
  if (/^(chat|attachments)\//.test(name)) return K('chat-attachment', 'bucket', 'moves', '채팅 첨부 — Aindrive 로');
  return K('unknown', 'bucket', 'unknown', '규칙 없음 — 확인 필요');
}

/** Space 밖(backend)에 있어 이름을 볼 수 없는 자산 — 인벤토리에 한 줄로 남긴다. */
export const EXTERNAL_ASSETS: AssetKind[] = [
  K('chat-attachment-backend', 'backend', 'moves', 'backend `files`(자체호스팅 S3, `/api/files/:id` 프록시) — 옛 첨부는 그대로 열리고 새 첨부는 Aindrive'),
];

export interface InventoryRow extends AssetKind { count: number; bytes: number | null; samples: string[] }

const SAMPLE_LIMIT = 3;

/** 비밀 종류의 샘플은 규칙이 본 접두어까지만(사용자 id 도 숨긴다). */
export const maskSample = (name: string, k: AssetKind) => (k.secret ? `${name.split(':').slice(0, 2).join(':')}:…` : name);

export function summarize(items: { name: string; size?: number | null; kind: AssetKind }[]): InventoryRow[] {
  const rows = new Map<string, InventoryRow>();
  for (const it of items) {
    const id = `${it.kind.store}/${it.kind.kind}`;
    let r = rows.get(id);
    if (!r) { r = { ...it.kind, count: 0, bytes: it.kind.store === 'redis' ? null : 0, samples: [] }; rows.set(id, r); }
    r.count++;
    if (r.bytes !== null && typeof it.size === 'number') r.bytes += it.size;
    const s = maskSample(it.name, it.kind);
    if (r.samples.length < SAMPLE_LIMIT && !r.samples.includes(s)) r.samples.push(s);
  }
  return [...rows.values()].sort((a, b) => a.store.localeCompare(b.store) || a.kind.localeCompare(b.kind));
}
