/**
 * 17.7 기존 자산 → Aindrive 참조 연결(소유자 드라이브로 복사 + fileKey 기록) — 순수 로직, 서버/스크립트 전용.
 * CLI 는 `scripts/ain-asset-link.ts`, 설명은 docs/ain-asset-migration.md "기존 자산 연결".
 *
 * 단계
 *   1) plan(기본, dry-run): Blob·버킷 객체마다 인벤토리 분류(asset-inventory.ts)로 종류를 정하고, **분명한 소유자**를
 *      찾는다. 소유자가 없거나 불분명하면 `refuse`(추측하지 않는다). 소유자의 aindrive 연결이 없으면 `skip`.
 *      이미 연결된 자산도 `skip`(재실행 안전). 나머지는 Aindrive 경로 `/Space assets/<객체 경로>` 로 매핑한다.
 *   2) apply(`--apply`): 소유자의 연결 토큰으로 소유자의 첫 드라이브(채팅 첨부와 같은 기본 폴더)에 쓴다
 *      (aindrive `fs/write`/MCP `write_file`, 부모 폴더는 기기 쪽이 만든다). 대상 경로에 이미 파일이 있으면 크기가
 *      같을 때만 그것을 쓰고(이전 실행이 중간에 멈춘 경우), 다르면 덮어쓰지 않고 실패로 남긴다. 그 다음 자산마다
 *      롤백 항목을 먼저 기록하고, 자산 레코드 옆(`village:<slug>:ain_asset_links` hash, field = 자산 id)에 fileKey 를
 *      적는다. **원본 URL·원본 객체·원래 레코드(tmjUrl 등)는 바꾸지 않는다** — 게임은 계속 원래 URL 을 읽는다.
 *   3) rollback(`--rollback <runId>`): 그 실행의 롤백 항목대로 링크 필드를 이전 값으로 되돌린다(없었으면 지운다).
 *      복사본은 기본으로 남긴다(소유자의 파일이다). `deleteCopies` 이면 이 실행이 **새로 만든** 복사본만, 그리고
 *      크기·mtime 이 기록과 같을 때만(소유자가 고치지 않았을 때만) `delete_path` 로 지운다.
 *
 * 소유자 규칙(분명한 것만)
 *   - 마을 맵·마을 타일셋(`villages/<slug>/…`): 마을 레코드가 있고 `village:<slug>:owner`(검증된 세션으로 기록된
 *     backend 사용자 id)가 있을 때 그 사람. 없으면 refuse.
 *   - 에이전트 스프라이트: `creator` 는 클라이언트가 보낸 지갑 주소라 aindrive 연결의 사용자 id 와 이어지지 않는다 → refuse.
 *   - 타일 업로드(Blob `tiles/`), 공용 타일셋, 버킷·Blob 의 채팅 첨부, 규칙 없는 객체: 누가 올렸는지 기록이 없다 → refuse.
 *
 * 토큰·봉인 값은 결과·로그·롤백 항목 어디에도 싣지 않는다(토큰은 호출 헤더로만).
 */
import { classifyBlobPath, classifyBucketPath } from './asset-inventory';
import { attachmentName, defaultAttachmentFolder, MAX_ATTACHMENT_BYTES } from './chat-attachments';
import { aindriveNormalizePath, entryToFileRef, readMcpResult, type FilesSourceOptions, type FolderEntry } from './files';
import { UPSTREAM_TIMEOUT_MS, fetchUpstream, type FetchLike } from './http';
import type { KvStore } from './kv';
import { writeDriveFile } from './save';
import { AinContractError, fileKey, type ErrorCode, type FileRef } from './types';
import { assetLinksKey, type VillageDirectory } from './village-membership';

export { assetLinksKey };

/** 소유자 드라이브 안에서 옛 자산을 모으는 폴더. */
export const ASSET_LINK_ROOT = 'Space assets';
/** 한 자산의 최대 크기(채팅 첨부와 같은 한도 — base64 로 요청 한 번에 실린다). */
export const MAX_LINK_BYTES = MAX_ATTACHMENT_BYTES;

export const rollbackKey = (runId: string) => `ain:asset_link_rollback:${runId}`;

export interface SourceAsset {
  store: 'blob' | 'bucket';
  /** Blob pathname 또는 버킷 객체 이름. */
  path: string;
  /** 원래 공개 URL — 바꾸지 않고 링크 레코드에 함께 적는다. */
  url: string;
  size?: number | null;
}

export type RefuseReason = 'no_owner' | 'owner_not_account' | 'no_record' | 'too_large' | 'target_conflict';
export type SkipReason = 'owner_not_connected' | 'already_linked';

