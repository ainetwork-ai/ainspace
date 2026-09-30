/**
 * 위임 발급용 세션 증명 = 사용자의 **AIN SSO ID 토큰** — 서버 전용 (adapter-invoke-spec §3).
 *
 * 공통 항목 B — **Space 에는 해당 없음**: Space 는 AIN SSO 로 로그인하지 않는다(지갑·키오스크 → backend(ainteams)
 * JWT, `app-session.ts`). 봉인해 둘 ID 토큰이 애초에 생기지 않으므로 운영에서 `getSessionProof` 는 항상 **null** 이고,
 * 파일을 넘기는 호출은 `auth_required` + actionUrl(AIN SSO 연결 안내)로 끝난다. AIN SSO 로그인 전체를 들이는 것은
 * 이 단계의 범위 밖이다(docs/ain-integration-flows.md §B). 로그인이 생기면 ainmem 의 `sso_sessions.id_token_ciphertext`
 * 처럼 세션별로 봉인(`sealed.ts`)해 두고, 만료 전까지만 여기서 돌려주고, 로그아웃·back-channel 로그아웃에서 지운다.
 *
 * 예전의 평문 Redis 키(`ain:sso_id_token:<userId>`)는 쓰는 곳이 없었고 평문 저장이라 읽지 않는다.
 * 절대 다른 토큰(backend JWT·Google·Firebase)을 세션 증명으로 대신 보내지 않는다.
 *
 * 개발 전용: env `AIN_SESSION_PROOF_FILE` — ID 토큰이 든 파일(NODE_ENV=production 이면 무시). 라이브 체크용.
 * 토큰 값은 절대 로그·응답에 싣지 않는다.
 */
import { readFileSync } from 'node:fs';

/** JWT 세 조각 모양인지 — 파일에 엉뚱한 것이 들어 있을 때 SSO 로 보내지 않게. */
const looksLikeJwt = (v: string) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v);

export function readSessionProofFile(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  const file = process.env.AIN_SESSION_PROOF_FILE?.trim();
  if (!file) return null;
  try {
    const v = readFileSync(file, 'utf8').trim();
    return looksLikeJwt(v) ? v : null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getSessionProof(_userId: string | null): Promise<string | null> {
  return readSessionProofFile();
}
