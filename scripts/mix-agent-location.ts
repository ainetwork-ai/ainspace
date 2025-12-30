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

// 배치 중심 좌표 (page.tsx에서 참조)
const DEPLOY_ZONE_CENTERS = [
  { x: 34, y: 70 },   // West zone (25 tiles left)
  { x: 84, y: 70 },   // East zone (25 tiles right)
  { x: 59, y: 45 },   // North zone (25 tiles up)
  { x: 59, y: 95 },   // South zone (25 tiles down)
  { x: 81, y: 48 },   // Northeast zone (diagonal, ~31 tiles away)
];

const MAX_SEARCH_RADIUS = 3;  // 각 그룹 내에서의 최대 반경
const GROUP_SIZE = 4;          // 그룹당 에이전트 수

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
async function selectAgentsToExclude(agents: StoredAgent[]): Promise<StoredAgent[]> {
  const rl = createReadlineInterface();
  const excludedAgents: StoredAgent[] = [];
  
  try {
    console.log('\n=== 에이전트 목록 ===');
    agents.forEach((agent, index) => {
      const name = agent.card?.name || agent.url;
      const location = `(${agent.state.x}, ${agent.state.y})`;
      console.log(`  ${index + 1}. ${name} - 위치: ${location}`);
    });
    
    console.log('\n위치를 섞지 않을 에이전트를 선택하세요.');
    console.log('(번호를 쉼표로 구분하여 입력하세요. 예: 1,3,5 또는 모두 선택하려면 "all", 선택 안 하려면 Enter)');
    
    const answer = await question(rl, '\n선택: ');
    
    if (answer.trim().toLowerCase() === 'all') {
      // 모든 에이전트 제외
      excludedAgents.push(...agents);
      console.log('\n모든 에이전트를 제외 목록에 추가했습니다.');
    } else if (answer.trim() === '') {
      // 아무것도 선택하지 않음
      console.log('\n제외할 에이전트가 없습니다.');
    } else {
      // 번호로 선택
      const selectedIndices = answer
        .split(',')
        .map(s => s.trim())
        .map(s => parseInt(s, 10))
        .filter(n => !isNaN(n) && n >= 1 && n <= agents.length);
      
      if (selectedIndices.length === 0) {
        console.log('\n⚠️  유효한 번호가 없습니다. 제외할 에이전트가 없습니다.');
      } else {
        // 중복 제거 및 정렬
        const uniqueIndices = [...new Set(selectedIndices)].sort((a, b) => a - b);
        
        for (const index of uniqueIndices) {
          excludedAgents.push(agents[index - 1]);
        }
        
        console.log(`\n선택된 에이전트 ${excludedAgents.length}개:`);
        excludedAgents.forEach((agent, idx) => {
          console.log(`  ${idx + 1}. ${agent.card?.name || agent.url}`);
        });
      }
    }
  } finally {
    rl.close();
  }
  
  return excludedAgents;
}

/**
 * 중심 좌표 주변에 랜덤 위치 생성
 */
function generateRandomPosition(centerX: number, centerY: number, radius: number): { x: number; y: number } {
  // 원형 분포를 위한 극좌표 사용
  const angle = Math.random() * 2 * Math.PI;
  const distance = Math.random() * radius;
  
  return {
    x: Math.round(centerX + distance * Math.cos(angle)),
    y: Math.round(centerY + distance * Math.sin(angle))
  };
}

/**
 * 대화형으로 그룹 구성하기
 */