export interface AssetLinkPlanItem {
  assetId: string;
  asset: SourceAsset;
  kind: string;
  action: 'link' | 'skip' | 'refuse';
  reason?: RefuseReason | SkipReason;
  ownerUserId?: string;
  /** 링크를 적을 Redis hash(자산 레코드 옆). */
  recordKey?: string;
  /** 소유자 드라이브 안의 대상 경로(`/Space assets/...`). */
  targetPath?: string;
}

/** 자산 레코드 옆에 적는 링크. 원래 URL 은 그대로 두고 함께 적는다. */
export interface AssetLink {
  assetId: string;
  originalUrl: string;
  fileKey: string;
  sourceUrl?: string;
  driveId: string;
  path: string;
  revision: string;
  ownerUserId: string;
  linkedAt: string;
  runId: string;
}

/** 자산마다 하나. 링크를 적기 **전에** 기록한다. */
export interface RollbackEntry {
  runId: string;
  assetId: string;
  recordKey: string;
  /** 이 실행 전의 링크 필드 값(JSON 문자열) — 없었으면 null. */
  previous: string | null;
  fileKey: string;
  ownerUserId: string;
  driveId: string;
  path: string;
  /** 이 실행이 aindrive 에 새로 쓴 파일인가(false = 이미 있던 같은 크기의 파일을 썼다). */
  createdCopy: boolean;
  size: number;
  mtimeMs: number | null;
  at: string;
}

export interface AssetLinkPlanDeps {
  kv: Pick<KvStore, 'hGetAll'>;
  villages: Pick<VillageDirectory, 'villageExists' | 'getOwner'>;
  /** 봉인된 연결 레코드가 있고 열리는가(값은 돌려주지 않는다). */
  hasConnection(userId: string): Promise<boolean>;
}

export interface AssetLinkApplyDeps extends AssetLinkPlanDeps {
  kv: KvStore;
  aindriveUrl: string;
  /** 소유자의 연결 토큰. 연결이 없으면 null — 배포 공용 토큰으로 물러서지 않는다(호출자가 보장). */
  getToken(userId: string): Promise<string | null>;
  /** 원본 바이트(Blob 공개 URL / 버킷 객체 다운로드). */
  readSource(asset: SourceAsset): Promise<Uint8Array>;
  runId: string;
  fetch?: FetchLike;
  now?: () => Date;
  /** 롤백 항목을 로컬 파일에도 남긴다(선택). */
  onRollbackEntry?(entry: RollbackEntry): Promise<void> | void;
}

export const assetIdOf = (a: SourceAsset) => `${a.store}:${a.path}`;

const classify = (a: SourceAsset) => (a.store === 'blob' ? classifyBlobPath(a.path) : classifyBucketPath(a.path));

/** 객체 경로 → 소유자 드라이브 안의 경로. 조각마다 파일 이름 규칙(구분자·제어 문자 제거)을 적용한다. */
export function targetPathOf(a: SourceAsset): string {
  const parts = a.path.split('/').filter((s) => s !== '' && s !== '.' && s !== '..').map(attachmentName);
  return aindriveNormalizePath(`/${ASSET_LINK_ROOT}/${a.store === 'blob' ? 'blob/' : ''}${parts.join('/')}`);
}

type OwnerResult = { ok: true; userId: string; recordKey: string } | { ok: false; reason: RefuseReason };

async function resolveOwner(a: SourceAsset, kind: string, d: AssetLinkPlanDeps): Promise<OwnerResult> {
  if (kind === 'village-map' || kind === 'village-tileset') {
    const slug = a.path.split('/')[1];
    if (!slug || !(await d.villages.villageExists(slug))) return { ok: false, reason: 'no_record' };
    const owner = await d.villages.getOwner(slug);
    return owner ? { ok: true, userId: owner, recordKey: assetLinksKey(slug) } : { ok: false, reason: 'no_owner' };
  }
  if (kind === 'agent-sprite') return { ok: false, reason: 'owner_not_account' };
  return { ok: false, reason: 'no_owner' };
}

/** dry-run: 쓰지 않는다(aindrive 호출도 없음). KV 는 링크 hash 와 연결 여부만 본다. */
export interface AssetLinkFilter {
  /** 이 소유자의 자산만(소유자가 없는 거절 항목도 빠진다). */
  ownerUserId?: string;
  /** 이 마을(`villages/<slug>/…`)의 객체만. */
  village?: string;
}

