import { NextRequest } from 'next/server';
import { confirmOwnerChange, listVillageSharedAgents } from '@/lib/ain-integration/agent-ownership';
import { villageAgentsDeps, villageDeps } from '@/lib/ain-integration/deps';
import { errorResponse, failureResponse, guardAinRoute, okResponse } from '@/lib/ain-integration/route';
import { makeError, parseAgentKey } from '@/lib/ain-integration/types';
import { isVillageSlug } from '@/lib/ain-integration/village-materials';

export const runtime = 'nodejs';

/**
 * 17.3 마을에 배치된 공유 에이전트 — `/api/ain/villages/:slug/agents` (마을 소유자만, 플래그 off 면 404)
 *
 * GET                                   → { items: [{ commonAgentId, url, name, backendStatus, ownerChange }] }
 *                                          ownerChange ≠ null = Ainize 에서 소유자가 바뀌어 재확인 대기(배치는 유지, 마을 자료는 안 넘긴다).
 * POST { agentKey, decision:'confirm' } → 재확인. 새 소유자를 기준으로 삼고 표시를 지운다 → { confirmed }
 *                                          대기 중인 배치가 없으면 404.
 * 배치를 빼고 싶으면 기존 배치 해제 UI 를 쓴다(여기서는 배치를 바꾸지 않는다).
 */
type Ctx = { params: Promise<{ slug: string }> };

async function ownerOnly(request: NextRequest, ctx: Ctx) {
  const guard = await guardAinRoute(request);
  if (!('userId' in guard)) return guard;
  const { slug } = await ctx.params;
  if (!isVillageSlug(slug)) return errorResponse(makeError('unsupported_input', '마을 slug 가 올바르지 않습니다.'), 400);
  if (!(await villageDeps.directory.villageExists(slug))) return errorResponse(makeError('unsupported_input', '마을을 찾을 수 없습니다.', { detail: 'village_not_found' }), 404);
  const owner = await villageDeps.directory.getOwner(slug);
  if (!owner || owner !== guard.userId) return errorResponse(makeError('forbidden', '마을 소유자만 배치된 에이전트를 관리할 수 있습니다.'));
  return { slug };
}

export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    const p = await ownerOnly(request, ctx);
    if (!('slug' in p)) return p;
    return okResponse({ items: await listVillageSharedAgents(p.slug, villageAgentsDeps.store) });
  } catch (e) {
    return failureResponse(e);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const p = await ownerOnly(request, ctx);
    if (!('slug' in p)) return p;
    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    if (typeof b.agentKey !== 'string' || b.agentKey.length > 1024 || !parseAgentKey(b.agentKey)) {
      return errorResponse(makeError('unsupported_input', 'agentKey 는 `registryIssuer#agentId` 문자열이어야 합니다.'), 400);
    }
    if (b.decision !== 'confirm') return errorResponse(makeError('unsupported_input', "decision 은 'confirm' 이어야 합니다."), 400);
    const confirmed = await confirmOwnerChange(p.slug, b.agentKey, villageAgentsDeps.store);
    if (!confirmed) return errorResponse(makeError('unsupported_input', '재확인을 기다리는 배치가 없습니다.', { detail: 'no_pending_owner_change' }), 404);
    return okResponse({ confirmed });
  } catch (e) {
    return failureResponse(e);
  }
}
