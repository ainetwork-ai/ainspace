/**
 * aindrive → "나에게 공유된 파일" 어댑터 (어댑터 사양 §원본 호출·파일).
 *
 * 우선: `GET {AINDRIVE_URL}/api/oauth/shared?scope&q&cursor&limit` (Bearer `aind_aat_…` 계정 토큰,
 * scope drives:read) — 계약 모양을 그대로 돌려준다.
 * 404 이면 fallback: `GET /api/oauth/drives` → `{drives:[{id,name,online,role}]}` 를 드라이브 루트
 * 폴더 ref 로 변환한다. fallback 은 `mine` 과 그 외를 `role === 'owner'` 로만 가르고 `recent` 가 없다
 * (reference client 와 같은 규칙).
 *
 * 순수 함수 + fetch 주입. 토큰은 헤더로만 나가고 응답·로그·오류 메시지에 절대 싣지 않는다.
 */
import { createHash } from 'node:crypto';
import { UPSTREAM_TIMEOUT_MS, fetchUpstream, getJson, getNativeSupport, isNotFound, paginate, qs, setNativeSupport, type FetchLike } from './http';
import {
  AIN_CONTRACT_VERSION, AinContractError, fileKey, isFileListResponse,
  type ErrorCode, type FileAccessRole, type FileListItem, type FileListRequest, type FileListResponse, type FileListScope, type FileRef, type OwnerRef,
} from './types';

export interface OauthDrive { id: string; name: string; online: boolean; role: 'owner' | 'editor' | 'viewer' | string }

export interface FilesSourceOptions {
  /** aindrive 오리진 (issuer). */
  aindriveUrl: string;
  /** 이 사용자의 aindrive 계정 토큰. 없으면 `auth_required` + `connectUrl`. */
  token: string | null;
  /** `auth_required` 의 actionUrl. */
  connectUrl?: string;
  fetch?: FetchLike;
  /** 소유 드라이브의 ownerRef 로 쓸 "나". 없으면 principal `me`. */
  me?: OwnerRef;
  now?: () => Date;
  /** 원본 호출(목록·MCP list_files) 타임아웃(기본 UPSTREAM_TIMEOUT_MS). */
  timeoutMs?: number;
}

// ------------------------------------------------------------------------------- stable id (phase A)
// aindrive 에 아직 파일 id 가 없어 경로 해시로 만든다: "p1:" + sha256(driveId + "\0" + normalizedPath)[0..32].
// rename/move 에 바뀌는 것이 알려진 한계이며 `legacy.path` 가 그 사실을 말해 준다.

export const AINDRIVE_PATH_ID_PREFIX = 'p1:';

/** aindrive 의 normalizePath: 슬래시 통일, '.'·빈 조각 제거, NFC, 대소문자 유지. */
export function aindriveNormalizePath(p: string): string {
  const parts = p.replace(/\\/g, '/').normalize('NFC').split('/').filter((s) => s !== '' && s !== '.');
  return '/' + parts.join('/');
}

export function aindriveFileId(driveId: string, path: string): string {
  return AINDRIVE_PATH_ID_PREFIX + createHash('sha256').update(driveId + '\0' + aindriveNormalizePath(path)).digest('hex').slice(0, 32);
}

/** mtime·size 로 만든 약한 revision `m<ms>-s<bytes>`. 드라이브 루트는 둘 다 없어 `m0-s0`. 원본의 mtimeMs 는 소수일 수 있어 ms 로 반올림한다. */
export const aindriveRevision = (e: { mtimeMs?: number | null; size?: number | null }) => `m${Math.round(e.mtimeMs ?? 0)}-s${e.size ?? 0}`;