export async function planAssetLinks(assets: SourceAsset[], d: AssetLinkPlanDeps, filter: AssetLinkFilter = {}): Promise<AssetLinkPlanItem[]> {
  const links = new Map<string, Record<string, string>>();
  const connected = new Map<string, boolean>();
  const out: AssetLinkPlanItem[] = [];
  for (const asset of assets) {
    if (filter.village && !(asset.store === 'bucket' && asset.path.startsWith(`villages/${filter.village}/`))) continue;
    const assetId = assetIdOf(asset);
    const kind = classify(asset).kind;
    const base = { assetId, asset, kind };
    const owner = await resolveOwner(asset, kind, d);
    if (!owner.ok) { if (!filter.ownerUserId) out.push({ ...base, action: 'refuse', reason: owner.reason }); continue; }
    if (filter.ownerUserId && owner.userId !== filter.ownerUserId) continue;
    const item = { ...base, ownerUserId: owner.userId, recordKey: owner.recordKey, targetPath: targetPathOf(asset) };
    if (typeof asset.size === 'number' && asset.size > MAX_LINK_BYTES) { out.push({ ...item, action: 'refuse', reason: 'too_large' }); continue; }
    if (!links.has(owner.recordKey)) links.set(owner.recordKey, await d.kv.hGetAll(owner.recordKey));
    if (links.get(owner.recordKey)![assetId]) { out.push({ ...item, action: 'skip', reason: 'already_linked' }); continue; }
    if (!connected.has(owner.userId)) connected.set(owner.userId, await d.hasConnection(owner.userId));
    if (!connected.get(owner.userId)) { out.push({ ...item, action: 'skip', reason: 'owner_not_connected' }); continue; }
    out.push({ ...item, action: 'link' });
  }
  return out;
}

// ------------------------------------------------------------------------------- aindrive stat / delete (MCP)

