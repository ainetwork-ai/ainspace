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

import type { AgentCard } from '@a2a-js/sdk';

const AGENTS_KEY = 'agent:';

type MovementMode = 'village_wide' | 'spawn_centered' | 'stationary';

interface StoredAgent {
  url: string;
  card: AgentCard;
  state: {
    x?: number;
    y?: number;
    behavior?: string;
    color?: string;
    moveInterval?: number;
    movementMode?: string;
    spawnX?: number;
    spawnY?: number;
    mapName?: string;
  };
  timestamp?: number;
  creator?: string;
  spriteUrl?: string;
  spriteHeight?: number;
  isPlaced?: boolean;
}

/**
 * 에이전트에 movement mode를 설정하는 함수
 */
function setAgentMovementMode(agent: StoredAgent, mode: MovementMode): StoredAgent {
  return {
    ...agent,
    state: {
      ...agent.state,
      movementMode: mode,
      // spawnX, spawnY가 없으면 현재 위치로 설정
      spawnX: agent.state.spawnX ?? agent.state.x,
      spawnY: agent.state.spawnY ?? agent.state.y,
    }
  };
}

/**
 * 모든 에이전트의 movement mode를 기본값으로 설정
 */
async function setDefaultMovementMode(defaultMode: MovementMode = 'stationary') {
  try {
    console.log('마이그레이션 시작...');
    console.log(`기본 movement mode: ${defaultMode}`);

    // Redis 클라이언트 생성
    const redisUrl = process.env.AINSPACE_STORAGE_REDIS_URL || 'redis://localhost:6379';
    const maskedUrl = redisUrl.replace(/:[^:@]+@/, ':****@');
    console.log(`Redis URL: ${maskedUrl}`);

    if (!process.env.AINSPACE_STORAGE_REDIS_URL) {
      console.error('⚠️  경고: AINSPACE_STORAGE_REDIS_URL 환경변수가 설정되지 않았습니다. localhost를 사용합니다.');
    }

    const redis = createClient({
      url: redisUrl
    });

    redis.on('error', (err) => {
      console.error('Redis Client Error', err);
    });

    await redis.connect();
    console.log('Redis 연결 성공\n');

    // 모든 에이전트 키 가져오기
    const keys = await redis.keys(`${AGENTS_KEY}*`);
    console.log(`총 ${keys.length}개의 에이전트를 찾았습니다.\n`);

    if (keys.length === 0) {
      console.log('처리할 에이전트가 없습니다.');
      await redis.quit();
      return;
    }

    // 모든 에이전트 데이터 가져오기
    const values = await redis.mGet(keys);

    let updatedCount = 0;
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
        const valueStr = Buffer.isBuffer(value) ? value.toString('utf-8') : value;
        const agent: StoredAgent = JSON.parse(valueStr);

        // 이미 movement mode가 설정되어 있으면 건너뛰기
        if (agent.state.movementMode) {
          console.log(`⏭️  건너뜀: ${agent.card?.name || agent.url} (이미 ${agent.state.movementMode} 설정됨)`);
          skippedCount++;
          continue;
        }

        // Movement mode 설정
        const updatedAgent = setAgentMovementMode(agent, defaultMode);

        // Redis에 저장
        await redis.set(key, JSON.stringify(updatedAgent));

        const position = `(${updatedAgent.state.x}, ${updatedAgent.state.y})`;
        const spawn = `(${updatedAgent.state.spawnX}, ${updatedAgent.state.spawnY})`;
        console.log(`✅ 업데이트: ${updatedAgent.card?.name || updatedAgent.url}`);
        console.log(`   Mode: ${defaultMode}`);
        console.log(`   Position: ${position}`);
        console.log(`   Spawn: ${spawn}`);
        console.log(`   Map: ${updatedAgent.state.mapName || 'NOT SET'}\n`);
        updatedCount++;

      } catch (error) {
        console.error(`❌ 에이전트 ${key} 처리 중 오류 발생:`, error);
        errorCount++;
      }
    }

    console.log('\n=== 처리 완료 ===');
    console.log(`총 에이전트: ${keys.length}개`);
    console.log(`업데이트됨: ${updatedCount}개`);
    console.log(`건너뜀: ${skippedCount}개`);
    console.log(`오류: ${errorCount}개`);

    // Redis 연결 종료
    await redis.quit();
    console.log('\nRedis 연결 종료');

  } catch (error) {
    console.error('처리 중 치명적 오류 발생:', error);
    process.exit(1);
  }
}

// 스크립트 실행
if (require.main === module) {
  // 커맨드라인 인자로 mode 받기 (기본값: stationary)
  const mode = (process.argv[2] as MovementMode) || 'stationary';
  const validModes: MovementMode[] = ['village_wide', 'spawn_centered', 'stationary'];

  if (!validModes.includes(mode)) {
    console.error(`❌ 잘못된 movement mode: ${mode}`);
    console.log(`사용 가능한 모드: ${validModes.join(', ')}`);
    process.exit(1);
  }

  setDefaultMovementMode(mode)
    .then(() => {
      console.log('\n처리가 성공적으로 완료되었습니다.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('처리 실패:', error);
      process.exit(1);
    });
}
