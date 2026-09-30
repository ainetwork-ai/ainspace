/**
 * 17.7 채팅 첨부 이관 — **새** 첨부는 Space/backend 스토리지가 아니라 사용자의 aindrive 폴더로 간다. 서버 전용.
 *
 * 경로는 답변 저장(saveTo)과 같다: 내 폴더 확인(`resolveOwnFolder`, scope=mine) → 폴더 목록으로 충돌 확인(`rename`) →
 * `fs/write` / MCP `write_file`(base64) → 계약 FileRef. 채팅에는 링크 파트(markdown)만 들어간다 — 바이트는 aindrive 에
 * 남고, 여는 사람의 권한은 aindrive 가 다시 판단한다.
 * 폴더를 주지 않으면 내 첫 드라이브의 루트(이름순)에 쓴다.
 *
 * **옛 첨부**(backend `files`, `/api/files/:id` 프록시로 서빙되는 agent 이미지 등)는 그대로 둔다 — 그 경로·렌더링은
 * 바뀌지 않는다(lib/backend/chat-files.ts).
 */
import { collectListedFiles, type FilesSourceOptions } from './files';
import { fileLinkMarkdown } from './link-part';
import { resolveOwnFolder, saveContentToFolder } from './save';
import { AinContractError, type FileRef } from './types';

/** 한 번에 받는 첨부 크기. aindrive 의 fs-write 한도보다 훨씬 작게(요청 한 번에 base64 로 실린다). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** 파일 이름으로 쓸 수 있게: 경로 구분자·제어 문자 제거, NFC, 앞뒤 공백·점 제거, 255자. 비면 `attachment`. */
export function attachmentName(raw: string): string {
  const cleaned = raw.normalize('NFC').replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim().replace(/^\.+/, '').slice(0, 255).trim();
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'attachment';
}

/** 폴더를 주지 않았을 때: 내 드라이브 루트 중 이름순 첫 번째. */
export async function defaultAttachmentFolder(files: FilesSourceOptions): Promise<FileRef> {
  const mine = await collectListedFiles(files, ['mine']);
  const roots = [...mine.values()].filter((r) => r.kind === 'folder' && (r.legacy?.path ?? '/') === '/' && r.availability.state !== 'deleted')
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.driveId.localeCompare(b.driveId));
  if (!roots.length) throw new AinContractError('unsupported_input', '첨부를 저장할 내 aindrive 드라이브가 없습니다.', { detail: 'no_own_drive' });
  if (roots[0].availability.state === 'offline') throw new AinContractError('source_offline', '첨부를 저장할 드라이브의 기기가 지금 연결되어 있지 않습니다.');
  return roots[0];
}

export interface ChatAttachmentInput { folderKey?: string; name: string; bytes: Uint8Array; mimeType?: string }
export interface ChatAttachmentResult { file: FileRef; markdown: string; reused: boolean }

export async function saveChatAttachment(files: FilesSourceOptions, input: ChatAttachmentInput): Promise<ChatAttachmentResult> {
  if (input.bytes.byteLength === 0) throw new AinContractError('unsupported_input', '빈 파일은 첨부할 수 없습니다.');
  if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new AinContractError('unsupported_input', `첨부는 ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB 이하여야 합니다.`);
  if (!files.token) {
    throw new AinContractError('auth_required', 'aindrive 계정이 연결되어 있지 않습니다. 연결하면 파일을 첨부할 수 있습니다.', { ...(files.connectUrl ? { actionUrl: files.connectUrl } : {}) });
  }
  const folder = input.folderKey ? await resolveOwnFolder(files, input.folderKey) : await defaultAttachmentFolder(files);
  const saved = await saveContentToFolder(files, folder, { folderKey: '', displayName: attachmentName(input.name), onConflict: 'rename' }, { bytes: input.bytes, mimeType: input.mimeType });
  const markdown = fileLinkMarkdown(saved.file);
  if (!markdown) throw new AinContractError('temporary_failure', '저장한 첨부의 링크를 만들 수 없습니다.', { retryable: false });
  return { file: saved.file, markdown, reused: saved.reused };
}
