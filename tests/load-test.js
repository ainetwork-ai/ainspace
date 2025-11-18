import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

// custom metrics for detailed performance tracking
const threadMessageDuration = new Trend('thread_message_duration');
const threadMessageResponseSize = new Trend('thread_message_response_size');
const sseFirstByteDuration = new Trend('sse_first_byte_duration');
const sseTotalDuration = new Trend('sse_total_duration');
const sseResponseSize = new Trend('sse_response_size');

const TARGET_USERS = Number(__ENV.TARGET_USERS || 30);
const HALF_TARGET_USERS = TARGET_USERS > 1 ? Math.floor(TARGET_USERS / 2) : 1;
const AGENTS_PER_USER = Number(__ENV.AGENTS_PER_USER || 6);

export const options = {
    stages: [
        { duration: '1m', target: HALF_TARGET_USERS },
        { duration: '2m', target: TARGET_USERS },
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

// sample path for player movement across the map
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
    { x: 57, y: 72 }
];

// can be overridden with environment variables
const USER_ID = '81fdda45-cdb3-47eb-9a47-1a94b1d2d07f';
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
    // 1) enter the app
    let res = http.get(`${BASE_URL}/`);
    check(res, { 'GET / status 200': (r) => r.status === 200 });

    // 2) fetch agent list
    res = http.get(`${BASE_URL}/api/agents`);
    check(res, { 'GET /api/agents 200': (r) => r.status === 200 });

    // 3) simulate player movement on the map
    for (const pos of path) {
        const body = JSON.stringify({
            userId: USER_ID,
            position: pos
        });

        res = http.post(`${BASE_URL}/api/position`, body, jsonHeaders);
        check(res, { 'POST /api/position 200': (r) => r.status === 200 });

        sleep(0.3); // delay between moves to simulate realistic player movement
    }

    // 4) send message without threadId (will create new thread)
    const msgBody = JSON.stringify({
        message: '안녕',
        playerPosition: { x: 35, y: 70 },
        broadcastRadius: 10,
        // no threadId - backend will create a new thread
        agentNames: ACTIVE_AGENT_NAMES
    });

    console.log('📤 Sending thread-message request without threadId (will create new thread)');
    const threadMessageStart = Date.now();

    res = http.post(`${BASE_URL}/api/thread-message`, msgBody, jsonHeaders);

    const threadMessageEnd = Date.now();
    const threadMessageTime = threadMessageEnd - threadMessageStart;

    // record metrics
    threadMessageDuration.add(threadMessageTime);
    threadMessageResponseSize.add(res.body.length);

    console.log(`✅ thread-message completed in ${threadMessageTime}ms`);
    console.log(`📦 Response size: ${res.body.length} bytes`);
    console.log(`📄 Response body: ${res.body}`);

    const threadMessageCheck = check(res, {
        'POST /api/thread-message 200': (r) => r.status === 200,
        'thread-message has threadId': (r) => {
            try {
                const json = JSON.parse(r.body);
                return json.threadId !== undefined;
            } catch {
                return false;
            }
        }
    });

    // parse threadId from response
    let threadId;
    try {
        const responseBody = JSON.parse(res.body);
        threadId = responseBody.threadId;
        console.log(`🆔 Created threadId: ${threadId}`);
        console.log(`📊 Full response:`, JSON.stringify(responseBody, null, 2));
    } catch (e) {
        console.error(`❌ Failed to parse thread-message response: ${e.message}`);
    }

    if (threadId && threadMessageCheck) {
        // 5) open SSE stream and collect detailed metrics
        console.log(`🔌 Opening SSE stream for thread: ${threadId}`);
        const sseStart = Date.now();
        let firstByteTime = null;

        const streamRes = http.get(`${BASE_URL}/api/thread-stream/${threadId}`, {
            headers: {
                Accept: 'text/event-stream'
            },
            timeout: '30s' // increased timeout for SSE as it may take longer
        });

        const sseEnd = Date.now();
        const sseTotalTime = sseEnd - sseStart;

        // record SSE metrics
        sseTotalDuration.add(sseTotalTime);
        sseResponseSize.add(streamRes.body.length);

        // use timings to get first byte time (TTFB)
        if (streamRes.timings && streamRes.timings.waiting) {
            firstByteTime = streamRes.timings.waiting;
            sseFirstByteDuration.add(firstByteTime);
            console.log(`⏱️  SSE first byte (TTFB): ${firstByteTime}ms`);
        }

        console.log(`ℹ️ SSE observation window finished in ${sseTotalTime}ms (error: ${streamRes.error || 'none'})`);
        console.log(`📦 SSE response size: ${streamRes.body.length} bytes`);

        // log SSE response content (first 500 characters only)
        const ssePreview = streamRes.body.substring(0, 500);
        console.log(`📄 SSE response preview:\n${ssePreview}${streamRes.body.length > 500 ? '...' : ''}`);

        // log full SSE response content
        // console.log(`📄 SSE response (full):\n${streamRes.body}`);

        // parse SSE events for detailed analysis
        const events = streamRes.body.split('\n\n').filter((e) => e.trim());
        console.log(`📨 Total SSE events received: ${events.length}`);

        check(null, {
            // at least one SSE event arrived within the observation window
            'SSE got events within window': () => events.length > 0,

            // first SSE event (TTFB) arrived within 3 seconds
            'SSE TTFB < 3000ms': () => firstByteTime !== null && firstByteTime !== undefined && firstByteTime < 3000
        });
    } else {
        console.warn('⚠️  Skipping SSE stream - no threadId or thread-message failed');
    }

    sleep(1);
}

// usage examples:
// k6 run tests/load-test.js
// k6 run tests/load-test.js -e TARGET_USERS=20 -e AGENTS_PER_USER=5
//
// save output to file:
// k6 run tests/load-test.js 2>&1 | tee output.log
//
// with timestamp:
// k6 run tests/load-test.js 2>&1 | tee "output-$(date +%Y%m%d-%H%M%S).log"
