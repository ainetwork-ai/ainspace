/**
 * 답변 저장 단계 — 완료된 task 의 답변 텍스트를 사용자의 aindrive 폴더에 쓴다
 * (계약 task.ts `writeTarget`: 명시적 폴더 + 명시적 충돌 정책; reference-client flow.ts §save 와 같은 규칙).
 *
 *  1. 폴더: `saveTo.folderKey` 를 **사용자 자신의** 목록(scope=mine)에서 찾는다. 드라이브 루트가 아니면 같은
 *     드라이브의 내 뿌리 아래를 MCP `list_files` 로 탐색해 경로 해시가 맞는 폴더를 찾는다. 못 찾으면 `forbidden`.
 *  2. 충돌: 폴더 목록에서 같은 이름(NFC 정규화)을 본다.
 *     - 재시도 규칙: 같은 이름(또는 `rename` 이 만든 `<이름>-<무작위>.<확장자>` 변형)이 있고 정책이 `overwrite` 가
 *       아니며 **바이트 수가 같으면** 이 실행의 이전 출력이다(A2A 는 같은 messageId 에 같은 답을 돌려주므로 같은 논리
 *       실행의 답은 바이트가 같다) → 다시 쓰지 않고 overwrote=false 로 그 파일을 돌려준다.
 *     - 그 외 `fail` → `unsupported_input`(409), `rename` → `<이름>-<무작위>.<확장자>`, `overwrite` → 같은 경로.
 *  3. 쓰기: `POST /api/drives/{driveId}/fs/write {path, content}` 를 먼저 시도한다. aindrive 의 그 라우트는 세션(쿠키)만
 *     받고 계정 토큰(aind_aat_)은 401 로 거절하므로, 401 이면 계정 토큰의 쓰기 표면인 드라이브 MCP `write_file`
 *     (scope drives:write)로 같은 경로에 쓴다. 어느 쪽인지는 issuer 별로 잠시 기억한다(목록의 네이티브 판별과 같은 방식).
 *  4. 결과: 계약 FileRef — fileId `p1:`+sha256(driveId+"\0"+path)[0:32], revision `m<mtime>-s<bytes>`, ownerRef 는
 *     폴더(= 사용자)의 것, sourceUrl `{issuer}/d/{driveId}{path}`, legacy.path.
 *
 * 순수 함수 + fetch 주입. 토큰은 헤더로만 나가고 응답·로그·오류 메시지에 절대 싣지 않는다.
 */
import { randomBytes } from 'node:crypto';
import {
  aindriveNormalizePath, collectListedFiles, entryToFileRef, findInFolder, listFolderEntries, readMcpResult,
  type FilesSourceOptions, type FolderEntry,
} from './files';
import { UPSTREAM_TIMEOUT_MS, fetchUpstream, getNativeSupport, setNativeSupport } from './http';
import { AinContractError, fileKey, parseFileKey, type ErrorCode, type FileRef } from './types';

export const SAVE_CONFLICT_POLICIES = ['fail', 'overwrite', 'rename'] as const;
export type SaveConflictPolicy = (typeof SAVE_CONFLICT_POLICIES)[number];

/** 요청 바디의 `saveTo`. 폴더는 fileKey(`issuer#driveId#fileId`)로 가리킨다 — 경로가 아니다. */
export interface SaveTarget {
  folderKey: string;
  displayName: string;
  onConflict: SaveConflictPolicy;
}

export interface SaveResult {
  file: FileRef;
  /** 같은 이름의 파일을 덮어썼다(`overwrite` 정책일 때만 true). */
  overwrote: boolean;
  /** 이 실행의 이전 출력이 이미 있어 다시 쓰지 않았다(재시도). */
  reused: boolean;
}

export const SAVE_LIMITS = { displayName: 255, key: 1024 } as const;

/** 파일 이름으로 쓸 수 없는 것: 경로 구분자, 제어 문자, `.`/`..`, 앞뒤 공백. */
const BAD_NAME_RE = /[\\/\u0000-\u001f\u007f]/;

