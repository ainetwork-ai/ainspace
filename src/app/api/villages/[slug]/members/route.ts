import { NextRequest } from 'next/server';
import { isAinIntegrationEnabled } from '@/lib/ain-integration/config';
import { villageDeps as deps } from '@/lib/ain-integration/deps';
import { errorResponse, failureResponse, guardAinRoute, okResponse } from '@/lib/ain-integration/route';
import { makeError } from '@/lib/ain-integration/types';
import { isVillageSlug } from '@/lib/ain-integration/village-materials';
import { MAX_MEMBERS } from '@/lib/ain-integration/village-membership';

export const runtime = 'nodejs';

/**
 * 17.5 마을 멤버 — `/api/villages/:slug/members` (AIN 통합 플래그 off 면 404)
 *
 * 멤버 = 마을 소유자(만든 사람, `POST /api/villages` 가 검증된 세션으로 기록) + 소유자가 여기서 넣은 사람.
 * 사용자 id 는 backend 사용자 id(검증된 세션의 sub)다.
 *
 * GET               → { owner, members } — 멤버만.
 * POST { userId }   → 소유자만. 멤버를 넣는다.
 * DELETE ?userId=   → 소유자만. 멤버를 뺀다(소유자 자신은 뺄 수 없다).
 *
 * 소유자가 없는 기존 마을: 관리자 대시보드 요청(미들웨어가 ADMIN_API_SECRET 으로 검증해 `x-admin-verified` 를 붙인 것)만
 * `POST { userId, owner: true }` 로 소유자를 정할 수 있다. 일반 요청의 `x-admin-verified` 는 미들웨어가 지운다.
 */
type Ctx = { params: Promise<{ slug: string }> };

const USER_ID = /^[A-Za-z0-9_.:@-]{1,128}$/;

/** 미들웨어가 ADMIN_API_SECRET 을 확인했을 때만 붙이고, 그 밖의 요청에서는 지우는 헤더. */
const isAdminVerified = (request: NextRequest) => request.headers.get('x-admin-verified') === 'true';

const notFound = () => errorResponse(makeError('unsupported_input', '마을을 찾을 수 없습니다.', { detail: 'village_not_found' }), 404);
const flagOff = () => errorResponse(makeError('temporary_failure', 'AIN 통합이 이 배포에서 꺼져 있습니다.', { retryable: false, detail: 'ain_integration_disabled' }), 404);

/** 호출자: 관리자(세션 없음) 또는 검증된 사용자. */
async function caller(request: NextRequest): Promise<{ admin: true } | { admin: false; userId: string } | Response> {
  if (!isAinIntegrationEnabled()) return flagOff();
  if (isAdminVerified(request)) return { admin: true };
  const guard = await guardAinRoute(request);
  if (!('userId' in guard)) return guard;
  return { admin: false, userId: guard.userId };
}

async function slugOf(ctx: Ctx): Promise<string | null> {
  const { slug } = await ctx.params;
  return isVillageSlug(slug) ? slug : null;
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const c = await caller(request);
  if (c instanceof Response) return c;
  const slug = await slugOf(ctx);
  if (!slug) return errorResponse(makeError('unsupported_input', '마을 slug 가 올바르지 않습니다.'), 400);
  try {
    if (!(await deps.directory.villageExists(slug))) return notFound();
    if (!c.admin && !(await deps.directory.isMember(slug, c.userId))) return errorResponse(makeError('forbidden', '이 마을의 멤버만 볼 수 있습니다.'));
    return okResponse({ owner: await deps.directory.getOwner(slug), members: await deps.directory.listMembers(slug) });
  } catch (e) {
    return failureResponse(e);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const c = await caller(request);
  if (c instanceof Response) return c;
  const slug = await slugOf(ctx);
  if (!slug) return errorResponse(makeError('unsupported_input', '마을 slug 가 올바르지 않습니다.'), 400);
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.userId !== 'string' || !USER_ID.test(b.userId)) return errorResponse(makeError('unsupported_input', 'userId 는 backend 사용자 id 문자열이어야 합니다.'), 400);
  if (b.owner !== undefined && b.owner !== true) return errorResponse(makeError('unsupported_input', 'owner 는 true 만 받습니다.'), 400);
  try {
    if (!(await deps.directory.villageExists(slug))) return notFound();
    const owner = await deps.directory.getOwner(slug);
    if (b.owner === true) {
      // 소유자 지정은 관리자만(소유자가 없는 기존 마을을 여는 용도, 또는 소유자 교체).
      if (!c.admin) return errorResponse(makeError('forbidden', '소유자는 관리자만 정할 수 있습니다.'));
      await deps.directory.setOwner(slug, b.userId);
      return okResponse({ owner: b.userId, members: await deps.directory.listMembers(slug) });
    }
    if (!c.admin && (!owner || owner !== c.userId)) return errorResponse(makeError('forbidden', '마을 소유자만 멤버를 넣을 수 있습니다.'));
    const members = await deps.directory.listMembers(slug);
    if (!members.includes(b.userId) && members.length >= MAX_MEMBERS) return errorResponse(makeError('unsupported_input', `멤버는 ${MAX_MEMBERS}명까지입니다.`), 400);
    await deps.directory.addMember(slug, b.userId);
    return okResponse({ owner, members: await deps.directory.listMembers(slug) });
  } catch (e) {
    return failureResponse(e);
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const c = await caller(request);
  if (c instanceof Response) return c;
  const slug = await slugOf(ctx);
  if (!slug) return errorResponse(makeError('unsupported_input', '마을 slug 가 올바르지 않습니다.'), 400);
  const userId = request.nextUrl.searchParams.get('userId') ?? '';
  if (!USER_ID.test(userId)) return errorResponse(makeError('unsupported_input', 'userId 가 올바르지 않습니다.'), 400);
  try {
    if (!(await deps.directory.villageExists(slug))) return notFound();
    const owner = await deps.directory.getOwner(slug);
    if (!c.admin && (!owner || owner !== c.userId)) return errorResponse(makeError('forbidden', '마을 소유자만 멤버를 뺄 수 있습니다.'));
    if (userId === owner) return errorResponse(makeError('unsupported_input', '소유자는 멤버에서 뺄 수 없습니다.'), 400);
    await deps.directory.removeMember(slug, userId);
    return okResponse({ owner, members: await deps.directory.listMembers(slug) });
  } catch (e) {
    return failureResponse(e);
  }
}
