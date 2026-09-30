/**
 * 17.6 — 같은 마을의 두 방문자가 같은 에이전트와 말할 때 contextId 가 다르고(account·room 포함), 재입장·재시작 후에도
 * 같은 방문자는 같은 contextId 를 다시 쓴다. 동시 호출에서도 응답·TaskRef 보관이 섞이지 않는다.
 * 라우트(`POST /api/ain/invoke`) → 실제 invokeSharedAgent → 가짜 Ainize 목록·A2A 로 끝까지 돈다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { invokeDeps } from './deps';
import { resetNativeSupport } from './http';
import { invokeSharedAgent, villageConversationId } from './invoke';
import { AIN_CONTRACT_VERSION, conversationContextId, type AgentRef, type TaskRef } from './types';
import { SESSION_ENV, fakeFetch, jsonResponse, signedJwt, withEnv } from './__tests__/helpers';
import { POST } from '@/app/api/ain/invoke/route';

const AINIZE = 'https://ainize.example';
const AGENT_KEY = `${AINIZE}#gallery-guide`;
const ENV = { ...SESSION_ENV, AIN_INTEGRATION_ENABLED: 'true', AINIZE_URL: AINIZE, AINDRIVE_URL: 'https://aindrive.example' };

const agent: AgentRef = {
  contract: AIN_CONTRACT_VERSION, registryIssuer: AINIZE, agentId: 'gallery-guide', releaseId: 'v1',
  ownerRef: { kind: 'wallet', issuer: AINIZE, subject: '0xabc' }, visibility: 'public',
  agentCardUrl: `${AINIZE}/agents/gallery-guide/.well-known/agent-card.json`, endpoint: `${AINIZE}/agents/gallery-guide`,
  supportedProtocolVersions: ['0.3.0'], skills: [], inputModes: ['text/plain'], outputModes: ['text/plain'], uiCapabilities: [],
  status: 'active', displayName: '갤러리 안내', updatedAt: '2026-09-29T06:00:00Z',
};

/** 가짜 Ainize: 목록 + A2A(받은 contextId 를 그대로 task 에 돌려주고, 답에 contextId 를 넣는다). 서버 재시작 = 새 인스턴스. */
function ainize() {
  const seen: { contextId: string; messageId: string }[] = [];
  const f = fakeFetch({
    '/api/shared-agents': () => jsonResponse({ contract: '1.0', asOf: '2026-09-29T06:00:00Z', nextCursor: null, items: [{ ref: agent, canInvoke: true }] }),
    '/agents/gallery-guide': async (_u, init) => {
      const body = JSON.parse(String(init?.body));
      const { contextId, messageId } = body.params.message;
      seen.push({ contextId, messageId });
      await new Promise((r) => setTimeout(r, seen.length % 2 ? 5 : 0)); // 동시 호출의 응답 순서를 뒤섞는다
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { id: `task_${messageId.slice(5, 13)}`, contextId, status: { state: 'completed' }, artifacts: [{ parts: [{ kind: 'text', text: `answer for ${contextId}` }] }] } });
    },
  });
  return { f, seen };
}

function wire(f: ReturnType<typeof fakeFetch>) {
  const saved: { userId: string; conversation: string; task: TaskRef }[] = [];
  invokeDeps.invokeSharedAgent = (o, r) => invokeSharedAgent({ ...o, fetch: f }, r);
  invokeDeps.getAindriveAccountToken = async () => null;
  invokeDeps.observeResolvedAgent = async () => {};
  invokeDeps.verifyVillageAgentOwner = async () => true;
  invokeDeps.saveTaskRef = async (userId, conversation, task) => { saved.push({ userId, conversation, task }); };
  resetNativeSupport();
  return saved;
}

const say = (user: string, room: string, text = '이 작품 설명해 줘') => POST(new NextRequest('http://localhost/api/ain/invoke', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${signedJwt(user)}` },
  body: JSON.stringify({ agentKey: AGENT_KEY, text, fileKeys: [], room, conversation: villageConversationId(room, AGENT_KEY) }),
}));

test('17.6 두 방문자·같은 마을·같은 에이전트 → contextId 가 다르고(account·room 포함) 동시 호출에서도 섞이지 않는다', withEnv(ENV, async () => {
  const prev = { ...invokeDeps };
  try {
    const { f, seen } = ainize();
    const saved = wire(f);
    const [a, b] = await Promise.all([say('visitor-a', 'alpha'), say('visitor-b', 'alpha')]);
    const [ja, jb] = [await a.json(), await b.json()];
    const conv = villageConversationId('alpha', AGENT_KEY);
    assert.equal(ja.task.contextId, conversationContextId({ account: 'visitor-a', org: null, product: 'ainspace', room: 'alpha', conversation: conv }));
    assert.equal(jb.task.contextId, conversationContextId({ account: 'visitor-b', org: null, product: 'ainspace', room: 'alpha', conversation: conv }));
    assert.notEqual(ja.task.contextId, jb.task.contextId);
    assert.match(ja.task.contextId, /^ctx:visitor-a:-:ainspace:alpha:/);
    // 응답 본문도 각자의 contextId 에 대한 것(뒤섞인 응답 순서와 무관)
    assert.equal(ja.text, `answer for ${ja.task.contextId}`);
    assert.equal(jb.text, `answer for ${jb.task.contextId}`);
    assert.notEqual(ja.task.taskId, jb.task.taskId);
    assert.equal(new Set(seen.map((x) => x.messageId)).size, 2);
    // TaskRef 보관은 사용자별
    assert.deepEqual(saved.map((x) => [x.userId, x.task.contextId]).sort(), [['visitor-a', ja.task.contextId], ['visitor-b', jb.task.contextId]]);
    // 다른 마을 = 다른 contextId
    const other = await (await say('visitor-a', 'beta')).json();
    assert.notEqual(other.task.contextId, ja.task.contextId);
    assert.match(other.task.contextId, /:beta:/);
  } finally { Object.assign(invokeDeps, prev); }
}));

test('17.6 재입장·재시작 → 같은 방문자는 같은 contextId 를 다시 쓴다(저장된 상태 없이 결정적)', withEnv(ENV, async () => {
  const prev = { ...invokeDeps };
  try {
    const first = ainize(); wire(first.f);
    const before = await (await say('visitor-a', 'alpha')).json();
    // 재입장(새 요청, 다른 질문)
    const again = await (await say('visitor-a', 'alpha', '다음 작품은?')).json();
    assert.equal(again.task.contextId, before.task.contextId);
    // 서버 재시작 흉내: 캐시 초기화 + 새 원본 인스턴스
    const restarted = ainize(); wire(restarted.f);
    const after = await (await say('visitor-a', 'alpha', '다음 작품은?')).json();
    assert.equal(after.task.contextId, before.task.contextId);
    assert.equal(restarted.seen[0].contextId, before.task.contextId);
    // 같은 질문의 재시도는 같은 messageId(idempotencyKey)
    assert.equal(after.task.idempotencyKey, again.task.idempotencyKey);
    // 대화 식별자는 (마을, 에이전트, 스레드)로만 정해진다
    assert.equal(villageConversationId('alpha', AGENT_KEY), villageConversationId('alpha', AGENT_KEY));
    assert.notEqual(villageConversationId('alpha', AGENT_KEY), villageConversationId('beta', AGENT_KEY));
    assert.notEqual(villageConversationId('alpha', AGENT_KEY), villageConversationId('alpha', AGENT_KEY, 'thr_2'));
    assert.match(villageConversationId('alpha', AGENT_KEY), /^village-[0-9a-f]{24}$/);
  } finally { Object.assign(invokeDeps, prev); }
}));