/** 라우트 경계의 `saveTo` 검증. 통과하면 NFC 로 정규화된 대상, 아니면 사용자에게 보여도 되는 이유. */
export function parseSaveTo(raw: unknown): { ok: true; saveTo: SaveTarget } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'saveTo 는 { folderKey, displayName, onConflict } 객체여야 합니다.' };
  const b = raw as Record<string, unknown>;
  const folderKey = typeof b.folderKey === 'string' && b.folderKey.length > 0 && b.folderKey.length <= SAVE_LIMITS.key ? b.folderKey : null;
  if (!folderKey || !parseFileKey(folderKey)) return { ok: false, message: 'saveTo.folderKey 는 `issuer#driveId#fileId` 문자열이어야 합니다.' };
  const nameRaw = typeof b.displayName === 'string' ? b.displayName.normalize('NFC') : '';
  if (!nameRaw || nameRaw.length > SAVE_LIMITS.displayName || BAD_NAME_RE.test(nameRaw) || nameRaw === '.' || nameRaw === '..' || nameRaw !== nameRaw.trim()) {
    return { ok: false, message: `saveTo.displayName 은 슬래시·제어 문자·앞뒤 공백 없는 1..${SAVE_LIMITS.displayName}자 파일 이름이어야 합니다.` };
  }
  if (typeof b.onConflict !== 'string' || !(SAVE_CONFLICT_POLICIES as readonly string[]).includes(b.onConflict)) {
    return { ok: false, message: `saveTo.onConflict 는 ${SAVE_CONFLICT_POLICIES.join('|')} 중 하나여야 합니다.` };
  }
  return { ok: true, saveTo: { folderKey, displayName: nameRaw, onConflict: b.onConflict as SaveConflictPolicy } };
}

// ------------------------------------------------------------------------------- folder

/**
 * 저장 폴더를 사용자 자신의 목록(scope=mine)에서 찾는다. 드라이브 루트면 목록에 바로 있고, 하위 폴더면 같은 드라이브의
 * 내 뿌리 아래를 탐색한다. 다른 사람의 드라이브(shared_with_me)에는 쓰지 않는다 — 계정 토큰이 편집자여도 여기서는 내 것만.
 */
export async function resolveOwnFolder(files: FilesSourceOptions, folderKey: string): Promise<FileRef> {
  const issuer = files.aindriveUrl.replace(/\/+$/, '');
  const p = parseFileKey(folderKey);
  if (!p) throw new AinContractError('unsupported_input', 'saveTo.folderKey 는 `issuer#driveId#fileId` 모양이어야 합니다.');
  if (p.issuer !== issuer) throw new AinContractError('unsupported_input', '이 배포가 연결된 aindrive 의 폴더에만 저장할 수 있습니다.');
  const key = `${p.issuer}#${p.driveId}#${p.fileId}`;
  const mine = await collectListedFiles(files, ['mine']);
  let ref = mine.get(key) ?? null;
  if (!ref) {
    const roots = [...mine.values()].filter((r) => r.driveId === p.driveId && r.kind === 'folder');
    for (const root of roots) { ref = await findInFolder(files, root, p.fileId); if (ref) break; }
  }
  // 내 목록에 없는 폴더의 존재 여부는 말하지 않는다(볼 수 없는 파일과 같은 규칙).
  if (!ref) throw new AinContractError('forbidden', '저장할 폴더를 이 계정의 드라이브에서 찾을 수 없습니다.');
  if (ref.kind !== 'folder') throw new AinContractError('unsupported_input', 'saveTo.folderKey 는 폴더여야 합니다.');
  if (ref.availability.state === 'deleted') throw new AinContractError('resource_deleted', '저장할 폴더가 삭제되었습니다.');
  if (ref.availability.state === 'offline') throw new AinContractError('source_offline', '저장할 폴더를 가진 기기가 지금 연결되어 있지 않습니다.');
  return ref;
}

// ------------------------------------------------------------------------------- naming

const joinPath = (folder: string, name: string) => aindriveNormalizePath(`${folder === '/' ? '' : folder}/${name}`);

const splitExt = (name: string) => { const dot = name.lastIndexOf('.'); return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot) } : { base: name, ext: '' }; };
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `rename` 이 만들었을 이름인가: `<이름>-<base36 1..6자>.<확장자>`. */
export function isRenamedVariant(name: string, candidate: string): boolean {
  const { base, ext } = splitExt(name);
  return new RegExp(`^${escapeRe(base)}-[0-9a-z]{1,6}${escapeRe(ext)}$`).test(candidate);
}