async function callDriveTool(opts: FilesSourceOptions, driveId: string, name: string, args: Record<string, unknown>) {
  if (!opts.token) throw new AinContractError('auth_required', 'aindrive 계정이 연결되어 있지 않습니다.');
  const issuer = opts.aindriveUrl.replace(/\/+$/, '');
  const res = await fetchUpstream(opts.fetch ?? fetch, `${issuer}/mcp/d/${encodeURIComponent(driveId)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    cache: 'no-store',
  }, { timeoutMs: opts.timeoutMs ?? UPSTREAM_TIMEOUT_MS, target: 'aindrive_mcp' });
  if (!res.ok) {
    const code: ErrorCode = res.status === 401 ? 'auth_required' : res.status === 403 ? 'forbidden' : res.status === 404 ? 'resource_deleted' : res.status >= 500 ? 'source_offline' : 'temporary_failure';
    throw new AinContractError(code, `aindrive ${name} 호출이 실패했습니다.`, { detail: 'aindrive_mcp_http_error', upstreamStatus: res.status });
  }
  const rpc = await readMcpResult(res);
  if (rpc.error || !rpc.result) throw new AinContractError('temporary_failure', `aindrive ${name} 응답을 읽을 수 없습니다.`, { detail: 'aindrive_mcp_error' });
  const result = rpc.result as { isError?: boolean; structuredContent?: unknown; content?: { type: string; text?: string }[] };
  const text = (result.content ?? []).map((c) => c.text ?? '').join(' ');
  return { isError: result.isError === true, text, structured: result.structuredContent };
}

const NOT_FOUND_RE = /^\[not_found\]|ENOENT|no such file|no entry at|does not exist/i;

/** 경로 한 개의 항목(MCP `stat`). 없으면 null. 그 밖의 오류는 던진다(모르는 채로 쓰지 않는다). */
export async function statDrivePath(opts: FilesSourceOptions, driveId: string, path: string): Promise<FolderEntry | null> {
  const abs = aindriveNormalizePath(path);
  const r = await callDriveTool(opts, driveId, 'stat', { path: abs.slice(1) });
  if (r.isError) {
    if (NOT_FOUND_RE.test(r.text)) return null;
    const code: ErrorCode = /^\[forbidden\]|permission|not allowed/i.test(r.text) ? 'forbidden' : /offline|not connected/i.test(r.text) ? 'source_offline' : 'temporary_failure';
    throw new AinContractError(code, '대상 경로를 확인할 수 없습니다.', { detail: 'aindrive_stat_error' });
  }
  const e = (r.structured ?? {}) as Record<string, unknown>;
  const name = typeof e.name === 'string' && e.name ? e.name : abs.split('/').pop()!;
  return {
    name, path: abs, isDir: e.isDir === true,
    size: typeof e.size === 'number' ? e.size : null,
    mtimeMs: typeof e.mtimeMs === 'number' ? e.mtimeMs : null,
    mime: typeof e.mime === 'string' ? e.mime : null,
  };
}

/** MCP `delete_path`(drives:write, 편집자 이상). */
export async function deleteDrivePath(opts: FilesSourceOptions, driveId: string, path: string): Promise<void> {
  const abs = aindriveNormalizePath(path);
  if (abs === '/') throw new AinContractError('unsupported_input', '드라이브 루트는 지울 수 없습니다.');
  const r = await callDriveTool(opts, driveId, 'delete_path', { path: abs.slice(1) });
  if (r.isError && !NOT_FOUND_RE.test(r.text)) throw new AinContractError('temporary_failure', '복사본을 지우지 못했습니다.', { detail: 'aindrive_delete_error' });
}

// ------------------------------------------------------------------------------- apply

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  tmj: 'application/json', json: 'application/json', tsx: 'application/xml', tsj: 'application/json', xml: 'application/xml',
};
const mimeOf = (name: string) => { const m = /\.([A-Za-z0-9]+)$/.exec(name); return (m && MIME_BY_EXT[m[1].toLowerCase()]) || 'application/octet-stream'; };

export interface AssetLinkResult {
  assetId: string;
  outcome: 'linked' | 'reused' | 'skipped' | 'refused' | 'failed';
  reason?: string;
  ownerUserId?: string;
  fileKey?: string;
  targetPath?: string;
}

const errReason = (e: unknown) => (e instanceof AinContractError ? `${e.code}${e.detail ? `:${e.detail}` : ''}` : e instanceof Error ? e.name : 'error');

/**
 * plan 의 `link` 항목만 실행한다. 자산 하나의 실패는 다른 자산을 멈추지 않는다. 같은 소유자의 토큰·기본 폴더는 한 번만
 * 구한다(그 소유자에서 실패하면 그 소유자의 나머지 자산도 같은 이유로 실패로 남긴다).
 */
export async function applyAssetLinks(plan: AssetLinkPlanItem[], d: AssetLinkApplyDeps): Promise<AssetLinkResult[]> {
  const now = () => (d.now ?? (() => new Date()))();
  const owners = new Map<string, Promise<{ files: FilesSourceOptions; root: FileRef } | { error: string }>>();
  const ownerCtx = (userId: string) => {
    if (!owners.has(userId)) {
      owners.set(userId, (async () => {
        try {
          if (!(await d.hasConnection(userId))) return { error: 'owner_not_connected' };
          const token = await d.getToken(userId);
          if (!token) return { error: 'owner_not_connected' };
          const files: FilesSourceOptions = { aindriveUrl: d.aindriveUrl, token, fetch: d.fetch, now: d.now };
          return { files, root: await defaultAttachmentFolder(files) };
        } catch (e) { return { error: errReason(e) }; }
      })());
    }
    return owners.get(userId)!;
  };

  const out: AssetLinkResult[] = [];
  for (const item of plan) {
    const base = { assetId: item.assetId, ownerUserId: item.ownerUserId, targetPath: item.targetPath };
    if (item.action !== 'link') { out.push({ ...base, outcome: item.action === 'skip' ? 'skipped' : 'refused', reason: item.reason }); continue; }
    const userId = item.ownerUserId!; const recordKey = item.recordKey!; const target = item.targetPath!;
    try {
      // 계획과 실행 사이에 다른 실행이 연결했을 수 있다.
      const before = (await d.kv.hGetAll(recordKey))[item.assetId] ?? null;
      if (before) { out.push({ ...base, outcome: 'skipped', reason: 'already_linked' }); continue; }
      const ctx = await ownerCtx(userId);
      if ('error' in ctx) {
        out.push({ ...base, outcome: ctx.error === 'owner_not_connected' ? 'skipped' : 'failed', reason: ctx.error });
        continue;
      }
      const bytes = await d.readSource(item.asset);
      if (bytes.byteLength > MAX_LINK_BYTES) { out.push({ ...base, outcome: 'refused', reason: 'too_large' }); continue; }

      const existing = await statDrivePath(ctx.files, ctx.root.driveId, target);
      let createdCopy = false;
      let meta: { size: number; mtimeMs: number | null };
      if (existing) {
        // 이전 실행이 쓰고 링크를 적기 전에 멈춘 경우만 이어 쓴다. 다른 파일은 덮어쓰지 않는다.
        if (existing.isDir || existing.size !== bytes.byteLength) { out.push({ ...base, outcome: 'refused', reason: 'target_conflict' }); continue; }
        meta = { size: existing.size, mtimeMs: existing.mtimeMs ?? null };
      } else {
        const w = await writeDriveFile(ctx.files, ctx.root.driveId, target, Buffer.from(bytes).toString('base64'), 'base64');
        createdCopy = true;
        meta = { size: w.size ?? bytes.byteLength, mtimeMs: w.mtimeMs ?? null };
      }
      const name = target.split('/').pop()!;
      const ref = entryToFileRef(ctx.root, { name, path: target, isDir: false, size: meta.size, mtimeMs: meta.mtimeMs ?? now().getTime(), mime: mimeOf(name) });
      const key = fileKey(ref);
      const at = now().toISOString();

      const entry: RollbackEntry = {
        runId: d.runId, assetId: item.assetId, recordKey, previous: before, fileKey: key, ownerUserId: userId,
        driveId: ref.driveId, path: target, createdCopy, size: meta.size, mtimeMs: meta.mtimeMs, at,
      };
      await d.kv.hSet(rollbackKey(d.runId), item.assetId, JSON.stringify(entry));
      await d.onRollbackEntry?.(entry);

      const link: AssetLink = {
        assetId: item.assetId, originalUrl: item.asset.url, fileKey: key, sourceUrl: ref.sourceUrl, driveId: ref.driveId, path: target,
        revision: ref.revision, ownerUserId: userId, linkedAt: at, runId: d.runId,
      };
      await d.kv.hSet(recordKey, item.assetId, JSON.stringify(link));
      out.push({ ...base, outcome: createdCopy ? 'linked' : 'reused', fileKey: key });
    } catch (e) {
      out.push({ ...base, outcome: 'failed', reason: errReason(e) });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------- rollback

export interface AssetLinkRollbackDeps {
  kv: KvStore;
  aindriveUrl: string;
  getToken(userId: string): Promise<string | null>;
  fetch?: FetchLike;
  /** 이 실행이 새로 만든 복사본을 지운다(기록과 크기·mtime 이 같을 때만). 기본 false = 남긴다. */
  deleteCopies?: boolean;
}

export interface RollbackResult {
  assetId: string;
  link: 'restored' | 'removed' | 'changed_since';
  copy: 'kept' | 'deleted' | 'kept_modified' | 'already_gone' | 'kept_not_created' | 'kept_error';
}

export async function listRollbackEntries(kv: Pick<KvStore, 'hGetAll'>, runId: string): Promise<RollbackEntry[]> {
  return Object.values(await kv.hGetAll(rollbackKey(runId))).map((v) => JSON.parse(v) as RollbackEntry).sort((a, b) => a.assetId.localeCompare(b.assetId));
}

export async function rollbackAssetLinks(runId: string, d: AssetLinkRollbackDeps): Promise<RollbackResult[]> {
  const out: RollbackResult[] = [];
  for (const e of await listRollbackEntries(d.kv, runId)) {
    const current = (await d.kv.hGetAll(e.recordKey))[e.assetId] ?? null;
    let link: RollbackResult['link'];
    let currentKey: string | null = null;
    try { currentKey = current ? (JSON.parse(current) as AssetLink).fileKey : null; } catch { currentKey = null; }
    if (current === e.previous) link = e.previous ? 'restored' : 'removed'; // 이미 되돌렸다(복사본 삭제만 다시 시도하는 경우)
    else if (currentKey !== e.fileKey) link = 'changed_since'; // 이 실행 뒤에 누가 바꿨다 — 건드리지 않는다
    else if (e.previous) { await d.kv.hSet(e.recordKey, e.assetId, e.previous); link = 'restored'; }
    else { await d.kv.hDel(e.recordKey, e.assetId); link = 'removed'; }

    let copy: RollbackResult['copy'] = e.createdCopy ? 'kept' : 'kept_not_created';
    if (d.deleteCopies && e.createdCopy) {
      try {
        const token = await d.getToken(e.ownerUserId);
        if (!token) copy = 'kept_error';
        else {
          const files: FilesSourceOptions = { aindriveUrl: d.aindriveUrl, token, fetch: d.fetch };
          const now = await statDrivePath(files, e.driveId, e.path);
          if (!now) copy = 'already_gone';
          else if (now.isDir || now.size !== e.size || (e.mtimeMs !== null && now.mtimeMs !== null && now.mtimeMs !== e.mtimeMs)) copy = 'kept_modified';
          else { await deleteDrivePath(files, e.driveId, e.path); copy = 'deleted'; }
        }
      } catch { copy = 'kept_error'; }
    }
    // 복사본을 지우려다 실패했으면 항목을 남겨 다시 돌릴 수 있게 한다.
    if (copy !== 'kept_error') await d.kv.hDel(rollbackKey(runId), e.assetId);
    out.push({ assetId: e.assetId, link, copy });
  }
  return out;
}
