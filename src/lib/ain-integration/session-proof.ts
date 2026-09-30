/**
 * 위임 발급용 세션 증명 = 사용자의 **AIN SSO ID 토큰** — 서버 전용 (adapter-invoke-spec §3).
 *
 * Space 는 아직 AIN SSO 로 로그인하지 않는다(backend JWT). 그래서 출처를 두 곳으로 열어 두고, 둘 다 없으면
 * 라우트가 `auth_required` + actionUrl(AIN SSO 연결 안내)로 끝낸다. 절대 다른 토큰(backend JWT·Google·Firebase)을
 * 세션 증명으로 대신 보내지 않는다.
 *   1) Redis `ain:sso_id_token:<backend userId>` — AIN SSO 연결 흐름이 생기면 여기에 쓴다.
 *   2) env `AIN_SESSION_PROOF_FILE` — ID 토큰이 든 파일. **개발 전용**(NODE_ENV=production 이면 무시).
 *
 * 토큰 값은 절대 로그·응답에 싣지 않는다.
 */
import { readFileSync } from 'node:fs';
import { getRedisClient } from '@/lib/redis';

const keyFor = (userId: string) => `ain:sso_id_token:${userId}`;

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

export async function getSessionProof(userId: string | null): Promise<string | null> {
  if (userId) {
    try {
      const redis = await getRedisClient();
      const v = await redis.get(keyFor(userId));
      if (v && looksLikeJwt(v)) return v;
    } catch (error) {
      console.error('AIN SSO session proof lookup failed:', error instanceof Error ? error.message : 'unknown');
    }
  }
  return readSessionProofFile();
}

export async function setSessionProof(userId: string, idToken: string | null): Promise<void> {
  const redis = await getRedisClient();
  if (idToken) await redis.set(keyFor(userId), idToken);
  else await redis.del(keyFor(userId));
}