async function createGroupsManually(agents: StoredAgent[]): Promise<StoredAgent[][]> {
  const rl = createReadlineInterface();
  const groups: StoredAgent[][] = [];
  const usedIndices = new Set<number>();
  
  try {
    console.log('\n=== 그룹 구성하기 ===');
    console.log('각 그룹에 포함할 에이전트를 선택하세요.');
    console.log('(번호를 쉼표로 구분하여 입력하세요. 예: 1,3,5,7)');
    console.log('(그룹 생성을 완료하려면 Enter를 누르세요)');
    
    let groupNumber = 1;
    
    while (true) {
      // 사용 가능한 에이전트 목록 표시
      const availableAgents = agents.filter((_, index) => !usedIndices.has(index));
      
      if (availableAgents.length === 0) {
        console.log('\n모든 에이전트가 그룹에 배정되었습니다.');
        break;
      }
      
      console.log(`\n--- 그룹 ${groupNumber} 구성 ---`);
      console.log('에이전트 목록:');
      agents.forEach((agent, index) => {
        const agentNumber = index + 1;
        const name = agent.card?.name || agent.url;
        const location = `(${agent.state.x}, ${agent.state.y})`;
        const status = usedIndices.has(index) ? '[이미 배정됨]' : '[사용 가능]';
        console.log(`  ${agentNumber}. ${name} - 위치: ${location} ${status}`);
      });
      
      const answer = await question(rl, `\n그룹 ${groupNumber}에 포함할 에이전트 번호 (Enter로 완료): `);
      
      if (answer.trim() === '') {
        // Enter를 누르면 그룹 생성 완료
        if (groups.length === 0) {
          console.log('\n⚠️  최소 하나의 그룹은 필요합니다.');
          continue;
        }
        break;
      }
      
      // 번호로 선택
      const selectedIndices = answer
        .split(',')
        .map(s => s.trim())
        .map(s => parseInt(s, 10))
        .filter(n => !isNaN(n) && n >= 1 && n <= agents.length);
      
      if (selectedIndices.length === 0) {
        console.log('\n⚠️  유효한 번호가 없습니다. 다시 입력하세요.');
        continue;
      }
      
      // 중복 제거 및 정렬
      const uniqueIndices = [...new Set(selectedIndices)].sort((a, b) => a - b);
      
      // 이미 사용된 에이전트가 있는지 확인
      const alreadyUsed = uniqueIndices.filter(idx => usedIndices.has(idx - 1));
      if (alreadyUsed.length > 0) {
        console.log(`\n⚠️  이미 다른 그룹에 배정된 에이전트가 있습니다: ${alreadyUsed.join(', ')}`);
        continue;
      }
      
      // 그룹 생성
      const group: StoredAgent[] = [];
      for (const index of uniqueIndices) {
        const agentIndex = index - 1;
        group.push(agents[agentIndex]);
        usedIndices.add(agentIndex);
      }
      
      groups.push(group);
      console.log(`\n그룹 ${groupNumber} 생성 완료: ${group.length}명`);
      group.forEach((agent, idx) => {
        console.log(`  ${idx + 1}. ${agent.card?.name || agent.url}`);
      });
      
      groupNumber++;
      
      // 남은 에이전트가 없으면 종료
      if (usedIndices.size >= agents.length) {
        console.log('\n모든 에이전트가 그룹에 배정되었습니다.');
        break;
      }
    }
    
    // 남은 에이전트가 있으면 알림
    const remainingCount = agents.length - usedIndices.size;
    if (remainingCount > 0) {
      console.log(`\n⚠️  ${remainingCount}명의 에이전트가 그룹에 배정되지 않았습니다.`);
      console.log('이 에이전트들은 위치가 변경되지 않습니다.');
    }
    
  } finally {
    rl.close();
  }
  
  return groups;
}

/**
 * 에이전트들을 자동으로 4명씩 그룹으로 나누기
 */
function groupAgentsAuto(agents: StoredAgent[]): StoredAgent[][] {
  const groups: StoredAgent[][] = [];
  
  // 에이전트를 섞기
  const shuffled = [...agents].sort(() => Math.random() - 0.5);
  
  // 4명씩 그룹으로 나누기
  for (let i = 0; i < shuffled.length; i += GROUP_SIZE) {
    const group = shuffled.slice(i, i + GROUP_SIZE);
    if (group.length === GROUP_SIZE) {
      groups.push(group);
    }
  }
  
  return groups;
}

/**
 * 에이전트 위치를 랜덤으로 섞어서 업데이트하는 메인 함수
 */
