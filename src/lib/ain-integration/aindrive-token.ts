/**
 * 사용자별 aindrive 계정 토큰(`aind_aat_…`) 조회 — 서버 전용.
 *
 * Space 에는 아직 aindrive OAuth 연결 흐름이 없다. 그래서 토큰의 출처를 두 곳으로 열어 두고,
 * 둘 다 없으면 어댑터가 `auth_required` + 연결 안내(actionUrl)를 돌려준다(어댑터 사양 §원본 호출).
 *   1) Redis `ain:aindrive_token:<backend userId>` — 연결 흐름이 생기면 여기에 쓴다.
 *   2) env `AINDRIVE_ACCOUNT_TOKEN` — 배포 단위 토큰(전시 키오스크처럼 계정이 하나인 곳).
 *
 * 토큰 값은 절대 로그·응답에 싣지 않는다.
 */
import { getRedisClient } from '@/lib/redis';

const keyFor = (userId: string) => `ain:aindrive_token:${userId}`;

export async function getAindriveAccountToken(userId: string | null): Promise<string | null> {
  if (userId) {
    try {
      const redis = await getRedisClient();
      const v = await redis.get(keyFor(userId));
      if (v) return v;
    } catch (error) {
      console.error('aindrive token lookup failed:', error instanceof Error ? error.message : 'unknown');
    }
  }
  const shared = process.env.AINDRIVE_ACCOUNT_TOKEN?.trim();
  return shared || null;
}

export async function setAindriveAccountToken(userId: string, token: string | null): Promise<void> {
  const redis = await getRedisClient();
  if (token) await redis.set(keyFor(userId), token);
  else await redis.del(keyFor(userId));
}
