import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import eventPage from '@/lib/ain-integration/__fixtures__/event-page.json';
import { AinContractError, HTTP_STATUS_FOR, type EventPage, type ResourceEvent } from '@/lib/ain-integration/types';
import { SESSION_ENV, fakeJwt, signedJwt, withEnv } from '@/lib/ain-integration/__tests__/helpers';
import { eventsDeps as deps } from '@/lib/ain-integration/deps';
import { POST } from './route';

const ON = { ...SESSION_ENV, AIN_INTEGRATION_ENABLED: 'true', NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined, AINIZE_URL: 'https://ainize.example' };
const OFF = { AIN_INTEGRATION_ENABLED: undefined, NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined };

const post = (b: unknown, bearer?: string) => POST(new NextRequest('http://localhost/api/ain/events/apply', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: typeof b === 'string' ? b : JSON.stringify(b),
}));

type Deps = typeof deps;
async function withDeps(patch: Partial<Deps>, fn: () => Promise<void>) {
  const orig: Partial<Deps> = {};
  for (const k of Object.keys(patch) as (keyof Deps)[]) { (orig as Record<string, unknown>)[k] = deps[k]; (deps as Record<string, unknown>)[k] = patch[k]; }
  try { await fn(); } finally { for (const k of Object.keys(patch) as (keyof Deps)[]) (deps as Record<string, unknown>)[k] = orig[k]; }
}

const page = eventPage as EventPage;

test('플래그 off → 404; 세션 없음·위조 → 401 (원본은 호출되지 않는다)', async () => {
  await withEnv(OFF, async () => { assert.equal((await post({}, signedJwt('u1'))).status, 404); })();
  await withEnv(ON, async () => {
    let called = false;
    await withDeps({ fetchEvents: async () => { called = true; return page; } }, async () => {
      assert.equal((await post({})).status, 401);
      assert.equal((await post({}, fakeJwt('u1'))).status, 401);
      assert.equal(called, false);
    });
  })();
});

test('Ainize 에서 직접 받은 이벤트를 applyAgentEvents 로 넘기고 결과를 돌려준다; 바디의 cursor 만 쓴다', withEnv(ON, async () => {
  let seen: { baseUrl: string; source: string; token: unknown; cursor: unknown } | null = null;
  let applied: ResourceEvent[] | null = null;
  await withDeps({
    fetchEvents: async (o, cursor) => { seen = { baseUrl: o.baseUrl, source: o.source, token: o.token, cursor }; return page; },
    applyAgentEvents: async (events) => { applied = events; return { changed: [{ url: 'https://node.example/a', commonAgentId: 'https://ainize.ai#gallery-guide', backendStatus: 'active', version: 3 }], matched: 1, ignored: 2 }; },
  }, async () => {
    const res = await post({ cursor: 'ev_2', events: [{ kind: 'agent', type: 'agent.deleted', resourceId: 'https://ainize.ai#victim', version: 99 }] }, signedJwt('u1'));
    const b = await res.json();
    assert.equal(res.status, 200, JSON.stringify(b));
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(seen, { baseUrl: 'https://ainize.example', source: 'ainize', token: null, cursor: 'ev_2' });
    // 클라이언트가 보낸 events 는 무시되고 서버가 받은 페이지만 적용된다.
    assert.equal(applied!.length, page.events.length);
    assert.ok(applied!.every((e) => e.resourceId !== 'https://ainize.ai#victim'));
    assert.equal(b.contract, '1.0');
    assert.equal(b.nextCursor, 'ev_3');
    assert.equal(b.gap, false);
    assert.equal(b.applied, 3);
    assert.equal(b.matched, 1);
    assert.equal(b.ignored, 2);
    assert.deepEqual(b.changed, [{ url: 'https://node.example/a', commonAgentId: 'https://ainize.ai#gallery-guide', backendStatus: 'active', version: 3 }]);
  });
}));

test('gap:true 면 적용하지 않고 applied=0, 커서만 돌려준다; 바디 없음도 허용', withEnv(ON, async () => {
  let applyCalled = false;
  await withDeps({
    fetchEvents: async () => ({ contract: '1.0', events: [], nextCursor: 'ev_50', gap: true }),
    applyAgentEvents: async () => { applyCalled = true; return { changed: [], matched: 0, ignored: 0 }; },
  }, async () => {
    const res = await post('', signedJwt('u1'));
    const b = await res.json();
    assert.equal(res.status, 200);
    assert.equal(b.gap, true);
    assert.equal(b.applied, 0);
    assert.equal(b.nextCursor, 'ev_50');
    assert.equal(applyCalled, false);
  });
}));

test('cursor 가 문자열이 아니면 400 unsupported_input; 원본 오류는 계약 바디·코드 표 status 로', withEnv(ON, async () => {
  await withDeps({ fetchEvents: async () => page }, async () => {
    const res = await post({ cursor: 5 }, signedJwt('u1'));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'unsupported_input');
  });
  await withDeps({ fetchEvents: async () => { throw new AinContractError('temporary_failure', '피드 모양이 아님', { retryable: true, upstreamStatus: 502 }); } }, async () => {
    const res = await post({}, signedJwt('u1'));
    assert.equal(res.status, HTTP_STATUS_FOR.temporary_failure);
    const b = await res.json();
    assert.equal(b.error.code, 'temporary_failure');
    assert.ok(!('upstreamStatus' in b.error));
  });
}));
