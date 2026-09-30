import { NextRequest } from 'next/server';
import {
  getAindriveConnectUrl, getAindriveUrl, getAinSsoClientCredentials, getAinSsoConnectUrl, getAinSsoIssuer, getAinizeUrl,
} from '@/lib/ain-integration/config';
import { invokeDeps as deps } from '@/lib/ain-integration/deps';
import { INVOKE_LIMITS, parseInvokeBody } from '@/lib/ain-integration/invoke';
import { agentMaterialKeys } from '@/lib/ain-integration/village-materials';
import { errorResponse, failureResponse, guardAinRoute, okResponse } from '@/lib/ain-integration/route';
import { makeError } from '@/lib/ain-integration/types';

export const runtime = 'nodejs';

/**
 * POST /api/ain/invoke  { agentKey, text, fileKeys: string[], conversation, room?, saveTo?, villageMaterials? }
 *   villageMaterials: true 면 room(= 마을 slug)의 마을 자료 중 audience public·agent 만 fileKeys 에 더한다(17.5, members 는 넘기지 않음).
 *   → 200 { task: TaskRef, text }  (adapter-invoke-spec §POST /api/ain/invoke)
 *   saveTo: { folderKey, displayName, onConflict: 'fail'|'overwrite'|'rename' } — 완료된 답변을 사용자 자신의 aindrive
 *   폴더에 쓰고 `task.outputs[0] = { file, overwrote }` 로 보고한다(lib/ain-integration/save.ts). 이름 충돌 + fail 은 409.
 *
 * 앱 세션(검증된 backend JWT — 서명 없는 `sub` 는 거절)으로 보호한다. 선택한 파일을 선택한 공유 에이전트에게
 * 넘겨 호출한다: 파일은 사용자의 aindrive 계정 토큰으로 해석하고, 위임은 사용자의 **AIN SSO ID 토큰**(세션 증명)
 * 으로만 발급받는다 — 없으면 `auth_required` + actionUrl. backend JWT 는 원본 어디에도 전달하지 않는다.
 * 호출자는 항상 검증된 사용자다(익명 호출 없음): idempotencyKey·contextId·TaskRef 보관이 모두 그 사용자에 묶인다.
 * 응답에는 토큰이 없다(TaskRef 계약 + stripSecretKeys). 플래그 off 면 404.
 */
export async function POST(request: NextRequest) {
  const guard = await guardAinRoute(request);
  if (!('userId' in guard)) return guard;

  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const parsed = parseInvokeBody(body);
  if (!parsed.ok) return errorResponse(makeError('unsupported_input', parsed.message), 400);

  const { userId } = guard;
  try {
    // 17.5: 마을 자료 중 에이전트용(public·agent)만 file-refs 에 더한다. members 자료는 넘기지 않는다.
    if (parsed.req.villageMaterials && parsed.req.room) {
      const extra = agentMaterialKeys(await deps.listVillageMaterials(parsed.req.room));
      const fileKeys = [...new Set([...parsed.req.fileKeys, ...extra])];
      if (fileKeys.length > INVOKE_LIMITS.fileKeys) return errorResponse(makeError('unsupported_input', `넘길 파일이 ${INVOKE_LIMITS.fileKeys}개를 넘습니다.`), 400);
      parsed.req.fileKeys = fileKeys;
    }
    const aindriveToken = await deps.getAindriveAccountToken(userId);
    const creds = getAinSsoClientCredentials();
    const result = await deps.invokeSharedAgent({
      aindriveUrl: getAindriveUrl(),
      ainizeUrl: getAinizeUrl(),
      aindriveToken,
      aindriveConnectUrl: getAindriveConnectUrl(request.nextUrl.origin),
      sso: creds ? { issuer: getAinSsoIssuer(), ...creds, connectUrl: getAinSsoConnectUrl() } : null,
      getSessionProof: () => deps.getSessionProof(userId),
      // 컨텍스트 경계: 이 제품의 사용자 + 대화. Space 에는 조직 개념이 없다(org=null).
      scope: { account: userId, org: null, product: 'ainspace' },
    }, parsed.req);
    void deps.saveTaskRef(userId, parsed.req.conversation, result.task);
    return okResponse(result);
  } catch (e) {
    return failureResponse(e);
  }
}
