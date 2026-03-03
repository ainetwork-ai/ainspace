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

const MOVEMENT_MODES = ['village_wide', 'spawn_centered', 'stationary'] as const;
type MovementMode = typeof MOVEMENT_MODES[number];

function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function question(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

type SelectionResult = { type: 'all' } | { type: 'indices'; indices: number[] } | null;

/**
 * 대화형으로 에이전트 선택
 */
async function selectAgents(agents: StoredAgent[]): Promise<SelectionResult> {
  const rl = createReadlineInterface();

  try {
    console.log('\n=== 에이전트 목록 ===');
    agents.forEach((agent, index) => {
      const name = agent.card?.name || agent.url;
      const location = `(${agent.state.x}, ${agent.state.y})`;
      const map = agent.state.mapName || 'unknown';
      const mode = agent.state.movementMode || 'not set';
      console.log(`  ${index + 1}. ${name} - 위치: ${location} [${map}] (${mode})`);
    });

    const answer = await question(rl, '\n에이전트 번호를 선택하세요 (여러 개: 1,3,5 / 모두: all): ');

    if (answer.trim() === '') {
      console.log('\n선택된 에이전트가 없습니다.');
      return null;
    }

    if (answer.trim().toLowerCase() === 'all') {
      return { type: 'all' };
    }

    const indices = answer
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && n >= 1 && n <= agents.length);

    if (indices.length === 0) {
      console.log('\n⚠️  유효한 번호가 없습니다.');
      return null;
    }

    return { type: 'indices', indices: [...new Set(indices)].map(n => n - 1) };
  } finally {
    rl.close();
  }
}

/**
 * 절대 좌표 입력받기
 */
async function getTargetPosition(current: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const rl = createReadlineInterface();

  try {
    console.log(`\n현재 위치: (${current.x}, ${current.y})`);
    console.log('이동할 목표 좌표를 입력하세요. (Enter: 현재값 유지)');

    const xInput = await question(rl, `X 좌표 (현재: ${current.x}): `);
    const yInput = await question(rl, `Y 좌표 (현재: ${current.y}): `);

    const x = xInput.trim() === '' ? current.x : parseInt(xInput.trim(), 10);
    const y = yInput.trim() === '' ? current.y : parseInt(yInput.trim(), 10);

    if (isNaN(x) || isNaN(y)) {
      console.log('\n⚠️  유효하지 않은 값입니다. 현재 위치를 유지합니다.');
      return current;
    }

    return { x, y };
  } finally {
    rl.close();
  }
}

/**
 * movement mode 입력받기
 */
async function getMovementMode(current: string | undefined): Promise<MovementMode | null> {
  const rl = createReadlineInterface();

  try {
    console.log(`\n=== Movement Mode ===`);
    console.log(`현재: ${current || 'not set'}`);
    MOVEMENT_MODES.forEach((mode, i) => {
      console.log(`  ${i + 1}. ${mode}`);
    });
    console.log('  Enter: 변경 안 함');

    const answer = await question(rl, '\n선택: ');

    if (answer.trim() === '') {
      return null; // 변경 안 함
    }

    const idx = parseInt(answer.trim(), 10);
    if (isNaN(idx) || idx < 1 || idx > MOVEMENT_MODES.length) {
      console.log('⚠️  유효하지 않은 선택입니다. 변경하지 않습니다.');
      return null;
    }

    return MOVEMENT_MODES[idx - 1];
  } finally {
    rl.close();
  }
}

/**
 * 에이전트를 절대 좌표로 이동 + movement mode 변경
 */
