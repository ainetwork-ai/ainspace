/**
 * 채팅 입력에 넣는 "링크 파트" — Space 의 메시지는 평문(markdown 렌더)이라 링크 파트는
 * `[표시 이름](sourceUrl)` 마크다운 한 조각이다. 업로드하지 않는다: 바이트는 원본에 남고,
 * 받는 쪽이 링크를 열 때 원본이 권한을 다시 판단한다(어댑터 사양 §"권한 판단은 원본이 한다").
 */
import type { FileRef } from './types';

const escapeLabel = (s: string) => s.replace(/[\[\]]/g, '\\$&');
// encodeURIComponent 는 괄호를 그대로 두므로 markdown 링크를 깨뜨리는 `(`·`)` 는 직접 인코딩한다.
const escapeUrl = (s: string) => s.replace(/[()\s]/g, (c) => (c === '(' ? '%28' : c === ')' ? '%29' : encodeURIComponent(c)));

/** sourceUrl 이 없는 참조는 링크로 만들 수 없다 → null (호출부는 선택을 막는다). */
export function fileLinkMarkdown(ref: Pick<FileRef, 'displayName' | 'sourceUrl'>): string | null {
  if (!ref.sourceUrl) return null;
  return `[${escapeLabel(ref.displayName)}](${escapeUrl(ref.sourceUrl)})`;
}

/** 커서 위치에 텍스트를 끼워 넣고, 양옆에 공백을 보장한다. 새 커서는 삽입 직후. */
export function insertAtCursor(value: string, cursor: number, text: string): { value: string; cursor: number } {
  const at = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, at);
  const after = value.slice(at);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s/.test(after) ? ' ' : '';
  const inserted = `${lead}${text}${trail}`;
  return { value: before + inserted + after, cursor: before.length + lead.length + text.length + (trail ? 1 : 0) };
}