async function mixAgentLocations() {
  try {
    console.log('에이전트 위치 섞기 시작...');
    
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
    
    // 위치를 섞지 않을 에이전트 선택 (대화형)
    const excludedAgents = await selectAgentsToExclude(agents);
    const agentsToMix: StoredAgent[] = [];
    
    // 제외된 에이전트 URL 목록
    const excludedUrls = new Set(excludedAgents.map(a => a.url));
    
    // 나머지는 위치를 섞을 에이전트
    agentsToMix.push(...agents.filter(agent => !excludedUrls.has(agent.url)));
    
    if (excludedAgents.length > 0) {
      console.log(`\n위치를 섞지 않을 에이전트: ${excludedAgents.length}개`);
      console.log(`위치를 섞을 에이전트: ${agentsToMix.length}개`);
    } else {
      console.log(`\n모든 에이전트의 위치를 섞습니다: ${agentsToMix.length}개`);
    }
    
    if (agentsToMix.length === 0) {
      console.log('위치를 섞을 에이전트가 없습니다.');
      await redis.quit();
      return;
    }
    
    // 그룹 구성 방식 선택
    const rl = createReadlineInterface();
    let groups: StoredAgent[][];
    
    try {
      console.log('\n그룹 구성을 선택하세요:');
      console.log('  1. 수동으로 그룹 구성 (각 그룹에 포함할 에이전트를 직접 선택)');
      console.log('  2. 자동으로 그룹 구성 (4명씩 자동 배정)');
      
      const answer = await question(rl, '\n선택 (1 또는 2, 기본값: 2): ');
      
      if (answer.trim() === '1') {
        // 수동으로 그룹 구성
        groups = await createGroupsManually(agentsToMix);
      } else {
        // 자동으로 그룹 구성
        groups = groupAgentsAuto(agentsToMix);
      }
    } finally {
      rl.close();
    }
    
    if (groups.length === 0) {
      console.log('그룹이 생성되지 않았습니다.');
      await redis.quit();
      return;
    }
    
    console.log(`\n총 ${groups.length}개의 그룹으로 나누었습니다.`);
    
    // 각 그룹의 크기 출력
    groups.forEach((group, index) => {
      console.log(`  그룹 ${index + 1}: ${group.length}명`);
    });
    
    // 각 그룹을 랜덤한 중심 좌표에 배치
    let updatedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      
      // 사용 가능한 중심 좌표 중 랜덤 선택
      // 그룹이 중심 좌표보다 많으면 순환 사용
      const zoneIndex = i % DEPLOY_ZONE_CENTERS.length;
      const center = DEPLOY_ZONE_CENTERS[zoneIndex];
      
      console.log(`\n그룹 ${i + 1} (${group.length}명)을 중심 좌표 (${center.x}, ${center.y})에 배치 중...`);
      
      // 각 에이전트에 랜덤 위치 할당
      for (const agent of group) {
        try {
          const newPosition = generateRandomPosition(center.x, center.y, MAX_SEARCH_RADIUS);
          
          // 에이전트 상태 업데이트
          const updatedAgent: StoredAgent = {
            ...agent,
            state: {
              ...agent.state,
              x: newPosition.x,
              y: newPosition.y
            }
          };
          
          // Redis에 업데이트
          const agentKey = `${AGENTS_KEY}${Buffer.from(agent.url).toString('base64')}`;
          await redis.set(agentKey, JSON.stringify(updatedAgent));
          
          console.log(`  ✓ ${agent.card?.name || agent.url}: (${agent.state.x}, ${agent.state.y}) → (${newPosition.x}, ${newPosition.y})`);
          updatedCount++;
          
        } catch (error) {
          console.error(`  ✗ 에이전트 ${agent.url} 업데이트 중 오류 발생:`, error);
          errorCount++;
        }
      }
    }
    
    console.log('\n=== 위치 섞기 완료 ===');
    console.log(`총 에이전트: ${agents.length}개`);
    console.log(`위치 섞기 제외: ${excludedAgents.length}개`);
    console.log(`위치 섞기 대상: ${agentsToMix.length}개`);
    console.log(`그룹 수: ${groups.length}개`);
    console.log(`업데이트됨: ${updatedCount}개`);
    console.log(`오류: ${errorCount}개`);
    
    // Redis 연결 종료
    await redis.quit();
    console.log('Redis 연결 종료');
    
  } catch (error) {
    console.error('위치 섞기 중 치명적 오류 발생:', error);
    process.exit(1);
  }
}

// 스크립트 실행
if (require.main === module) {
  // help 옵션 확인
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('\n사용법: npx tsx scripts/mixAgentLocation.ts');
    console.log('\n설명:');
    console.log('  대화형으로 에이전트를 선택하여 위치를 섞지 않을 에이전트를 지정할 수 있습니다.');
    console.log('  그룹 구성을 수동으로 선택하거나 자동으로 배정할 수 있습니다.');
    console.log('\n옵션:');
    console.log('  --help, -h  도움말 표시');
    console.log('\n예시:');
    console.log('  npx tsx scripts/mixAgentLocation.ts');
    console.log('    # 대화형으로 에이전트 제외 및 그룹 구성\n');
    process.exit(0);
  }
  
  mixAgentLocations()
    .then(() => {
      console.log('\n에이전트 위치 섞기가 성공적으로 완료되었습니다.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('위치 섞기 실패:', error);
      process.exit(1);
    });
}

