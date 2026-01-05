// 환경변수 로딩 (가장 먼저 실행되어야 함)
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from 'redis';

// .env.local 파일 우선, 없으면 .env 파일 로드
const envLocalResult = config({ path: resolve(process.cwd(), '.env.local') });
const envResult = config({ path: resolve(process.cwd(), '.env') });

if (envLocalResult.error && envResult.error) {
  console.warn('환경변수 파일을 찾을 수 없습니다. 시스템 환경변수를 사용합니다.');
} else {
  console.log('환경변수 파일 로드 완료');
}

import { StoredAgent } from "@/lib/redis";

const AGENTS_KEY = 'agents:';

/**
 * isPlaced=true인 agent들을 user별 placed_agents 리스트에 추가하는 마이그레이션
 */
async function migratePlacedAgents() {
  try {
    console.log('Placed Agents 마이그레이션 시작...');

    // 환경변수 확인 및 Redis 클라이언트 직접 생성
    const redisUrl = process.env.AINSPACE_STORAGE_REDIS_URL || 'redis://localhost:6379';
    const maskedUrl = redisUrl.replace(/:[^:@]+@/, ':****@');
    console.log(`Redis URL: ${maskedUrl}`);

    if (!process.env.AINSPACE_STORAGE_REDIS_URL) {
      console.error('⚠️  경고: AINSPACE_STORAGE_REDIS_URL 환경변수가 설정되지 않았습니다. localhost를 사용합니다.');
    }

    // Redis 클라이언트 직접 생성 (환경변수가 로드된 후)
    const redis = createClient({
      url: redisUrl
    });

    redis.on('error', (err) => {
      console.error('Redis Client Error', err);
    });

    await redis.connect();
    console.log('Redis 연결 성공');

    // 모든 에이전트 키 가져오기
    const keys = await redis.keys(`${AGENTS_KEY}*`);
    console.log(`총 ${keys.length}개의 에이전트 키를 찾았습니다.`);

    if (keys.length === 0) {
      console.log('마이그레이션할 에이전트가 없습니다.');
      return;
    }

    // 모든 에이전트 데이터 가져오기
    const values = await redis.mGet(keys);

    // user별 placed agents 그룹핑
    const userPlacedAgents: Map<string, { url: string; timestamp: number }[]> = new Map();

    let placedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const value = values[i];

      if (!value) {
        console.warn(`키 ${key}에 대한 값이 없습니다.`);
        skippedCount++;
        continue;
      }

      try {
        const agent: StoredAgent = JSON.parse(value);

        // isPlaced가 true인 agent만 처리
        if (agent.isPlaced !== true) {
          console.log(`에이전트 ${agent.card?.name || agent.url}는 placed 상태가 아닙니다. 건너뜁니다.`);
          skippedCount++;
          continue;
        }

        // creator가 없는 경우 건너뜀
        if (!agent.creator) {
          console.warn(`에이전트 ${agent.card?.name || agent.url}에 creator가 없습니다. 건너뜁니다.`);
          skippedCount++;
          continue;
        }

        // user별로 그룹핑
        if (!userPlacedAgents.has(agent.creator)) {
          userPlacedAgents.set(agent.creator, []);
        }
        userPlacedAgents.get(agent.creator)!.push({
          url: agent.url,
          timestamp: agent.timestamp
        });

        placedCount++;
        console.log(`✅ 수집됨: ${agent.card?.name || agent.url} (creator: ${agent.creator})`);

      } catch (error) {
        console.error(`❌ 에이전트 ${key} 파싱 중 오류 발생:`, error);
        errorCount++;
      }
    }

    console.log('\n=== Redis에 저장 시작 ===');

    // user별로 placed_agents hash에 저장
    let userCount = 0;
    for (const [userId, agents] of userPlacedAgents) {
      try {
        const hashKey = `user:${userId}:placed_agents`;

        // 기존 데이터 확인
        const existingCount = await redis.hLen(hashKey);
        if (existingCount > 0) {
          console.log(`⚠️  사용자 ${userId}의 placed_agents가 이미 존재합니다 (${existingCount}개). 덮어씁니다.`);
        }

        // hash에 저장
        const hashData: Record<string, string> = {};
        for (const agent of agents) {
          const agentKey = Buffer.from(agent.url).toString('base64');
          hashData[agentKey] = JSON.stringify({
            url: agent.url,
            placedAt: new Date(agent.timestamp).toISOString()
          });
        }

        await redis.hSet(hashKey, hashData);
        console.log(`✅ 사용자 ${userId}: ${agents.length}개의 placed agents 저장 완료`);
        userCount++;

      } catch (error) {
        console.error(`❌ 사용자 ${userId} 저장 중 오류 발생:`, error);
        errorCount++;
      }
    }

    console.log('\n=== 마이그레이션 완료 ===');
    console.log(`총 에이전트: ${keys.length}개`);
    console.log(`Placed 에이전트: ${placedCount}개`);
    console.log(`건너뜀: ${skippedCount}개`);
    console.log(`오류: ${errorCount}개`);
    console.log(`처리된 사용자: ${userCount}명`);

    // Redis 연결 종료
    await redis.quit();
    console.log('Redis 연결 종료');

  } catch (error) {
    console.error('마이그레이션 중 치명적 오류 발생:', error);
    process.exit(1);
  }
}

// 스크립트 실행
if (require.main === module) {
  migratePlacedAgents()
    .then(() => {
      console.log('마이그레이션이 성공적으로 완료되었습니다.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('마이그레이션 실패:', error);
      process.exit(1);
    });
}
