import { NextRequest } from 'next/server';
import { villageDeps as deps } from '@/lib/ain-integration/deps';
import { errorResponse, failureResponse, guardAinRoute, okResponse } from '@/lib/ain-integration/route';
import { makeError } from '@/lib/ain-integration/types';
import { isVillageSlug } from '@/lib/ain-integration/village-materials';
import { PRESENCE_TTL_MS } from '@/lib/ain-integration/village-membership';

export const runtime = 'nodejs';

/**
 * 17.5 검증된 체류 — `/api/ain/villages/:slug/presence`
 *
 * PUT    → 검증된 세션의 사용자가 지금 이 마을에 있다고 기록한다(갱신 주기 < 10분). { presentUntil }
 * DELETE → 떠남.
 *
 * 기존 위치/SSE presence 는 클라이언트가 보낸 wallet/session id 라 검증된 사용자와 이어지지 않는다. 마을 자료를
 * 에이전트에 넘기는 invoke(`villageMaterials: true`)는 멤버가 아니면 여기 기록된 체류를 요구한다. 플래그 off 면 404.
 */
type Ctx = { params: Promise<{ slug: string }> };

async function prelude(request: NextRequest, ctx: Ctx) {
  const guard = await guardAinRoute(request);
  if (!('userId' in guard)) return guard;
  const { slug } = await ctx.params;
  if (!isVillageSlug(slug)) return errorResponse(makeError('unsupported_input', '마을 slug 가 올바르지 않습니다.'), 400);
  return { userId: guard.userId, slug };
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const p = await prelude(request, ctx);
  if (!('slug' in p)) return p;
  try {
    if (!(await deps.directory.villageExists(p.slug))) return errorResponse(makeError('unsupported_input', '마을을 찾을 수 없습니다.', { detail: 'village_not_found' }), 404);
    const now = deps.now();
    await deps.directory.markPresent(p.slug, p.userId, now);
    return okResponse({ present: true, presentUntil: new Date(now + PRESENCE_TTL_MS).toISOString() });
  } catch (e) {
    return failureResponse(e);
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const p = await prelude(request, ctx);
  if (!('slug' in p)) return p;
  try {
    await deps.directory.clearPresent(p.slug, p.userId);
    return okResponse({ present: false });
  } catch (e) {
    return failureResponse(e);
  }
}
