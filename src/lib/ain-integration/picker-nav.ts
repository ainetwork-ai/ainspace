/**
 * 공유 파일 선택기의 탐색 상태(순수) — 범위 탭과 연 폴더들(빵부스러기).
 *
 * 공유 목록(`/api/ain/shared-files?scope=`)은 공유 뿌리만 준다(내 드라이브는 드라이브 루트). 그 안의 파일을 고르려면
 * 폴더를 열어야 한다(`/api/ain/shared-files/folder?folder=&path=`). 갤러리 파일럿 리허설(19.5): 마을 소유자가
 * 자기 드라이브의 전시 자료(폴더 안 파일)를 붙일 수 없었다 — 선택기에 "나에게 공유됨" 뿐이고 폴더를 열 수 없었다.
 */
import { fileKey, type FileListItem, type FileListScope, type FileRef } from './types';

export interface PickerNav { scope: FileListScope; trail: FileRef[] }

/** 선택기의 범위 탭(라벨). 조직 범위는 Space 계정에 조직 문맥이 없어 두지 않는다. */
export const PICKER_SCOPES: { scope: FileListScope; label: string }[] = [
  { scope: 'shared_with_me', label: '나에게 공유됨' },
  { scope: 'mine', label: '내 파일' },
];

const DRIVE_ROOT_PATH = '/';

export const initialNav = (scope: FileListScope = 'shared_with_me'): PickerNav => ({ scope, trail: [] });
export const withScope = (_nav: PickerNav, scope: FileListScope): PickerNav => ({ scope, trail: [] });
export const openFolder = (nav: PickerNav, ref: FileRef): PickerNav => (ref.kind === 'folder' ? { ...nav, trail: [...nav.trail, ref] } : nav);
export const back = (nav: PickerNav): PickerNav => ({ ...nav, trail: nav.trail.slice(0, -1) });
export const currentFolder = (nav: PickerNav): FileRef | undefined => nav.trail[nav.trail.length - 1];

/** 지금 상태의 목록 주소. */
export function pickerListUrl(nav: PickerNav): string {
  const here = currentFolder(nav);
  if (!here) return `/api/ain/shared-files?scope=${encodeURIComponent(nav.scope)}`;
  const q = new URLSearchParams({ folder: fileKey(here), path: here.legacy?.path ?? DRIVE_ROOT_PATH });
  return `/api/ain/shared-files/folder?${q.toString()}`;
}

/** 열 수 있는 폴더 행: 폴더이고, 원본이 온라인이고, 이용권이 막히지 않았다. */
export const canOpen = (item: FileListItem): boolean =>
  item.ref.kind === 'folder' && item.ref.availability.state === 'online' && !(item.paid && !item.paid.entitled);

/** 빵부스러기 표시: 연 폴더의 드라이브 경로(루트면 드라이브 이름). */
export const trailLabel = (nav: PickerNav): string | null => {
  const here = currentFolder(nav);
  if (!here) return null;
  const p = here.legacy?.path;
  return p && p !== DRIVE_ROOT_PATH ? p : here.displayName;
};
