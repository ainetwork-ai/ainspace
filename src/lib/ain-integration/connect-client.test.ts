import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followActionUrl, isAindriveConnectUrl } from './connect-client';
import { jsonResponse } from './__tests__/helpers';

const location = { origin: 'https://space.example', pathname: '/village/a', search: '?x=1' };

test('연결 시작 actionUrl → bearer fetch(Accept JSON, returnTo=현재 경로) 후 authorizeUrl 로 이동', async () => {
  const calls: { input: string; init?: RequestInit }[] = [];
  const nav: string[] = [];
  const msg = await followActionUrl('https://space.example/api/ain/aindrive/connect', {
    fetcher: async (input, init) => { calls.push({ input, init }); return jsonResponse({ authorizeUrl: 'https://aindrive.example/oauth/authorize?state=s' }); },
    navigate: (u) => nav.push(u), openTab: () => assert.fail('새 탭이 아니다'), location,
  });
  assert.equal(msg, null);
  assert.equal(calls[0].input, '/api/ain/aindrive/connect?returnTo=%2Fvillage%2Fa%3Fx%3D1');
  assert.equal(new Headers(calls[0].init?.headers).get('accept'), 'application/json');
  assert.deepEqual(nav, ['https://aindrive.example/oauth/authorize?state=s']);
});

test('다른 actionUrl(AIN SSO 등)은 새 탭; 시작 실패는 오류 문장', async () => {
  const tabs: string[] = [];
  await followActionUrl('https://auth.comcom.ai/', { fetcher: async () => assert.fail(), navigate: () => assert.fail(), openTab: (u) => tabs.push(u), location });
  assert.deepEqual(tabs, ['https://auth.comcom.ai/']);
  assert.equal(isAindriveConnectUrl('https://evil.example/api/ain/aindrive/connect', location.origin), false);
  const msg = await followActionUrl('https://space.example/api/ain/aindrive/connect', {
    fetcher: async () => jsonResponse({ error: { code: 'temporary_failure', message: '설정 없음', retryable: false } }, 503),
    navigate: () => assert.fail(), openTab: () => assert.fail(), location,
  });
  assert.equal(msg, '설정 없음');
});
