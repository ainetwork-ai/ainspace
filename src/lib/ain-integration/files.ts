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
import { getJson, getNativeSupport, isNotFound, paginate, qs, setNativeSupport, type FetchLike } from './http';
import {
  AIN_CONTRACT_VERSION, AinContractError, isFileListResponse,
  type FileAccessRole, type FileListItem, type FileListRequest, type FileListResponse, type FileRef, type OwnerRef,
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

/** mtime·size 로 만든 약한 revision. 드라이브 루트는 둘 다 없어 `m0-s0`. */
export const aindriveRevision = (e: { mtimeMs?: number | null; size?: number | null }) => `m${e.mtimeMs ?? 0}-s${e.size ?? 0}`;

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
      const r = await getJson<unknown>(f, `${issuer}/api/oauth/shared${qs({ scope: req.scope, q: req.q, cursor: req.cursor, limit: req.limit, org: req.org, folder: req.folder })}`, headers);
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
  const r = await getJson<{ drives?: OauthDrive[] }>(f, `${issuer}/api/oauth/drives`, headers);
  let items = (r.drives ?? [])
    .filter((d) => (req.scope === 'mine' ? d.role === 'owner' : d.role !== 'owner'))
    .map((d) => driveToFolderItem(issuer, d, opts.me));
  if (req.q) { const q = req.q.toLowerCase(); items = items.filter((i) => i.ref.displayName.toLowerCase().includes(q)); }
  const { page, nextCursor } = paginate(items, req.cursor, req.limit);
  return { contract: AIN_CONTRACT_VERSION, asOf, nextCursor, items: page };
}
