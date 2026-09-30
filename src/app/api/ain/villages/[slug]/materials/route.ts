import { NextRequest } from 'next/server';
import { getAindriveConnectUrl, getAindriveUrl } from '@/lib/ain-integration/config';
import { villageDeps, villageMaterialsDeps as deps } from '@/lib/ain-integration/deps';
import { EXHIBIT_AUDIENCES } from '@/lib/ain-integration/exhibition';
import { errorResponse, failureResponse, guardAinRoute, okResponse } from '@/lib/ain-integration/route';
import { fileKey as fileKeyOf, makeError, parseFileKey } from '@/lib/ain-integration/types';
import {
  MATERIAL_AUDIENCES, isMaterialAudience, isVillageSlug, listVillageMaterials, putVillageMaterial, removeVillageMaterial, visibleMaterials,
  type VillageViewer,
} from '@/lib/ain-integration/village-materials';

export const runtime = 'nodejs';

/**
 * 17.5 마을 자료 — `/api/ain/villages/:slug/materials`
 *
 * GET               → { viewer, items: [{ ref, audience }] }. 방문자 = public, 멤버 = public+members.
 *                     멤버의 `?view=manage` 는 agent 자료까지 전부(관리용, addedBy 포함).
 * PUT  { fileKey, audience, exhibition? } → 멤버만. `exhibition: true`(17.4 전시 자료)는 **마을 소유자만**, audience 는
 *                     public·members 만. 이미 전시 자료인 참조를 바꾸거나 떼는 것도 소유자만.
 * PUT  { fileKey, audience }   → 멤버만. 파일은 **그 멤버의** aindrive 목록에서 해석해(볼 수 있는 파일만) 참조로 저장한다.
 * DELETE ?fileKey=  → 멤버만.
 *
 * 앱 세션(검증된 backend JWT)으로 보호한다. 참조에 토큰 없음. 플래그 off 면 404.
 */
type Ctx = { params: Promise<{ slug: string }> };

async function prelude(request: NextRequest, ctx: Ctx) {
  const guard = await guardAinRoute(request);
  if (!('userId' in guard)) return guard;
  const { slug } = await ctx.params;
  if (!isVillageSlug(slug)) return errorResponse(makeError('unsupported_input', '마을 slug 가 올바르지 않습니다.'), 400);
  return { userId: guard.userId, slug };
}

const isVillageOwner = async (slug: string, userId: string) => (await villageDeps.directory.getOwner(slug)) === userId;
const isExhibitKey = async (slug: string, key: string) =>
  (await listVillageMaterials(slug, deps.store)).some((m) => m.exhibition === true && fileKeyOf(m.ref) === key);

export async function GET(request: NextRequest, ctx: Ctx) {
  const p = await prelude(request, ctx);
  if (!('slug' in p)) return p;
  try {
    const viewer: VillageViewer = (await deps.store.isMember(p.slug, p.userId)) ? 'member' : 'visitor';
    const all = await listVillageMaterials(p.slug, deps.store);
    if (viewer === 'member' && request.nextUrl.searchParams.get('view') === 'manage') {
      return okResponse({ viewer, items: all.map((m) => ({ ref: m.ref, audience: m.audience, addedBy: m.addedBy, addedAt: m.addedAt, ...(m.exhibition ? { exhibition: true } : {}) })) });
    }
    return okResponse({ viewer, items: visibleMaterials(all, viewer).map((m) => ({ ref: m.ref, audience: m.audience })) });
  } catch (e) {
    return failureResponse(e);
  }
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const p = await prelude(request, ctx);
  if (!('slug' in p)) return p;
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.fileKey !== 'string' || b.fileKey.length > 1024 || !parseFileKey(b.fileKey)) {
    return errorResponse(makeError('unsupported_input', 'fileKey 는 `issuer#driveId#fileId` 문자열이어야 합니다.'), 400);
  }
  if (!isMaterialAudience(b.audience)) {
    return errorResponse(makeError('unsupported_input', `audience 는 ${MATERIAL_AUDIENCES.join('|')} 중 하나여야 합니다.`), 400);
  }
  if (b.exhibition !== undefined && typeof b.exhibition !== 'boolean') return errorResponse(makeError('unsupported_input', 'exhibition 은 boolean 이어야 합니다.'), 400);
  const exhibition = b.exhibition === true;
  if (exhibition && !EXHIBIT_AUDIENCES.includes(b.audience)) {
    return errorResponse(makeError('unsupported_input', `전시 자료의 audience 는 ${EXHIBIT_AUDIENCES.join('|')} 중 하나여야 합니다.`), 400);
  }
  try {
    if (!(await deps.store.isMember(p.slug, p.userId))) return errorResponse(makeError('forbidden', '이 마을의 멤버만 자료를 붙일 수 있습니다.'));
    if (exhibition || (await isExhibitKey(p.slug, b.fileKey))) {
      if (!(await isVillageOwner(p.slug, p.userId))) return errorResponse(makeError('forbidden', '전시 자료는 마을 소유자만 붙이거나 바꿀 수 있습니다.'));
    }
    const token = await deps.getAindriveAccountToken(p.userId);
    const [ref] = await deps.resolveFiles({ aindriveUrl: getAindriveUrl(), token, connectUrl: getAindriveConnectUrl(request.nextUrl.origin) }, [b.fileKey]);
    await putVillageMaterial(p.slug, { ref, audience: b.audience, addedBy: p.userId, addedAt: new Date().toISOString(), ...(exhibition ? { exhibition: true } : {}) }, deps.store);
    return okResponse({ ref, audience: b.audience, ...(exhibition ? { exhibition: true } : {}) });
  } catch (e) {
    return failureResponse(e);
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const p = await prelude(request, ctx);
  if (!('slug' in p)) return p;
  const key = request.nextUrl.searchParams.get('fileKey') ?? '';
  if (!parseFileKey(key)) return errorResponse(makeError('unsupported_input', 'fileKey 가 올바르지 않습니다.'), 400);
  try {
    if (!(await deps.store.isMember(p.slug, p.userId))) return errorResponse(makeError('forbidden', '이 마을의 멤버만 자료를 뗄 수 있습니다.'));
    if ((await isExhibitKey(p.slug, key)) && !(await isVillageOwner(p.slug, p.userId))) return errorResponse(makeError('forbidden', '전시 자료는 마을 소유자만 뗄 수 있습니다.'));
    await removeVillageMaterial(p.slug, key, deps.store);
    return okResponse({ removed: true });
  } catch (e) {
    return failureResponse(e);
  }
}
