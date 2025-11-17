import http from 'k6/http';
import { check, sleep } from 'k6';

const TARGET_USERS = Number(__ENV.TARGET_USERS || 30);
const HALF_TARGET_USERS = TARGET_USERS > 1 ? Math.floor(TARGET_USERS / 2) : 1;
const AGENTS_PER_USER = Number(__ENV.AGENTS_PER_USER || 6);

export const options = {
    stages: [
        { duration: '1m', target: HALF_TARGET_USERS },
        { duration: '5m', target: TARGET_USERS },
        { duration: '1m', target: HALF_TARGET_USERS },
        { duration: '30s', target: 0 }
    ]
};

const BASE_URL = 'https://ainspace-4g3e-git-dev-comcom-team.vercel.app';

const jsonHeaders = {
    headers: {
        'Content-Type': 'application/json'
    }
};

// 맵을 한 바퀴 도는 경로 (x, y 몇 개만 샘플)
const path = [
    { x: 59, y: 69 },
    { x: 58, y: 69 },
    { x: 57, y: 69 },
    { x: 56, y: 69 },
    { x: 55, y: 69 },
    { x: 55, y: 70 },
    { x: 55, y: 71 },
    { x: 55, y: 72 },
    { x: 56, y: 72 },
    { x: 57, y: 72 },
    { x: 58, y: 72 }
];

// 환경변수로 유저/월렛 주입해도 됨
const USER_ID = '81fdda45-cdb3-47eb-9a47-1a94b1d2d07f';
const WALLET_ADDRESS = '0xFcB04FFd50bcC37415756244B7fF6BCD4e9414C3';
const AGENT_NAMES = [
    '꽃집 사장님',
    '마을이장',
    '만두가게 사장님',
    '러닝하는 대학생',
    '막걸리가게 사장님',
    '택시기사님'
];

const ACTIVE_AGENT_NAMES = AGENT_NAMES.slice(0, Math.min(AGENTS_PER_USER, AGENT_NAMES.length));

export default function loadTest() {
    // 1) 입장
    let res = http.get(`${BASE_URL}/`);
    check(res, { 'GET / status 200': (r) => r.status === 200 });

    // 2) 에이전트 목록 조회
    res = http.get(`${BASE_URL}/api/agents`);
    check(res, { 'GET /api/agents 200': (r) => r.status === 200 });

    // 3) 맵에서 이동 (position 업데이트)
    for (const pos of path) {
        const body = JSON.stringify({
            userId: USER_ID,
            position: pos
        });

        res = http.post(`${BASE_URL}/api/position`, body, jsonHeaders);
        check(res, { 'POST /api/position 200': (r) => r.status === 200 });

        sleep(0.3); // 이동 간 딜레이 (사용자 움직임 시뮬레이션)
    }

    // 4) 쓰레드 조회
    res = http.get(`${BASE_URL}/api/threads?userId=${encodeURIComponent(WALLET_ADDRESS)}`);
    check(res, { 'GET /api/threads 200': (r) => r.status === 200 });

    let threadId;
    try {
        const threads = JSON.parse(res.body);
        // 구조 보고 적당히 가져오기 (예: 첫 번째 thread)
        threadId = threads[0]?.id || threads[0]?.threadId;
    } catch {
        // 파싱 안돼도 부하 자체는 계속 줄 수 있으니 그냥 넘어가도 됨
    }

    if (threadId) {
        // 5) 메시지 보내기
        const msgBody = JSON.stringify({
            message: '안녕',
            playerPosition: { x: 35, y: 70 },
            broadcastRadius: 10,
            threadId,
            agentNames: ACTIVE_AGENT_NAMES
        });

        res = http.post(`${BASE_URL}/api/thread-message`, msgBody, jsonHeaders);
        check(res, { 'POST /api/thread-message 200': (r) => r.status === 200 });

        // 6) SSE 스트림 열기 (간단히 상태만 확인)
        const streamRes = http.get(`${BASE_URL}/api/thread-stream/${threadId}`, {
            headers: {
                Accept: 'text/event-stream'
            }
        });
        check(streamRes, {
            'GET /api/thread-stream 200': (r) => r.status === 200
        });
    }

    sleep(1);
}

// k6 run load-test.js
// k6 run load-test.js -e TARGET_USERS=4 -e AGENTS_PER_USER=3
