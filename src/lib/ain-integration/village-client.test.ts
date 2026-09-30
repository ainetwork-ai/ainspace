/** 브라우저 쪽 마을 클라이언트: 체류 동기화(PUT 진입·5분 갱신·DELETE 떠남)와 멤버·전시·재확인 호출 모양. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESENCE_REFRESH_MS, VillagePresenceSync, addExhibit, addMember, confirmVillageAgent, getExhibition, getMembers, removeExhibit, removeMember,
} from './village-client';
import { jsonResponse } from './__tests__/helpers';

function recorder(respond: (path: string, init?: RequestInit) => Response = () => jsonResponse({})) {
  const calls: { path: string; method: string; body?: unknown; keepalive?: boolean }[] = [];
  const fetcher = async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}), ...(init?.keepalive ? { keepalive: true } : {}) });
    return respond(path, init);
  };
  return { fetcher, calls };
}

function fakeTimers() {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let id = 0;
  return {
    timers,
    setInterval: (fn: () => void, ms: number) => { timers.set(++id, { fn, ms }); return id; },
    clearInterval: (h: unknown) => { timers.delete(h as number); },
    tick: () => { for (const t of [...timers.values()]) t.fn(); },
  };
}

test('체류: 들어가면 PUT, 5분마다 갱신, 다른 마을로 가면 이전 마을 DELETE 후 새 마을 PUT, 같은 마을 재진입은 무시', () => {
  const { fetcher, calls } = recorder();
  const t = fakeTimers();
  const sync = new VillagePresenceSync({ fetcher, setInterval: t.setInterval, clearInterval: t.clearInterval });
  sync.enter('alpha');
  assert.deepEqual(calls, [{ path: '/api/ain/villages/alpha/presence', method: 'PUT' }]);
  assert.equal([...t.timers.values()][0].ms, PRESENCE_REFRESH_MS);
  assert.equal(PRESENCE_REFRESH_MS, 5 * 60_000);
  t.tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { path: '/api/ain/villages/alpha/presence', method: 'PUT' });
  sync.enter('alpha');
  assert.equal(calls.length, 2);
  sync.enter('beta');
  assert.deepEqual(calls.slice(2), [{ path: '/api/ain/villages/alpha/presence', method: 'DELETE' }, { path: '/api/ain/villages/beta/presence', method: 'PUT' }]);
  assert.equal(t.timers.size, 1, '타이머는 한 마을 것만');
});

test('체류: 떠나면 DELETE 와 타이머 정리, 페이지 종료는 keepalive, 떠난 뒤에는 아무것도 보내지 않는다, 실패는 삼킨다', async () => {
  const { fetcher, calls } = recorder(() => { throw new Error('offline'); });
  const t = fakeTimers();
  const sync = new VillagePresenceSync({ fetcher: async (p, i) => fetcher(p, i), setInterval: t.setInterval, clearInterval: t.clearInterval });
  sync.enter('alpha');
  sync.leave({ keepalive: true });
  assert.deepEqual(calls[1], { path: '/api/ain/villages/alpha/presence', method: 'DELETE', keepalive: true });
  assert.equal(t.timers.size, 0);
  assert.equal(sync.slug, null);
  sync.leave();
  t.tick();
  assert.equal(calls.length, 2);
  await new Promise((r) => setTimeout(r, 0)); // 거절된 promise 가 처리되지 않은 채 남지 않는다
});

test('멤버·전시·재확인 호출: 경로·메서드·바디, 오류는 계약 바디의 message·actionUrl', async () => {
  const { fetcher, calls } = recorder((path) => path.includes('exhibition')
    ? jsonResponse({ error: { code: 'auth_required', message: '로그인이 필요합니다.', retryable: false, actionUrl: 'https://x.example/connect' } }, 401)
    : jsonResponse({ owner: 'o', members: ['o'] }));
  assert.deepEqual(await getMembers(fetcher, 'alpha'), { ok: true, data: { owner: 'o', members: ['o'] } });
  await addMember(fetcher, 'alpha', 'user 2');
  await removeMember(fetcher, 'alpha', 'user 2');
  await addExhibit(fetcher, 'alpha', 'https://d.example#drv#p1:x');
  await removeExhibit(fetcher, 'alpha', 'https://d.example#drv#p1:x');
  await confirmVillageAgent(fetcher, 'alpha', 'https://ainize.example#g');
  const ex = await getExhibition(fetcher, 'alpha');
  assert.deepEqual(ex, { ok: false, status: 401, message: '로그인이 필요합니다.', actionUrl: 'https://x.example/connect' });
  assert.deepEqual(calls, [
    { path: '/api/villages/alpha/members', method: 'GET' },
    { path: '/api/villages/alpha/members', method: 'POST', body: { userId: 'user 2' } },
    { path: '/api/villages/alpha/members?userId=user%202', method: 'DELETE' },
    { path: '/api/ain/villages/alpha/materials', method: 'PUT', body: { fileKey: 'https://d.example#drv#p1:x', audience: 'public', exhibition: true } },
    { path: '/api/ain/villages/alpha/materials?fileKey=https%3A%2F%2Fd.example%23drv%23p1%3Ax', method: 'DELETE' },
    { path: '/api/ain/villages/alpha/agents', method: 'POST', body: { agentKey: 'https://ainize.example#g', decision: 'confirm' } },
    { path: '/api/ain/villages/alpha/exhibition', method: 'GET' },
  ]);
  const down = await getMembers(async () => { throw new Error('x'); }, 'alpha');
  assert.equal(down.ok, false);
});