/** 드라이브 한 줄 → 그 루트 폴더의 FileListItem (fallback 변환). */
export function driveToFolderItem(issuer: string, d: OauthDrive, me?: OwnerRef): FileListItem {
  const isOwner = d.role === 'owner';
  const path = '/';
  const ownerRef: OwnerRef = isOwner
    ? (me ?? { kind: 'principal', issuer, subject: 'me' })
    : { kind: 'principal', issuer, subject: `drive-owner:${d.id}` };
  const ref: FileRef = {
    contract: AIN_CONTRACT_VERSION,
    issuer,
    driveId: d.id,
    fileId: aindriveFileId(d.id, path),
    revision: aindriveRevision({}),
    kind: 'folder',
    displayName: d.name,
    ownerRef,
    availability: { state: d.online ? 'online' : 'offline' },
    sourceUrl: `${issuer}/d/${encodeURIComponent(d.id)}/`,
    legacy: { path },
  };
  const role: FileAccessRole = d.role === 'owner' || d.role === 'editor' || d.role === 'viewer' ? d.role : 'none';
  return { ref, role, shareOrigin: isOwner ? 'own' : 'direct' };
}

// ------------------------------------------------------------------------------- listing

const CREDENTIAL_QUERY_RE = /(token|signature|sig|key)=/i;

/** 네이티브 응답이라도 sourceUrl 에 자격증명이 실려 오면 그 URL 만 뗀다(계약 refine 과 동일). */
function sanitizeNative(res: FileListResponse): FileListResponse {
  return {
    ...res,
    items: res.items.map((i) => {
      if (!i.ref.sourceUrl || !CREDENTIAL_QUERY_RE.test(i.ref.sourceUrl)) return i;
      const { sourceUrl: _dropped, ...ref } = i.ref;
      void _dropped;
      return { ...i, ref };
    }),
  };
}

export async function listSharedFiles(opts: FilesSourceOptions, req: FileListRequest): Promise<FileListResponse> {
  if (!opts.token) {
    throw new AinContractError('auth_required', 'aindrive 계정이 연결되어 있지 않습니다. 연결하면 공유 파일을 볼 수 있습니다.', {
      ...(opts.connectUrl ? { actionUrl: opts.connectUrl } : {}),
    });
  }
  const f = opts.fetch ?? fetch;
  const headers = { authorization: `Bearer ${opts.token}` };
  const issuer = opts.aindriveUrl.replace(/\/+$/, '');
  const nativeKey = `files:${issuer}`;

  if (getNativeSupport(nativeKey) !== false) {
    try {
      const r = await getJson<unknown>(f, `${issuer}/api/oauth/shared${qs({ scope: req.scope, q: req.q, cursor: req.cursor, limit: req.limit, org: req.org, folder: req.folder })}`, headers, { timeoutMs: opts.timeoutMs, target: 'aindrive' });
      if (isFileListResponse(r)) { setNativeSupport(nativeKey, true); return sanitizeNative(r); }
      setNativeSupport(nativeKey, false);
    } catch (e) {
      if (isNotFound(e)) setNativeSupport(nativeKey, false); else throw e;
    }
  }
  return listFromDrives(f, issuer, headers, req, opts);
}

async function listFromDrives(f: FetchLike, issuer: string, headers: Record<string, string>, req: FileListRequest, opts: FilesSourceOptions): Promise<FileListResponse> {
  const asOf = (opts.now ?? (() => new Date()))().toISOString();
  if (req.scope === 'shared_with_org') return { contract: AIN_CONTRACT_VERSION, asOf, nextCursor: null, items: [] };
  const r = await getJson<{ drives?: OauthDrive[] }>(f, `${issuer}/api/oauth/drives`, headers, { timeoutMs: opts.timeoutMs, target: 'aindrive' });
  let items = (r.drives ?? [])
    .filter((d) => (req.scope === 'mine' ? d.role === 'owner' : d.role !== 'owner'))
    .map((d) => driveToFolderItem(issuer, d, opts.me));
  if (req.q) { const q = req.q.toLowerCase(); items = items.filter((i) => i.ref.displayName.toLowerCase().includes(q)); }
  const { page, nextCursor } = paginate(items, req.cursor, req.limit);
  return { contract: AIN_CONTRACT_VERSION, asOf, nextCursor, items: page };
}

const LIST_PAGE_LIMIT = 200;
const LIST_MAX_PAGES = 5;

