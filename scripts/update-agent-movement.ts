// 환경변수 로딩 (가장 먼저 실행되어야 함)
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient, RedisClientType } from 'redis';
import * as readline from 'readline';
import { MOVEMENT_MODE } from '@/constants/game';

// .env.local 파일 우선, 없으면 .env 파일 로드
const envLocalResult = config({ path: resolve(process.cwd(), '.env.local') });
const envResult = config({ path: resolve(process.cwd(), '.env') });

if (envLocalResult.error && envResult.error) {
  console.warn('환경변수 파일을 찾을 수 없습니다. 시스템 환경변수를 사용합니다.');
} else {
  console.log('환경변수 파일 로드 완료');
}

import type { AgentCard } from '@a2a-js/sdk';

const AGENTS_KEY = 'agents:';

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

// 전역 readline 인터페이스
let globalRl: readline.Interface | null = null;

/**
 * 전역 readline 인터페이스 가져오기
 */
function getReadlineInterface(): readline.Interface {
  if (!globalRl) {
    globalRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  return globalRl;
}

/**
 * 전역 readline 인터페이스 닫기
 */
function closeReadlineInterface() {
  if (globalRl) {
    globalRl.close();
    globalRl = null;
  }
}

/**
 * 사용자 입력 받기
 */
function question(query: string): Promise<string> {
  const rl = getReadlineInterface();
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

/**
 * 모드 선택 메뉴 표시
 */
async function selectMode(): Promise<MOVEMENT_MODE | null> {
  const modes = Object.values(MOVEMENT_MODE);

  console.log('\n=== Movement Mode 선택 ===');
  modes.forEach((mode, index) => {
    console.log(`  ${index + 1}. ${mode}`);
  });
  console.log(`  ${modes.length + 1}. 종료`);

  const answer = await question('\n선택: ');
  const choice = parseInt(answer.trim(), 10);

  if (isNaN(choice) || choice < 1 || choice > modes.length + 1) {
    console.log('\n⚠️  유효하지 않은 선택입니다.');
    return selectMode();
  }

  if (choice === modes.length + 1) {
    return null; // 종료
  }

  return modes[choice - 1];
}

/**
 * 에이전트 목록 출력
 */
function printAgentList(agents: StoredAgent[]) {
  console.log('\n=== 에이전트 목록 ===');
  agents.forEach((agent, index) => {
    const name = agent.card?.name || agent.url;
    const currentMode = agent.state.movementMode || 'NOT SET';
    const location = `(${agent.state.x}, ${agent.state.y})`;
    console.log(`  ${index + 1}. ${name} - 위치: ${location} - 현재 모드: ${currentMode}`);
  });
}

/**
 * 대화형으로 에이전트 선택하기
 */
async function selectAgents(agents: StoredAgent[]): Promise<StoredAgent[]> {
  printAgentList(agents);

  console.log('\nmovement mode를 변경할 에이전트를 선택하세요.');
  console.log('(번호를 쉼표로 구분하여 입력하세요. 예: 1,3,5 또는 모두 선택하려면 "all", 취소하려면 Enter)');

  const answer = await question('\n선택: ');

  if (answer.trim().toLowerCase() === 'all') {
    console.log('\n모든 에이전트를 선택했습니다.');
    return [...agents];
  }

  if (answer.trim() === '') {
    console.log('\n선택된 에이전트가 없습니다.');
    return [];
  }

  const selectedIndices = answer
    .split(',')
    .map(s => s.trim())
    .map(s => parseInt(s, 10))
    .filter(n => !isNaN(n) && n >= 1 && n <= agents.length);

  if (selectedIndices.length === 0) {
    console.log('\n⚠️  유효한 번호가 없습니다.');
    return [];
  }

  const uniqueIndices = [...new Set(selectedIndices)].sort((a, b) => a - b);
  const selectedAgents = uniqueIndices.map(index => agents[index - 1]);

  console.log(`\n선택된 에이전트 ${selectedAgents.length}개:`);
  selectedAgents.forEach((agent, idx) => {
    console.log(`  ${idx + 1}. ${agent.card?.name || agent.url}`);
  });

  return selectedAgents;
}

/**
 * 에이전트에 movement mode를 설정하는 함수
 */
function setAgentMovementMode(agent: StoredAgent, mode: MOVEMENT_MODE): StoredAgent {
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
 * Redis에서 에이전트 데이터 로드
 */
async function loadAgents(redis: RedisClientType): Promise<{ key: string; agent: StoredAgent }[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const result = await redis.scan(cursor, { MATCH: `${AGENTS_KEY}*`, COUNT: 100 });
    cursor = String(result.cursor);
    keys.push(...result.keys);
  } while (cursor !== '0');

  if (keys.length === 0) {
    return [];
  }

  const values = await redis.mGet(keys);
  const agents: { key: string; agent: StoredAgent }[] = [];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = values[i];

    if (!value) continue;

    try {
      const valueStr = Buffer.isBuffer(value) ? value.toString('utf-8') : value;
      const agent: StoredAgent = JSON.parse(valueStr);
      console.log(agent);
      // isPlaced = true인 에이전트만 포함
      if (agent.isPlaced) {
        agents.push({ key, agent });
      }
    } catch {
      console.warn(`키 ${key} 파싱 실패`);
    }
  }

  return agents;
}

/**
 * 선택한 에이전트들의 movement mode 업데이트
 */
async function updateSelectedAgents(
  redis: RedisClientType,
  agentData: { key: string; agent: StoredAgent }[],
  selectedAgents: StoredAgent[],
  targetMode: MOVEMENT_MODE
): Promise<{ updatedCount: number; errorCount: number }> {
  const selectedUrls = new Set(selectedAgents.map(a => a.url));

  let updatedCount = 0;
  let errorCount = 0;

  for (const { key, agent } of agentData) {
    if (!selectedUrls.has(agent.url)) continue;

    try {
      const updatedAgent = setAgentMovementMode(agent, targetMode);
      await redis.set(key, JSON.stringify(updatedAgent));

      // 원본 데이터도 업데이트 (다음 루프에서 최신 상태 반영)
      agent.state.movementMode = targetMode;
      agent.state.spawnX = updatedAgent.state.spawnX;
      agent.state.spawnY = updatedAgent.state.spawnY;

      const position = `(${updatedAgent.state.x}, ${updatedAgent.state.y})`;
      const spawn = `(${updatedAgent.state.spawnX}, ${updatedAgent.state.spawnY})`;
      console.log(`✅ 업데이트: ${updatedAgent.card?.name || updatedAgent.url}`);
      console.log(`   Mode: ${targetMode}`);
      console.log(`   Position: ${position}`);
      console.log(`   Spawn: ${spawn}`);
      console.log(`   Map: ${updatedAgent.state.mapName || 'NOT SET'}\n`);
      updatedCount++;

    } catch (error) {
      console.error(`❌ 에이전트 ${key} 처리 중 오류 발생:`, error);
      errorCount++;
    }
  }

  return { updatedCount, errorCount };
}

/**
 * 메인 대화형 루프
 */
async function interactiveLoop() {
  console.log('에이전트 Movement Mode 업데이트 스크립트');
  console.log('=====================================');

  // Redis 연결
  const redisUrl = process.env.AINSPACE_STORAGE_REDIS_URL || 'redis://localhost:6379';
  const maskedUrl = redisUrl.replace(/:[^:@]+@/, ':****@');
  console.log(`Redis URL: ${maskedUrl}`);

  if (!process.env.AINSPACE_STORAGE_REDIS_URL) {
    console.error('⚠️  경고: AINSPACE_STORAGE_REDIS_URL 환경변수가 설정되지 않았습니다. localhost를 사용합니다.');
  }

  const redis = createClient({ url: redisUrl });

  redis.on('error', (err) => {
    console.error('Redis Client Error', err);
  });

  await redis.connect();
  console.log('Redis 연결 성공');

  try {
    // 에이전트 데이터 로드
    const agentData = await loadAgents(redis as RedisClientType);
    console.log(`총 ${agentData.length}개의 에이전트를 찾았습니다.`);

    if (agentData.length === 0) {
      console.log('처리할 에이전트가 없습니다.');
      return;
    }

    let totalUpdated = 0;
    let totalErrors = 0;

    // 대화형 루프
    while (true) {
      const selectedMode = await selectMode();

      if (selectedMode === null) {
        console.log('\n프로그램을 종료합니다.');
        break;
      }

      console.log(`\n선택된 모드: ${selectedMode}`);

      const selectedAgents = await selectAgents(agentData.map(a => a.agent));

      if (selectedAgents.length === 0) {
        console.log('선택된 에이전트가 없습니다. 다시 시도하세요.');
        continue;
      }

      const { updatedCount, errorCount } = await updateSelectedAgents(
        redis as RedisClientType,
        agentData,
        selectedAgents,
        selectedMode
      );

      totalUpdated += updatedCount;
      totalErrors += errorCount;

      console.log('\n--- 이번 작업 결과 ---');
      console.log(`업데이트됨: ${updatedCount}개`);
      console.log(`오류: ${errorCount}개`);
    }

    console.log('\n=== 최종 처리 결과 ===');
    console.log(`총 에이전트: ${agentData.length}개`);
    console.log(`총 업데이트됨: ${totalUpdated}개`);
    console.log(`총 오류: ${totalErrors}개`);

  } finally {
    await redis.quit();
    console.log('Redis 연결 종료');
    closeReadlineInterface();
  }
}

// 스크립트 실행
if (require.main === module) {
  interactiveLoop()
    .then(() => {
      console.log('\n처리가 성공적으로 완료되었습니다.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('처리 실패:', error);
      process.exit(1);
    });
}
