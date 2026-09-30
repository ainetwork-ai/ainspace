import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTeamsDelegationUrl, requestTeamsDelegation } from './teams-delegation';
import { AIN_CONTRACT_VERSION, AinContractError, type AgentRef, type FileRef } from './types';
import { fakeFetch, jsonResponse, withEnv } from './__tests__/helpers';

const TEAMS = 'https://teams.example';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.teams-user.sig';
const TOKEN = 'eyJ0eXAiOiJhaW4tcmRsZytqd3QifQ.dlg.sig';
const agent = { contract: AIN_CONTRACT_VERSION, registryIssuer: 'https://ainize.example', agentId: 'a', popJwk: { kty: 'EC' } } as unknown as AgentRef;
const file = { contract: AIN_CONTRACT_VERSION, issuer: 'https://aindrive.example', driveId: 'd', fileId: 'p1:x' } as unknown as FileRef;
const input = { agent, files: [file], conversationContextId: 'ctx:u:-:ainspace:-:c' };

const call = (handler: Parameters<typeof fakeFetch>[0][string]) => {
  const f = fakeFetch({ '/api/ain/delegation': handler });
  return { f, run: () => requestTeamsDelegation({ url: `${TEAMS}/api/ain/delegation`, teamsJwt: JWT, fetch: f }, input) };
};

/** console.error 에 찍힌 것을 모은다 — 토큰이 새지 않는지 본다. */
async function captureErrors(fn: () => Promise<unknown>): Promise<string> {
  const orig = console.error;
  let out = '';
  console.error = (...a: unknown[]) => { out += a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n'; };
  try { await fn().catch(() => {}); } finally { console.error = orig; }
  return out;
}

test('B 계약: Bearer 는 헤더로만, 바디는 {agentRef, fileKeys, conversationContextId, actions:[read]}, exp(초·ISO 모두) → expiresAt', async () => {
  const { f, run } = call(() => jsonResponse({ delegation: { token: TOKEN, exp: 1_900_000_000, jti: 'rdlg_1' } }));
  const d = await run();
  assert.deepEqual(d, { token: TOKEN, jti: 'rdlg_1', expiresAt: new Date(1_900_000_000_000).toISOString(), reused: false });
  const init = f.calls[0].init!;
  assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${JWT}`);
  assert.ok(!f.calls[0].url.includes(JWT));
  assert.deepEqual(JSON.parse(String(init.body)), { agentRef: agent, fileKeys: ['https://aindrive.example#d#p1:x'], conversationContextId: input.conversationContextId, actions: ['read'] });

  const iso = await call(() => jsonResponse({ delegation: { token: TOKEN, exp: '2030-01-01T00:00:00Z', jti: 'j' } })).run();
  assert.equal(iso.expiresAt, '2030-01-01T00:00:00.000Z');
});

test('B 오류 매핑: 401→auth_required(http(s) actionUrl 만), 403→forbidden, 404→temporary_failure(disabled), 429→rate_limited, 5xx·모양 틀림→temporary_failure', async () => {
  const codeOf = async (res: Response) => { try { await call(() => res).run(); return null; } catch (e) { return e as AinContractError; } };
  let e = await codeOf(jsonResponse({ error: { code: 'auth_required', message: 'x', actionUrl: 'https://teams.example/sso' } }, 401));
  assert.equal(e?.code, 'auth_required'); assert.equal(e?.actionUrl, 'https://teams.example/sso'); assert.equal(e?.status, 401);
  e = await codeOf(jsonResponse({ error: { code: 'auth_required', actionUrl: 'javascript:alert(1)' } }, 401));
  assert.equal(e?.code, 'auth_required'); assert.equal(e?.actionUrl, undefined);
  e = await codeOf(jsonResponse({ error: { code: 'forbidden', message: 'secret.pdf 는 볼 수 없음' } }, 403));
  assert.equal(e?.code, 'forbidden'); assert.ok(!e?.message.includes('secret.pdf'));
  e = await codeOf(jsonResponse({}, 404));
  assert.equal(e?.code, 'temporary_failure'); assert.equal(e?.detail, 'teams_delegation_disabled'); assert.equal(e?.retryable, false);
  e = await codeOf(jsonResponse({ error: { code: 'rate_limited' } }, 429));
  assert.equal(e?.code, 'rate_limited');
  e = await codeOf(jsonResponse({}, 502));
  assert.equal(e?.code, 'temporary_failure'); assert.equal(e?.retryable, true);
  e = await codeOf(jsonResponse({ delegation: { token: TOKEN } }));
  assert.equal(e?.detail, 'teams_delegation_bad_response');
});

test('B: 토큰(Teams JWT·위임)은 로그·오류 메시지에 없다', async () => {
  const logs = await captureErrors(() => call(() => jsonResponse({ error: { code: 'auth_required', message: `bad ${JWT}` } }, 401)).run());
  assert.ok(logs.length > 0);
  assert.ok(!logs.includes(JWT) && !logs.includes(TOKEN));
  const thrown = await call(() => { throw new Error("connect ECONNREFUSED"); }).run().catch((x: Error) => x);
  assert.ok(thrown instanceof AinContractError);
  assert.ok(!thrown.message.includes(JWT));
});

test('B: env — 미설정 null, https 또는 localhost http 만', async () => {
  await withEnv({ AIN_TEAMS_DELEGATION_URL: undefined }, () => { assert.equal(getTeamsDelegationUrl(), null); })();
  await withEnv({ AIN_TEAMS_DELEGATION_URL: 'https://teams.example/api/ain/delegation' }, () => { assert.equal(getTeamsDelegationUrl(), 'https://teams.example/api/ain/delegation'); })();
  await withEnv({ AIN_TEAMS_DELEGATION_URL: 'http://localhost:3000/api/ain/delegation' }, () => { assert.equal(getTeamsDelegationUrl(), 'http://localhost:3000/api/ain/delegation'); })();
  await withEnv({ AIN_TEAMS_DELEGATION_URL: 'http://teams.example/api/ain/delegation' }, async () => {
    await captureErrors(async () => { assert.equal(getTeamsDelegationUrl(), null); });
  })();
});