/** 1단계 목록을 범위 순서대로 모두 모은다. 같은 fileKey 가 두 범위에 있으면 먼저 본 것이 남는다. */
export async function collectListedFiles(opts: FilesSourceOptions, scopes: readonly FileListScope[]): Promise<Map<string, FileRef>> {
  const byKey = new Map<string, FileRef>();
  for (const scope of scopes) {
    let cursor: string | undefined;
    for (let page = 0; page < LIST_MAX_PAGES; page++) {
      const res = await listSharedFiles(opts, { scope, limit: LIST_PAGE_LIMIT, ...(cursor ? { cursor } : {}) });
      for (const i of res.items) { const k = fileKey(i.ref); if (!byKey.has(k)) byKey.set(k, i.ref); }
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
  }
  return byKey;
}

// ------------------------------------------------------------------------------- folder browsing
// 공유 목록은 공유의 "뿌리"(보통 드라이브 루트 폴더)만 돌려준다. 그 안의 파일을 고르려면 폴더를 탐색해야
// 하는데, aindrive 의 `fs/list` 는 세션·위임만 받고 계정 토큰(aind_aat_)은 거절한다. 계정 토큰으로 열리는
// 것은 드라이브 MCP 엔드포인트(`POST /mcp/d/{driveId}`, stateless Streamable HTTP)의 `list_files` 도구다.
// 항목 모양은 fs/list 와 같다: `{ name, path, isDir, size, mtimeMs, mime }`.

export interface FolderEntry { name: string; path: string; isDir: boolean; size?: number | null; mtimeMs?: number | null; mime?: string | null }

/** MCP 응답은 `text/event-stream`(data: 한 줄) 또는 JSON. 둘 다 JSON-RPC 한 건으로 푼다. */
export async function readMcpResult(res: Response): Promise<{ result?: unknown; error?: { message?: string } }> {
  const text = await res.text();
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/event-stream')) {
    const data = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean);
    for (const d of data) { try { const j = JSON.parse(d); if (j && typeof j === 'object' && ('result' in j || 'error' in j)) return j; } catch { /* keep looking */ } }
    return {};
  }
  try { return JSON.parse(text); } catch { return {}; }
}

