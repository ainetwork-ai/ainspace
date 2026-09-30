import { NextRequest } from 'next/server';
import { getAindriveConnectUrl, getAindriveUrl } from '@/lib/ain-integration/config';
import { villageDeps, villageMaterialsDeps as deps } from '@/lib/ain-integration/deps';
import { isExhibit } from '@/lib/ain-integration/exhibition';
import { errorResponse, failureResponse, guardAinRoute, okResponse } from '@/lib/ain-integration/route';
import { makeError } from '@/lib/ain-integration/types';
import { isVillageSlug, listVillageMaterials, visibleMaterials, type VillageViewer } from '@/lib/ain-integration/village-materials';

export const runtime = 'nodejs';

/**
 * 17.4 마을 전시 자료 — `GET /api/ain/villages/:slug/exhibition`
 *   → { viewer, isOwner, items: [{ ref, audience, addedAt, availability }], actionUrl? }
 *
 * 전시 자료(마을 자료 중 exhibition) 가운데 보는 사람의 audience(방문자 public, 멤버 public+members)에 맞는 것만,
 * **보는 사람의** aindrive 계정으로 다시 확인한 가용성(available·offline·deleted·forbidden·unknown)과 함께 준다.
 * aindrive 를 연결하지 않은 사람은 모두 unknown 이고 연결 안내 `actionUrl` 이 함께 온다. 붙이기·떼기는 materials 라우트
 * (`exhibition: true`, 마을 소유자만). 앱 세션으로 보호, 플래그 off 면 404. 참조에 토큰 없음.
 */
type Ctx = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const guard = await guardAinRoute(request);
  if (!('userId' in guard)) return guard;
  const { slug } = await ctx.params;
  if (!isVillageSlug(slug)) return errorResponse(makeError('unsupported_input', '마을 slug 가 올바르지 않습니다.'), 400);
  try {
    const viewer: VillageViewer = (await deps.store.isMember(slug, guard.userId)) ? 'member' : 'visitor';
    const isOwner = (await villageDeps.directory.getOwner(slug)) === guard.userId;
    const exhibits = visibleMaterials(await listVillageMaterials(slug, deps.store), viewer).filter(isExhibit);
    const token = exhibits.length ? await deps.getAindriveAccountToken(guard.userId) : null;
    const connectUrl = getAindriveConnectUrl(request.nextUrl.origin);
    const checked = await deps.checkExhibits({ aindriveUrl: getAindriveUrl(), token, connectUrl }, exhibits);
    const actionUrl = checked.authRequired ? (checked.authRequired.actionUrl ?? connectUrl) : undefined;
    return okResponse({ viewer, isOwner, items: checked.items, ...(actionUrl ? { actionUrl } : {}) });
  } catch (e) {
    return failureResponse(e);
  }
}