async function moveAgent() {
  const redisUrl = process.env.AINSPACE_STORAGE_REDIS_URL || 'redis://localhost:6379';

  if (!process.env.AINSPACE_STORAGE_REDIS_URL) {
    console.warn('⚠️  경고: AINSPACE_STORAGE_REDIS_URL 환경변수가 설정되지 않았습니다. localhost를 사용합니다.');
  }

  const redis = createClient({ url: redisUrl });
  redis.on('error', (err) => console.error('Redis Client Error', err));
  await redis.connect();
  console.log('Redis 연결 성공');

  try {
    // 에이전트 목록 로드
    const keys = await redis.keys(`${AGENTS_KEY}*`);
    console.log(`총 ${keys.length}개의 에이전트 키를 찾았습니다.`);

    if (keys.length === 0) {
      console.log('에이전트가 없습니다.');
      return;
    }

    const values = await redis.mGet(keys);
    const agents: StoredAgent[] = [];
    const agentKeys: string[] = [];

    for (let i = 0; i < keys.length; i++) {
      if (!values[i]) continue;
      try {
        const agent = JSON.parse(values[i]!) as StoredAgent;
        if (agent?.url && agent?.state) {
          agents.push(agent);
          agentKeys.push(keys[i]);
        }
      } catch {
        console.warn(`키 ${keys[i]} 파싱 실패, 스킵`);
      }
    }

    console.log(`유효한 에이전트 ${agents.length}개`);
    if (agents.length === 0) return;

    // 에이전트 선택
    const selection = await selectAgents(agents);
    if (!selection) return;

    const selectedIndices = selection.type === 'all'
      ? agents.map((_, i) => i)
      : selection.indices;

    // 목표 좌표 입력
    const firstAgent = agents[selectedIndices[0]];
    const target = await getTargetPosition({ x: firstAgent.state.x, y: firstAgent.state.y });

    // movement mode 입력
    const newMode = await getMovementMode(firstAgent.state.movementMode);

    // 변경사항 없는 경우 체크
    const posChanged = target.x !== firstAgent.state.x || target.y !== firstAgent.state.y;
    if (!posChanged && !newMode && selectedIndices.length === 1) {
      console.log('\n변경사항이 없습니다. 작업을 종료합니다.');
      return;
    }

    // 확인
    const rl = createReadlineInterface();
    console.log(`\n=== 변경 예정 ===`);
    for (const idx of selectedIndices) {
      const a = agents[idx];
      const name = a.card?.name || a.url;
      const posStr = posChanged
        ? `(${a.state.x}, ${a.state.y}) → (${target.x}, ${target.y})`
        : `(${a.state.x}, ${a.state.y}) (유지)`;
      const modeStr = newMode
        ? `${a.state.movementMode || 'not set'} → ${newMode}`
        : `${a.state.movementMode || 'not set'} (유지)`;
      console.log(`  ${name}: ${posStr} | mode: ${modeStr}`);
    }
    const confirm = await question(rl, '\n진행하시겠습니까? (y/n): ');
    rl.close();

    if (confirm.trim().toLowerCase() !== 'y') {
      console.log('작업이 취소되었습니다.');
      return;
    }

    // 실행
    let updated = 0;
    for (const idx of selectedIndices) {
      const agent = agents[idx];
      const key = agentKeys[idx];

      const updatedAgent: StoredAgent = {
        ...agent,
        state: {
          ...agent.state,
          x: target.x,
          y: target.y,
          spawnX: target.x,
          spawnY: target.y,
          ...(newMode ? { movementMode: newMode } : {})
        }
      };

      await redis.set(key, JSON.stringify(updatedAgent));
      const name = agent.card?.name || agent.url;
      console.log(`  ✓ ${name} 업데이트 완료`);
      updated++;
    }

    console.log(`\n=== 완료: ${updated}개 에이전트 업데이트됨 ===`);
  } finally {
    await redis.quit();
    console.log('Redis 연결 종료');
  }
}

// 스크립트 실행
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('\n사용법: npx tsx scripts/move-agent.ts');
    console.log('\n설명:');
    console.log('  대화형으로 에이전트를 선택하여 절대 좌표 이동 + movement mode 변경을 수행합니다.');
    console.log('\nMovement Modes:');
    console.log('  1. village_wide    - 마을 전체 범위 이동');
    console.log('  2. spawn_centered  - 스폰 지점 중심 반경 이동');
    console.log('  3. stationary      - 고정 (이동 안 함)');
    console.log('\n예시:');
    console.log('  npx tsx scripts/move-agent.ts');
    process.exit(0);
  }

  moveAgent()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('실패:', error);
      process.exit(1);
    });
}