/** `<이름>-<무작위>.<확장자>` — 6자 base36. 이미 있는 이름과 겹치면 다시 뽑는다. */
export function renamedName(name: string, taken: ReadonlySet<string>, random: () => string = () => randomBytes(4).readUInt32BE(0).toString(36).slice(0, 6)): string {
  const { base, ext } = splitExt(name);
  for (let i = 0; i < 16; i++) {
    const candidate = `${base}-${random()}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new AinContractError('temporary_failure', '겹치지 않는 파일 이름을 만들지 못했습니다.', { retryable: true });
}

const MIME_BY_EXT: Record<string, string> = { md: 'text/markdown', txt: 'text/plain', json: 'application/json', csv: 'text/csv', html: 'text/html' };
const mimeOf = (name: string) => { const m = /\.([A-Za-z0-9]+)$/.exec(name); return (m && MIME_BY_EXT[m[1].toLowerCase()]) || 'text/plain'; };

// ------------------------------------------------------------------------------- write

const writeErrorCode = (status: number): ErrorCode =>
  status === 401 ? 'auth_required' : status === 403 ? 'forbidden' : status === 404 ? 'resource_deleted' : status === 413 ? 'unsupported_input'
  : status === 429 ? 'rate_limited' : status >= 500 ? 'source_offline' : 'temporary_failure';

const WRITE_MESSAGE: Partial<Record<ErrorCode, string>> = {
  auth_required: 'aindrive 계정 토큰이 더는 유효하지 않습니다. 다시 연결해 주세요.',
  forbidden: '이 aindrive 계정 토큰으로는 그 폴더에 쓸 수 없습니다(drives:write 범위와 편집 권한이 필요합니다).',
  resource_deleted: '저장할 폴더가 더는 없습니다.',
  unsupported_input: '답변이 aindrive 가 한 번에 받는 크기를 넘습니다.',
};

const writeError = (code: ErrorCode, detail: string, upstreamStatus?: number) =>
  new AinContractError(code, WRITE_MESSAGE[code] ?? '파일을 쓰지 못했습니다. 잠시 후 다시 시도해 주세요.', {
    detail, upstreamStatus, ...(code === 'auth_required' || code === 'forbidden' || code === 'resource_deleted' || code === 'unsupported_input' ? { retryable: false } : {}),
  });

interface WrittenMeta { mtimeMs: number | null; size: number | null }

const pickMeta = (v: unknown): WrittenMeta => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { mtimeMs: typeof o.mtimeMs === 'number' ? o.mtimeMs : null, size: typeof o.size === 'number' ? o.size : null };
};

/**
 * 텍스트 한 파일을 쓴다. `fs/write` → (401 이면) MCP `write_file`. 어느 쪽이든 경로·내용은 같다.
 * 성공 응답의 mtime/size 는 있으면 쓰고 없으면 호출 시각·바이트 수로 채운다.
 */
export async function writeTextFile(opts: FilesSourceOptions, driveId: string, path: string, text: string): Promise<WrittenMeta> {
  if (!opts.token) throw new AinContractError('auth_required', 'aindrive 계정이 연결되어 있지 않습니다. 연결하면 답변을 저장할 수 있습니다.', { ...(opts.connectUrl ? { actionUrl: opts.connectUrl } : {}) });
  const f = opts.fetch ?? fetch;
  const issuer = opts.aindriveUrl.replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const nativeKey = `write:${issuer}`;
  const abs = aindriveNormalizePath(path);

  if (getNativeSupport(nativeKey) !== false) {
    const res = await fetchUpstream(f, `${issuer}/api/drives/${encodeURIComponent(driveId)}/fs/write`, {
      method: 'POST', headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ path: abs, content: text }), cache: 'no-store',
    }, { timeoutMs, target: 'aindrive_write' });
    if (res.ok) {
      setNativeSupport(nativeKey, true);
      let j: unknown = null; try { j = await res.json(); } catch { /* 본문 없음 */ }
      return pickMeta(j);
    }
    // 401 = 이 라우트가 계정 토큰을 받지 않는다(세션 전용) → 계정 토큰의 쓰기 표면(MCP write_file)으로. 그 외는 그대로 옮긴다.
    if (res.status !== 401) throw writeError(writeErrorCode(res.status), 'aindrive_write_http_error', res.status);
    setNativeSupport(nativeKey, false);
  }

  const res = await fetchUpstream(f, `${issuer}/mcp/d/${encodeURIComponent(driveId)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'write_file', arguments: { path: abs.slice(1), content: text, encoding: 'utf8' } } }),
    cache: 'no-store',
  }, { timeoutMs, target: 'aindrive_mcp' });
  if (!res.ok) throw writeError(writeErrorCode(res.status), 'aindrive_mcp_http_error', res.status);
  const rpc = await readMcpResult(res);
  if (rpc.error || !rpc.result) {
    console.error('aindrive MCP write_file error:', { message: String(rpc.error?.message ?? '(no result)').split(opts.token).join('[redacted]').slice(0, 500) });
    throw new AinContractError('temporary_failure', 'aindrive 쓰기 응답을 읽을 수 없습니다.', { detail: 'aindrive_mcp_error' });
  }
  const result = rpc.result as { isError?: boolean; structuredContent?: unknown; content?: { type: string; text?: string }[] };
  if (result.isError) {
    // 도구 오류는 `[code] message` 또는 `unknown tool: write_file`(토큰에 drives:write 가 없음). 원문은 응답에 싣지 않는다.
    const msg = (result.content ?? []).map((c) => c.text ?? '').join(' ');
    const code: ErrorCode = /^\[forbidden\]|unknown tool|no drives:write|not allowed|permission/i.test(msg) ? 'forbidden'
      : /^\[not_found\]/i.test(msg) ? 'resource_deleted'
      : /^\[invalid_params\]/i.test(msg) ? 'unsupported_input'
      : /offline|not connected/i.test(msg) ? 'source_offline' : 'temporary_failure';
    console.error('aindrive MCP write_file refused:', { code, message: msg.split(opts.token).join('[redacted]').slice(0, 300) });
    throw writeError(code, 'aindrive_mcp_write_error');
  }
  return pickMeta(result.structuredContent);
}

