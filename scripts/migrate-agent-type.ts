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
import { AgentCard } from "@a2a-js/sdk";

type AgentBefore = {
  url: string;
  card: AgentCard;
  state: {
    x: number;
    y: number;
    behavior: string;
    color: string;
    spriteUrl?: string;
    spriteHeight?: number;
    spriteWidth?: number;
    moveInterval: number;
  };
  timestamp: number;
  creator?: string;
}

type AgentAfter = StoredAgent;

const AGENTS_KEY = 'agents:';

/**
 * AgentBefore 형태인지 확인하는 함수
 */
function isAgentBefore(agent: unknown): agent is AgentBefore {
  if (!agent || typeof agent !== 'object') {
    return false;
  }
  
  const a = agent as Record<string, unknown>;
  
  // AgentBefore의 필수 필드 확인
  if (!a.url || !a.card || !a.state || typeof a.timestamp !== 'number') {
    return false;
  }
  
  // AgentAfter의 새 필드가 없으면 AgentBefore로 간주
  return !('isPlaced' in a) && !('creator' in a);
}

/**
 * AgentBefore를 AgentAfter로 변환하는 함수
 */
function migrateAgent(agentBefore: AgentBefore): AgentAfter {
  return {
    url: agentBefore.url,
    card: agentBefore.card,
    state: {
      x: agentBefore.state.x,
      y: agentBefore.state.y,
      behavior: agentBefore.state.behavior,
      color: agentBefore.state.color,
      moveInterval: agentBefore.state.moveInterval,
    },
    timestamp: agentBefore.timestamp,
    spriteUrl: agentBefore.state.spriteUrl,
    spriteHeight: agentBefore.state.spriteHeight,
    isPlaced: true,
    creator: agentBefore.creator || '0x879A64d6d1fe355Ca88381E43F5286D7a453E43b',
  };
}

/**
 * 마이그레이션 메인 함수
 */
async function migrateAgents() {
  try {
    console.log('마이그레이션 시작...');
    
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
    
    let migratedCount = 0;
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
        const agent = JSON.parse(value);
        
        // 이미 AgentAfter 형태인지 확인
        if (!isAgentBefore(agent)) {
          console.log(`에이전트 ${agent.url || key}는 이미 마이그레이션되었거나 다른 형태입니다. 건너뜁니다.`);
          skippedCount++;
          continue;
        }
        
        // AgentBefore를 AgentAfter로 변환
        const migratedAgent = migrateAgent(agent);
        
        // Redis에 저장
        await redis.set(key, JSON.stringify(migratedAgent));
        
        console.log(`✅ 마이그레이션 완료: ${migratedAgent.card?.name || migratedAgent.url} (${key})`);
        migratedCount++;
        
      } catch (error) {
        console.error(`❌ 에이전트 ${key} 마이그레이션 중 오류 발생:`, error);
        errorCount++;
      }
    }
    
    console.log('\n=== 마이그레이션 완료 ===');
    console.log(`총 처리: ${keys.length}개`);
    console.log(`마이그레이션됨: ${migratedCount}개`);
    console.log(`건너뜀: ${skippedCount}개`);
    console.log(`오류: ${errorCount}개`);
    
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
  migrateAgents()
    .then(() => {
      console.log('마이그레이션이 성공적으로 완료되었습니다.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('마이그레이션 실패:', error);
      process.exit(1);
    });
}