/** 폴더 한 단계의 항목. 경로는 드라이브 루트 기준 절대 경로(`/a/b.md`, NFC). */
export async function listFolderEntries(opts: FilesSourceOptions, driveId: string, path: string): Promise<FolderEntry[]> {
  if (!opts.token) throw new AinContractError('auth_required', 'aindrive 계정이 연결되어 있지 않습니다.', { ...(opts.connectUrl ? { actionUrl: opts.connectUrl } : {}) });
  const f = opts.fetch ?? fetch;
  const issuer = opts.aindriveUrl.replace(/\/+$/, '');
  const base = aindriveNormalizePath(path);
  const res = await fetchUpstream(f, `${issuer}/mcp/d/${encodeURIComponent(driveId)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_files', arguments: { path: base === '/' ? '' : base.slice(1) } } }),
    cache: 'no-store',
  }, { timeoutMs: opts.timeoutMs ?? UPSTREAM_TIMEOUT_MS, target: 'aindrive_mcp' });
  if (!res.ok) {
    const code: ErrorCode = res.status === 401 ? 'auth_required' : res.status === 403 ? 'forbidden' : res.status === 404 ? 'resource_deleted' : res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'source_offline' : 'temporary_failure';
    throw new AinContractError(code, '폴더 목록을 가져오지 못했습니다.', { detail: 'aindrive_mcp_http_error', upstreamStatus: res.status });
  }
  const rpc = await readMcpResult(res);
  if (rpc.error || !rpc.result) {
    // MCP 의 error.message 는 원본이 만든 문자열이라 응답에 싣지 않는다(계정 토큰이 섞일 수 있다). 로그에도 토큰은 지운다.
    console.error('aindrive MCP list_files error:', { message: String(rpc.error?.message ?? '(no result)').split(opts.token).join('[redacted]').slice(0, 500) });
    throw new AinContractError('temporary_failure', 'aindrive 폴더 목록 응답을 읽을 수 없습니다.', { detail: 'aindrive_mcp_error' });
  }
  const result = rpc.result as { isError?: boolean; structuredContent?: { entries?: unknown[] }; content?: { type: string; text?: string }[] };
  if (result.isError) {
    const msg = (result.content ?? []).map((c) => c.text ?? '').join(' ').toLowerCase();
    const code: ErrorCode = /forbidden|permission|not allowed/.test(msg) ? 'forbidden' : /offline|not connected/.test(msg) ? 'source_offline' : 'temporary_failure';
    throw new AinContractError(code, '폴더를 읽을 수 없습니다.');
  }
  const entries = (result.structuredContent?.entries ?? []) as Record<string, unknown>[];
  return entries
    .filter((e) => typeof e.name === 'string' && e.name)
    .map((e) => {
      const raw = typeof e.path === 'string' && e.path ? e.path : `${base === '/' ? '' : base}/${e.name as string}`;
      // MCP 는 드라이브 루트 기준 상대 경로를 준다("a/b.md"). 정규화하면 절대 경로가 된다.
      return {
        name: e.name as string,
        path: aindriveNormalizePath(raw),
        isDir: e.isDir === true,
        size: typeof e.size === 'number' ? e.size : null,
        mtimeMs: typeof e.mtimeMs === 'number' ? e.mtimeMs : null,
        mime: typeof e.mime === 'string' ? e.mime : null,
      };
    });
}

/** 폴더 항목 → FileRef. 소유자·가용성은 부모(공유 뿌리)의 것을 물려받는다(fallback 변환과 같은 규칙). */
export function entryToFileRef(parent: FileRef, e: FolderEntry): FileRef {
  const cpath = aindriveNormalizePath(e.path);
  return {
    contract: AIN_CONTRACT_VERSION,
    issuer: parent.issuer,
    driveId: parent.driveId,
    fileId: aindriveFileId(parent.driveId, cpath),
    revision: aindriveRevision({ mtimeMs: e.mtimeMs, size: e.size }),
    kind: e.isDir ? 'folder' : 'file',
    ...(e.mime && !e.isDir ? { mimeType: e.mime } : {}),
    displayName: e.name,
    ownerRef: parent.ownerRef,
    availability: parent.availability,
    sourceUrl: `${parent.issuer}/d/${encodeURIComponent(parent.driveId)}${cpath.split('/').map(encodeURIComponent).join('/')}${e.isDir ? '/' : ''}`,
    legacy: { path: cpath },
    ...(typeof e.size === 'number' && !e.isDir ? { size: e.size } : {}),
  };
}

export const FOLDER_WALK_MAX_ENTRIES = 2000;
export const FOLDER_WALK_MAX_DEPTH = 8;

/**
 * 공유 뿌리 아래에서 `fileId`(경로 해시)에 맞는 항목을 찾는다 — 너비 우선, 항목·깊이 상한.
 * 해시는 되돌릴 수 없으니 실제로 탐색해 같은 id 가 나오는 경로를 찾는 수밖에 없다.
 */
export async function findInFolder(opts: FilesSourceOptions, root: FileRef, fileId: string): Promise<FileRef | null> {
  if (root.kind !== 'folder') return null;
  const queue: { ref: FileRef; depth: number }[] = [{ ref: root, depth: 0 }];
  let seen = 0;
  while (queue.length) {
    const { ref, depth } = queue.shift()!;
    const entries = await listFolderEntries(opts, ref.driveId, ref.legacy?.path ?? '/');
    for (const e of entries) {
      if (++seen > FOLDER_WALK_MAX_ENTRIES) return null;
      const child = entryToFileRef(ref, e);
      if (child.fileId === fileId) return child;
      if (e.isDir && depth + 1 < FOLDER_WALK_MAX_DEPTH) queue.push({ ref: child, depth: depth + 1 });
    }
  }
  return null;
}