// ------------------------------------------------------------------------------- save step

/**
 * 완료된 답변을 폴더에 저장한다. 충돌 정책과 재시도 규칙은 파일 머리의 설명대로.
 * `folder` 는 `resolveOwnFolder` 가 돌려준 내 폴더여야 한다(ownerRef 가 곧 사용자다).
 */
export async function saveAnswerToFolder(opts: FilesSourceOptions, folder: FileRef, target: SaveTarget, text: string): Promise<SaveResult> {
  if (folder.kind !== 'folder') throw new AinContractError('unsupported_input', 'saveTo.folderKey 는 폴더여야 합니다.');
  const name = target.displayName.normalize('NFC');
  const folderPath = aindriveNormalizePath(folder.legacy?.path ?? '/');
  const bytes = Buffer.byteLength(text, 'utf8');

  // 충돌 정책은 폴더에 무엇이 있는지 알아야 지킬 수 있다: 목록을 못 읽으면 쓰지 않는다(오류가 그대로 올라간다).
  const entries = await listFolderEntries(opts, folder.driveId, folderPath);
  const taken = new Set(entries.map((e) => e.name.normalize('NFC')));
  const existing: FolderEntry | undefined = entries.find((e) => !e.isDir && e.name.normalize('NFC') === name);

  let finalName = name;
  let overwrote = false;
  if (target.onConflict !== 'overwrite') {
    // 재시도: 이 실행의 이전 출력(같은 messageId → 같은 답 → 같은 바이트 수)이 그 이름 또는 rename 변형으로 있으면
    // 두 번째 파일을 만들지 않는다. 정확한 이름을 먼저 본다.
    const earlier = (existing && existing.size === bytes ? existing : undefined)
      ?? entries.find((e) => !e.isDir && e.size === bytes && isRenamedVariant(name, e.name.normalize('NFC')));
    if (earlier) return { file: entryToFileRef(folder, earlier), overwrote: false, reused: true };
  }
  if (existing) {
    if (target.onConflict === 'fail') {
      throw new AinContractError('unsupported_input', `"${name}" 이(가) 그 폴더에 이미 있습니다(onConflict=fail).`, { conflict: true, detail: 'name_conflict' });
    }
    if (target.onConflict === 'rename') finalName = renamedName(name, taken);
    else overwrote = true;
  }

  const path = joinPath(folderPath, finalName);
  const written = await writeTextFile(opts, folder.driveId, path, text);
  const now = (opts.now ?? (() => new Date()))().getTime();
  const file = entryToFileRef(folder, { name: finalName, path, isDir: false, size: written.size ?? bytes, mtimeMs: written.mtimeMs ?? now, mime: mimeOf(finalName) });
  return { file, overwrote, reused: false };
}

/** 테스트·라이브 체크용: 저장된 파일이 폴더 목록에 그 fileKey 로 보이는지. */
export const savedFileKey = (folder: FileRef, name: string) => fileKey(entryToFileRef(folder, { name, path: joinPath(aindriveNormalizePath(folder.legacy?.path ?? '/'), name), isDir: false }));
