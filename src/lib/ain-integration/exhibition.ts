/**
 * 17.4 작품·전시 자료 — 마을 소유자가 Aindrive 공유 파일을 마을의 **전시 자료**로 붙이고, 마을 화면에 가용성과 함께 보여 준다.
 * 서버 전용.
 *
 * 저장은 17.5 마을 자료(village-materials.ts)와 같은 필드 하나 = 참조 하나이고, `exhibition: true` 가 붙은 것이 전시 자료다.
 * 전시는 사람에게 보이는 것이므로 audience 는 `public`(기본) 또는 `members` 만 받는다(`agent` 는 사람 목록에 없다).
 * 붙이고 떼는 것은 **마을 소유자만**(일반 자료는 멤버도 된다).
 *
 * 가용성은 **보는 사람의** aindrive 계정으로 다시 확인한다 — 저장된 참조는 붙인 사람이 볼 수 있던 것일 뿐이다.
 *   available : 보는 사람의 목록(공유·내 것, 공유 뿌리 폴더 탐색 포함)에 있고 온라인
 *   offline   : 있지만 원본 기기가 꺼져 있다
 *   deleted   : 원본이 삭제로 알려 준다(목록의 availability=deleted, 또는 드라이브가 사라짐)
 *   forbidden : 보는 사람의 목록에 없다(공유가 철회됐거나 애초에 공유받지 않았다)
 *   unknown   : 보는 사람이 aindrive 를 연결하지 않았거나 원본에 닿지 않는다(연결 안내 actionUrl 을 함께 준다)
 * 볼 수 없는 파일(forbidden)의 이름·경로는 저장된 표시 이름 외에 새로 알려 주지 않고, sourceUrl 은 내려보내지 않는다.
 */
import { collectListedFiles, findInFolder, type FilesSourceOptions } from './files';
import { AinContractError, fileKey, type FileRef } from './types';
import type { MaterialAudience, VillageMaterial } from './village-materials';

export type ExhibitAvailability = 'available' | 'offline' | 'deleted' | 'forbidden' | 'unknown';
export const EXHIBIT_AUDIENCES: readonly MaterialAudience[] = ['public', 'members'];
/** 한 번에 가용성을 확인하는 전시 자료 수(폴더 탐색 비용 상한). 넘는 것은 unknown. */
export const EXHIBIT_CHECK_MAX = 50;

export interface ExhibitView {
  ref: FileRef;
  audience: MaterialAudience;
  addedAt: string;
  availability: ExhibitAvailability;
}

export const isExhibit = (m: VillageMaterial): boolean => m.exhibition === true;

const stateOf = (r: FileRef): ExhibitAvailability =>
  r.availability.state === 'deleted' ? 'deleted' : r.availability.state === 'offline' ? 'offline' : 'available';

/** 볼 수 없는 파일의 참조에서 여는 위치를 뺀다(이름은 전시한 사람이 붙일 때의 표시 이름 그대로). */
const withoutSource = (r: FileRef): FileRef => { const { sourceUrl: _s, ...rest } = r; void _s; return rest; };

/**
 * 보는 사람의 aindrive 계정으로 전시 자료의 가용성을 확인한다. 토큰이 없으면 모두 unknown(+ auth_required 를 돌려준다).
 * 목록은 한 번만 모으고, 목록에 없는 것만 같은 드라이브의 공유 뿌리 폴더를 탐색한다.
 */
export async function checkExhibits(files: FilesSourceOptions, items: VillageMaterial[]): Promise<{ items: ExhibitView[]; authRequired?: AinContractError }> {
  const unknown = (m: VillageMaterial): ExhibitView => ({ ref: m.ref, audience: m.audience, addedAt: m.addedAt, availability: 'unknown' });
  if (!items.length) return { items: [] };
  let listed: Map<string, FileRef>;
  try {
    listed = await collectListedFiles(files, ['shared_with_me', 'mine']);
  } catch (e) {
    if (e instanceof AinContractError && e.code === 'auth_required') return { items: items.map(unknown), authRequired: e };
    if (e instanceof AinContractError) return { items: items.map(unknown) };
    throw e;
  }
  const out: ExhibitView[] = [];
  for (const [i, m] of items.entries()) {
    if (i >= EXHIBIT_CHECK_MAX) { out.push(unknown(m)); continue; }
    let found = listed.get(fileKey(m.ref)) ?? null;
    // 목록에 없을 때 탐색이 끝내 판단하지 못한 이유(드라이브 없음 → deleted, 기기 꺼짐 → offline, 그 밖 → unknown).
    let missing: ExhibitAvailability = 'forbidden';
    if (!found) {
      const roots = [...listed.values()].filter((r) => r.driveId === m.ref.driveId && r.issuer === m.ref.issuer && r.kind === 'folder');
      for (const root of roots) {
        if (root.availability.state === 'offline') { missing = 'offline'; continue; }
        try { found = await findInFolder(files, root, m.ref.fileId); } catch (e) {
          if (!(e instanceof AinContractError)) throw e;
          missing = e.code === 'resource_deleted' ? 'deleted' : e.code === 'source_offline' ? 'offline' : e.code === 'forbidden' ? 'forbidden' : 'unknown';
          continue;
        }
        if (found) break;
      }
    }
    if (found) out.push({ ref: { ...m.ref, ...found }, audience: m.audience, addedAt: m.addedAt, availability: stateOf(found) });
    else out.push({ ref: missing === 'forbidden' || missing === 'deleted' ? withoutSource(m.ref) : m.ref, audience: m.audience, addedAt: m.addedAt, availability: missing });
  }
  return { items: out };
}
