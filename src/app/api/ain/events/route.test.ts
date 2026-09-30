import { test } from 'node:test';
import assert from 'node:assert/strict';
import eventPage from '@/lib/ain-integration/__fixtures__/event-page.json';
import { findSecretKey } from '@/lib/ain-integration/http';
import { AinContractError, type EventPage } from '@/lib/ain-integration/types';
import { SESSION_ENV, fakeJwt, makeRequest, signedJwt, withEnv } from '@/lib/ain-integration/__tests__/helpers';
import { eventsDeps as deps } from '@/lib/ain-integration/deps';
import { GET } from './route';

const ON = { ...SESSION_ENV, AIN_INTEGRATION_ENABLED: 'true', NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined, AINDRIVE_URL: 'https://aindrive.example/', AINIZE_URL: 'https://ainize.example' };
const OFF = { AIN_INTEGRATION_ENABLED: undefined, NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined };

test('플래그 off → 404', withEnv(OFF, async () => {
  assert.equal((await GET(makeRequest('/api/ain/events?source=aindrive', signedJwt('u1')))).status, 404);
}));

test('세션 없음·위조 bearer·?token= 쿼리 → 401; source 없음/틀림 → 400', withEnv(ON, async () => {
  assert.equal((await GET(makeRequest('/api/ain/events?source=aindrive'))).status, 401);
  assert.equal((await GET(makeRequest('/api/ain/events?source=aindrive', fakeJwt('u1')))).status, 401);
  assert.equal((await GET(makeRequest('/api/ain/events?source=aindrive', 'h.e30.s'))).status, 401);
  assert.equal((await GET(makeRequest(`/api/ain/events?source=aindrive&token=${encodeURIComponent(signedJwt('u1'))}`))).status, 401);
  assert.equal((await GET(makeRequest('/api/ain/events', signedJwt('u1')))).status, 400);
  const res = await GET(makeRequest('/api/ain/events?source=nope', signedJwt('u1')));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'unsupported_input');
}));

test('aindrive: 사용자 토큰으로 피드를 그대로 전달, cursor 전달, no-store, 토큰 없음', withEnv(ON, async () => {
  const origT = deps.getAindriveAccountToken; const origF = deps.fetchEvents;
  let seen: { source: string; baseUrl: string; token: string | null | undefined; cursor: string | null | undefined; userId: string | null } | null = null;
  deps.getAindriveAccountToken = async (userId) => { seen = { source: '', baseUrl: '', token: null, cursor: null, userId }; return 'aind_aat_secret'; };
  deps.fetchEvents = async (o, cursor) => { seen = { source: o.source, baseUrl: o.baseUrl, token: o.token, cursor, userId: seen?.userId ?? null }; return eventPage as EventPage; };
  try {
    const res = await GET(makeRequest('/api/ain/events?source=aindrive&cursor=ev_1', signedJwt('user-42')));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const body = await res.json();
    assert.deepEqual(body, eventPage);
    assert.equal(findSecretKey(body), null);
    assert.deepEqual(seen, { source: 'aindrive', baseUrl: 'https://aindrive.example', token: 'aind_aat_secret', cursor: 'ev_1', userId: 'user-42' });
  } finally { deps.getAindriveAccountToken = origT; deps.fetchEvents = origF; }
}));

test('ainize: 익명으로 전달; 어댑터 오류는 계약 바디 + status', withEnv(ON, async () => {
  const origT = deps.getAindriveAccountToken; const origF = deps.fetchEvents;
  let seen: { source: string; token: unknown } | null = null;
  deps.getAindriveAccountToken = async () => 't';
  deps.fetchEvents = async (o) => { seen = { source: o.source, token: o.token }; return { contract: '1.0', events: [], nextCursor: 'ev_0', gap: true }; };
  try {
    const res = await GET(makeRequest('/api/ain/events?source=ainize', signedJwt('u1')));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).gap, true);
    assert.deepEqual(seen, { source: 'ainize', token: null });
    deps.fetchEvents = async () => { throw new AinContractError('auth_required', '연결 필요', { actionUrl: 'https://aindrive.example/oauth/authorize' }); };
    const err = await GET(makeRequest('/api/ain/events?source=aindrive', signedJwt('u1')));
    assert.equal(err.status, 401);
    assert.equal((await err.json()).error.actionUrl, 'https://aindrive.example/oauth/authorize');
  } finally { deps.getAindriveAccountToken = origT; deps.fetchEvents = origF; }
}));
