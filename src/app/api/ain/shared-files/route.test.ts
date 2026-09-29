import { test } from 'node:test';
import assert from 'node:assert/strict';
import fixture from '@/lib/ain-integration/__fixtures__/file-list-response.json';
import { findSecretKey } from '@/lib/ain-integration/http';
import { AinContractError } from '@/lib/ain-integration/types';
import { fakeJwt, makeRequest, withEnv } from '@/lib/ain-integration/__tests__/helpers';
import { sharedFilesDeps as deps } from '@/lib/ain-integration/deps';
import { GET } from './route';

const ON = { AIN_INTEGRATION_ENABLED: 'true', NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined };
const OFF = { AIN_INTEGRATION_ENABLED: undefined, NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined };

test('플래그 off(기본) → 404, 세션이 있어도', withEnv(OFF, async () => {
  const res = await GET(makeRequest('/api/ain/shared-files?scope=mine', fakeJwt('u1')));
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.detail, 'ain_integration_disabled');
}));

test('세션 없음 → 401 auth_required (원본은 호출되지 않는다)', withEnv(ON, async () => {
  let called = false;
  const orig = deps.listSharedFiles;
  deps.listSharedFiles = async () => { called = true; return fixture as never; };
  try {
    const res = await GET(makeRequest('/api/ain/shared-files'));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'auth_required');
    assert.equal(body.error.retryable, false);
    assert.equal(called, false);
  } finally { deps.listSharedFiles = orig; }
}));

test('잘못된 scope → 400 unsupported_input', withEnv(ON, async () => {
  const res = await GET(makeRequest('/api/ain/shared-files?scope=nope', fakeJwt('u1')));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'unsupported_input');
}));

test('aindrive 토큰이 없는 사용자 → 401 auth_required + actionUrl', withEnv({ ...ON, AINDRIVE_ACCOUNT_TOKEN: undefined, AINDRIVE_URL: 'https://aindrive.example' }, async () => {
  const origToken = deps.getAindriveAccountToken;
  deps.getAindriveAccountToken = async () => null;
  try {
    const res = await GET(makeRequest('/api/ain/shared-files?scope=shared_with_me', fakeJwt('u1')));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'auth_required');
    assert.equal(body.error.actionUrl, 'https://aindrive.example/oauth/authorize');
  } finally { deps.getAindriveAccountToken = origToken; }
}));

test('세션 + 토큰 → 계약 응답 그대로, 토큰·authorization 키 없음, no-store', withEnv(ON, async () => {
  const origToken = deps.getAindriveAccountToken;
  const origList = deps.listSharedFiles;
  let seen: { token: string | null; scope: string; userId: string | null } | null = null;
  deps.getAindriveAccountToken = async (userId) => { seen = { token: 'aind_aat_secret', scope: '', userId }; return 'aind_aat_secret'; };
  deps.listSharedFiles = async (o, req) => { seen = { token: o.token, scope: req.scope, userId: seen?.userId ?? null }; return fixture as never; };
  try {
    const res = await GET(makeRequest('/api/ain/shared-files?scope=recent&limit=5', fakeJwt('user-42')));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const body = await res.json();
    assert.deepEqual(body, fixture);
    assert.equal(findSecretKey(body), null);
    assert.ok(!JSON.stringify(body).includes('aind_aat_secret'));
    assert.deepEqual(seen, { token: 'aind_aat_secret', scope: 'recent', userId: 'user-42' });
  } finally { deps.getAindriveAccountToken = origToken; deps.listSharedFiles = origList; }
}));

test('어댑터 오류는 계약 오류 바디 + 매핑된 status 로', withEnv(ON, async () => {
  const origToken = deps.getAindriveAccountToken;
  const origList = deps.listSharedFiles;
  deps.getAindriveAccountToken = async () => 't';
  deps.listSharedFiles = async () => { throw new AinContractError('source_offline', 'device offline'); };
  try {
    const res = await GET(makeRequest('/api/ain/shared-files', fakeJwt('u1')));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'source_offline');
    assert.equal(body.error.retryable, true);
  } finally { deps.getAindriveAccountToken = origToken; deps.listSharedFiles = origList; }
}));

test('알 수 없는 실패는 temporary_failure 로, 내부 메시지는 감춘다', withEnv(ON, async () => {
  const origToken = deps.getAindriveAccountToken;
  const origList = deps.listSharedFiles;
  deps.getAindriveAccountToken = async () => 't';
  deps.listSharedFiles = async () => { throw new Error('ECONNREFUSED token=leak'); };
  try {
    const res = await GET(makeRequest('/api/ain/shared-files', fakeJwt('u1')));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'temporary_failure');
    assert.ok(!body.error.message.includes('leak'));
  } finally { deps.getAindriveAccountToken = origToken; deps.listSharedFiles = origList; }
}));
