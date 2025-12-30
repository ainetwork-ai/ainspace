// 환경변수 로딩 (가장 먼저 실행되어야 함)
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from 'redis';
import * as readline from 'readline';

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
 * readline 인터페이스 생성
 */
function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * 사용자 입력 받기
 */
function question(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

/**
 * 대화형으로 에이전트 선택하기
 */
async function selectAgentsToOffset(agents: StoredAgent[]): Promise<StoredAgent[]> {
  const rl = createReadlineInterface();
  const selectedAgents: StoredAgent[] = [];
  
  try {
    console.log('\n=== 에이전트 목록 ===');
    agents.forEach((agent, index) => {
      const name = agent.card?.name || agent.url;
      const location = `(${agent.state.x}, ${agent.state.y})`;
      console.log(`  ${index + 1}. ${name} - 위치: ${location}`);
    });
    
    console.log('\n위치를 조정할 에이전트를 선택하세요.');
    console.log('(번호를 쉼표로 구분하여 입력하세요. 예: 1,3,5 또는 모두 선택하려면 "all", 선택 안 하려면 Enter)');
    
    const answer = await question(rl, '\n선택: ');
    
    if (answer.trim().toLowerCase() === 'all') {
      // 모든 에이전트 선택
      selectedAgents.push(...agents);
      console.log('\n모든 에이전트를 선택 목록에 추가했습니다.');
    } else if (answer.trim() === '') {
      // 아무것도 선택하지 않음
      console.log('\n선택된 에이전트가 없습니다.');
    } else {
      // 번호로 선택
      const selectedIndices = answer
        .split(',')
        .map(s => s.trim())
        .map(s => parseInt(s, 10))
        .filter(n => !isNaN(n) && n >= 1 && n <= agents.length);
      
      if (selectedIndices.length === 0) {
        console.log('\n⚠️  유효한 번호가 없습니다. 선택된 에이전트가 없습니다.');
      } else {
        // 중복 제거 및 정렬
        const uniqueIndices = [...new Set(selectedIndices)].sort((a, b) => a - b);
        
        for (const index of uniqueIndices) {
          selectedAgents.push(agents[index - 1]);
        }
        
        console.log(`\n선택된 에이전트 ${selectedAgents.length}개:`);
        selectedAgents.forEach((agent, idx) => {
          const location = `(${agent.state.x}, ${agent.state.y})`;
          console.log(`  ${idx + 1}. ${agent.card?.name || agent.url} - 위치: ${location}`);
        });
      }
    }
  } finally {
    rl.close();
  }
  
  return selectedAgents;
}

/**
 * 대화형으로 offset 값 입력받기
 */
async function getOffsetValues(): Promise<{ x: number; y: number }> {
  const rl = createReadlineInterface();
  
  try {
    console.log('\n=== Offset 값 입력 ===');
    console.log('에이전트 위치를 이동시킬 offset 값을 입력하세요.');
    console.log('(양수: 오른쪽/아래쪽, 음수: 왼쪽/위쪽)');
    
    const xInput = await question(rl, 'X축 offset (기본값: 0): ');
    const yInput = await question(rl, 'Y축 offset (기본값: 0): ');
    
    const x = xInput.trim() === '' ? 0 : parseInt(xInput.trim(), 10);
    const y = yInput.trim() === '' ? 0 : parseInt(yInput.trim(), 10);
    
    if (isNaN(x) || isNaN(y)) {
      console.log('\n⚠️  유효하지 않은 값입니다. 기본값 0을 사용합니다.');
      return { x: 0, y: 0 };
    }
    
    console.log(`\n입력된 offset: X=${x}, Y=${y}`);
    return { x, y };
  } finally {
    rl.close();
  }
}

/**
 * 에이전트 위치를 offset만큼 조정하는 메인 함수
 */
async function offsetAgentLocations() {
  try {
    console.log('에이전트 위치 offset 조정 시작...');
    
    // 환경변수 확인 및 Redis 클라이언트 직접 생성
    const redisUrl = process.env.AINSPACE_STORAGE_REDIS_URL || 'redis://localhost:6379';
    
    if (!process.env.AINSPACE_STORAGE_REDIS_URL) {
      console.error('⚠️  경고: AINSPACE_STORAGE_REDIS_URL 환경변수가 설정되지 않았습니다. localhost를 사용합니다.');
    }
    
    // Redis 클라이언트 직접 생성
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
    console.log(`총 ${keys.length}개의 에이전트를 찾았습니다.`);
    
    if (keys.length === 0) {
      console.log('업데이트할 에이전트가 없습니다.');
      await redis.quit();
      return;
    }
    
    // 모든 에이전트 데이터 가져오기
    const values = await redis.mGet(keys);
    const agents: StoredAgent[] = [];
    
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const value = values[i];
      
      if (!value) {
        console.warn(`키 ${key}에 대한 값이 없습니다.`);
        continue;
      }
      
      try {
        const agent = JSON.parse(value) as StoredAgent;
        if (agent && agent.url && agent.card && agent.state && agent.isPlaced) {
          agents.push(agent);
        }
      } catch (error) {
        console.error(`에이전트 ${key} 파싱 중 오류 발생:`, error);
      }
    }
    
    console.log(`유효한 에이전트 ${agents.length}개를 찾았습니다.`);
    
    if (agents.length === 0) {
      console.log('유효한 에이전트가 없습니다.');
      await redis.quit();
      return;
    }
    
    // 위치를 조정할 에이전트 선택 (대화형)
    const selectedAgents = await selectAgentsToOffset(agents);
    
    if (selectedAgents.length === 0) {
      console.log('위치를 조정할 에이전트가 없습니다.');
      await redis.quit();
      return;
    }
    
    // Offset 값 입력받기
    const offset = await getOffsetValues();
    
    if (offset.x === 0 && offset.y === 0) {
      console.log('\n⚠️  Offset 값이 모두 0입니다. 위치가 변경되지 않습니다.');
      const confirm = await question(createReadlineInterface(), '계속하시겠습니까? (y/n, 기본값: n): ');
      if (confirm.trim().toLowerCase() !== 'y') {
        console.log('작업이 취소되었습니다.');
        await redis.quit();
        return;
      }
    }
    
    // 선택된 에이전트들의 위치를 offset만큼 이동
    console.log(`\n=== 위치 조정 시작 ===`);
    console.log(`선택된 에이전트: ${selectedAgents.length}개`);
    console.log(`Offset: X=${offset.x}, Y=${offset.y}`);
    
    let updatedCount = 0;
    let errorCount = 0;
    
    for (const agent of selectedAgents) {
      try {
        const oldX = agent.state.x;
        const oldY = agent.state.y;
        const newX = oldX + offset.x;
        const newY = oldY + offset.y;
        
        // 에이전트 상태 업데이트
        const updatedAgent: StoredAgent = {
          ...agent,
          state: {
            ...agent.state,
            x: newX,
            y: newY
          }
        };
        
        // Redis에 업데이트
        const agentKey = `${AGENTS_KEY}${Buffer.from(agent.url).toString('base64')}`;
        await redis.set(agentKey, JSON.stringify(updatedAgent));
        
        console.log(`  ✓ ${agent.card?.name || agent.url}: (${oldX}, ${oldY}) → (${newX}, ${newY})`);
        updatedCount++;
        
      } catch (error) {
        console.error(`  ✗ 에이전트 ${agent.url} 업데이트 중 오류 발생:`, error);
        errorCount++;
      }
    }
    
    console.log('\n=== 위치 조정 완료 ===');
    console.log(`총 에이전트: ${agents.length}개`);
    console.log(`선택된 에이전트: ${selectedAgents.length}개`);
    console.log(`Offset: X=${offset.x}, Y=${offset.y}`);
    console.log(`업데이트됨: ${updatedCount}개`);
    console.log(`오류: ${errorCount}개`);
    
    // Redis 연결 종료
    await redis.quit();
    console.log('Redis 연결 종료');
    
  } catch (error) {
    console.error('위치 조정 중 치명적 오류 발생:', error);
    process.exit(1);
  }
}

// 스크립트 실행
if (require.main === module) {
  // help 옵션 확인
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('\n사용법: npx tsx scripts/offsetAgentLocation.ts');
    console.log('\n설명:');
    console.log('  대화형으로 에이전트를 선택하여 위치를 offset만큼 이동시킬 수 있습니다.');
    console.log('  예: X축 -30, Y축 -60을 입력하면 선택된 모든 에이전트가 왼쪽으로 30, 위로 60만큼 이동합니다.');
    console.log('\n옵션:');
    console.log('  --help, -h  도움말 표시');
    console.log('\n예시:');
    console.log('  npx tsx scripts/offsetAgentLocation.ts');
    console.log('    # 대화형으로 에이전트 선택 및 offset 값 입력\n');
    process.exit(0);
  }
  
  offsetAgentLocations()
    .then(() => {
      console.log('\n에이전트 위치 offset 조정이 성공적으로 완료되었습니다.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('위치 조정 실패:', error);
      process.exit(1);
    });
}

