// Remote-only HTTP integration against the owned native Space app and Redis DB15.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import streamReader from '../src/lib/read-event-stream.ts';
const { readEventStream } = streamReader;

if (process.platform !== 'linux' || process.env.AINSPACE_OWNED_HTTP_VERIFY !== 'true') throw new Error('Owned remote verification only');
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { key, accounts } = JSON.parse(input);
assert.equal(typeof key, 'string');
assert.ok(key.length >= 32);
const base = 'http://127.0.0.1:17930';
const village = `owned-http-${randomUUID()}`;
if (accounts) { assert.equal(accounts.length, 2); assert.notEqual(accounts[0].userId, accounts[1].userId); }
const users = accounts ? accounts.map(account => account.userId) : [randomUUID(), randomUUID()];
const redis = createClient({ url: 'redis://127.0.0.1:17879/15' });
redis.on('error', () => {});
const streams = [];
const token = (userId, lifetime = 300) => {
  const account = accounts?.find(account => account.userId === userId);
  if (account && lifetime === 300) return account.accessToken;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: 'a2a-backend', aud: 'client-access', sub: userId, exp: Math.floor(Date.now() / 1000) + lifetime })).toString('base64url');
  const signature = createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
};
const waitFor = async (predicate, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Owned multiplayer condition timed out');
};
const connect = async (userId, lifetime = 300) => {
  const controller = new AbortController();
  const events = [];
  const state = { controller, events, reading: null };
  streams.push(state);
  const query = new URLSearchParams({ village, userId, x: '1', y: '2', direction: 'down', displayName: 'Owned test participant' });
  const response = await fetch(`${base}/api/village-sse?${query}`, { headers: { authorization: `Bearer ${token(userId, lifetime)}` }, signal: controller.signal });
  assert.equal(response.status, 200);
  state.reading = readEventStream(response.body, (name, data) => events.push({ name, body: JSON.parse(data) }), controller.signal).catch(error => {
    if (!controller.signal.aborted) throw error;
  });
  await waitFor(() => events.some(event => event.name === 'snapshot'));
  return state;
};
const position = (userId, authorization, action) => fetch(`${base}/api/position`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
  body: JSON.stringify({ village, userId, position: { x: 7, y: 8 }, direction: 'down', action }),
});

try {
  await redis.connect();
  await redis.hSet(`village:${village}`, { slug: village, name: 'Owned verification village', createdAt: String(Date.now()) });
  const access = userId => fetch(`${base}/api/ain/villages/${village}/huddle`, { headers: { authorization: `Bearer ${token(userId)}` } });
  assert.equal((await fetch(`${base}/api/ain/villages/${village}/huddle`)).status, 401);
  assert.equal((await access(users[0])).status, 404);
  await redis.sAdd(`village:${village}:members`, users[1]);
  const memberAccess = await access(users[1]);
  assert.equal(memberAccess.status, 200);
  const memberDescriptor = await memberAccess.json();
  assert.equal(memberDescriptor.access, 'member');
  await redis.sRem(`village:${village}:members`, users[1]);
  const firstTab = await connect(users[0]);
  const secondTab = await connect(users[0]);
  const otherAccount = await connect(users[1]);
  const presentAccess = await access(users[0]);
  assert.equal(presentAccess.status, 200);
  const presentDescriptor = await presentAccess.json();
  assert.equal(presentDescriptor.access, 'present');
  assert.equal(presentDescriptor.instanceId, memberDescriptor.instanceId);
  assert.equal(presentDescriptor.title, 'Owned verification village');
  if (accounts) {
    for (const account of accounts) {
      const source = await fetch(`http://localhost:17890/api/huddles/space/access?slug=${village}`, {
        headers: { cookie: account.cookieHeader }, signal: AbortSignal.timeout(30_000),
      });
      assert.equal(source.status, 200);
      assert.deepEqual(await source.json(), { slug: village, canJoin: true, access: 'present' });
    }
  }
  const snapshot = otherAccount.events.find(event => event.name === 'snapshot').body.players;
  assert.equal(snapshot.filter(player => player.userId === users[0]).length, 1);
  assert.equal((await position(users[0])).status, 401);
  assert.equal((await position(users[1], `Bearer ${token(users[0])}`)).status, 403);
  const spoof = await fetch(`${base}/api/village-sse?${new URLSearchParams({ village, userId: users[1] })}`, {
    headers: { authorization: `Bearer ${token(users[0])}` },
  });
  assert.equal(spoof.status, 403);
  await spoof.body?.cancel();
  assert.equal((await position(users[0], `Bearer ${token(users[0])}`)).status, 200);
  await waitFor(() => otherAccount.events.some(event => event.body.type === 'PLAYER_MOVED' && event.body.userId === users[0] && event.body.x === 7));
  firstTab.controller.abort();
  const instanceId = await redis.hGet(`village:${village}`, 'huddleInstance');
  assert.ok(instanceId);
  const connectionKey = `village:${village}:connections:${instanceId}:${users[0]}`;
  await waitFor(async () => await redis.zCard(connectionKey) === 1);
  assert.ok(await redis.hGet(`village:${village}:players`, users[0]));
  assert.equal((await position(users[0], `Bearer ${token(users[0])}`, 'disconnect')).status, 200);
  assert.ok(await redis.hGet(`village:${village}:players`, users[0]));
  secondTab.controller.abort();
  await waitFor(() => otherAccount.events.some(event => event.body.type === 'PLAYER_LEFT' && event.body.userId === users[0]));
  assert.equal(await redis.hGet(`village:${village}:players`, users[0]), null);
  assert.equal((await access(users[0])).status, 404);
  if (accounts) {
    const denied = await fetch(`http://localhost:17890/api/huddles/space/access?slug=${village}`, {
      headers: { cookie: accounts[0].cookieHeader }, signal: AbortSignal.timeout(30_000),
    });
    assert.equal(denied.status, 404); await denied.body?.cancel();
  }
  assert.ok(await redis.hGet(`village:${village}:players`, users[1]));
  // Inside the verifier's 30-second skew at entry, expired before heartbeat.
  const expiringUser = randomUUID();
  await connect(expiringUser, -20);
  assert.ok(await redis.hGet(`village:${village}:players`, expiringUser));
  await waitFor(async () => await redis.hGet(`village:${village}:players`, expiringUser) === null, 20_000);
  assert.ok(await redis.hGet(`village:${village}:players`, users[1]));
  const oldGenerationTab = await connect(users[0]);
  await redis.del(`village:${village}`);
  await redis.hSet(`village:${village}`, { slug: village, name: 'Recreated owned village', createdAt: String(Date.now()) });
  assert.equal((await access(users[0])).status, 404);
  const recreatedTab = await connect(users[0]);
  const recreatedInstance = await redis.hGet(`village:${village}`, 'huddleInstance');
  assert.notEqual(recreatedInstance, instanceId);
  assert.equal((await access(users[0])).status, 200);
  oldGenerationTab.controller.abort();
  await oldGenerationTab.reading;
  assert.ok(await redis.hGet(`village:${village}:players`, users[0]));
  assert.equal(await redis.zCard(`village:${village}:connections:${recreatedInstance}:${users[0]}`), 1);
  recreatedTab.controller.abort();
  await waitFor(async () => await redis.hGet(`village:${village}:players`, users[0]) === null);
  assert.equal((await access(users[0])).status, 404);
  console.log(JSON.stringify({ sourceRecreationRejectsPriorPresence: true, oldGenerationDeparturePreservesNewConnection: true, actualOwnedHttp: true, actualSsoAccounts: accounts?.length ?? 0, teamsSourceBridgeVerified: !!accounts, accountSessionVerified: true, spoofedAccountRejected: true, simultaneousAccountSnapshot: true, movementDelivered: true, oldTabDeparturePreservesOtherTab: true, legacyDisconnectPreservesLiveStream: true, finalDepartureDelivered: true, expiredSessionStopsExistingStream: true, huddleAccessRequiresLiveVillagePresence: true, huddleAccessRevokedAfterDeparture: true, otherAccountPreserved: true }));
} finally {
  for (const stream of streams) stream.controller.abort();
  await Promise.allSettled(streams.map(stream => stream.reading).filter(Boolean));
  if (redis.isOpen) {
    const keys = [];
    for await (const key of redis.scanIterator({ MATCH: `village:${village}:*`, COUNT: 100 })) keys.push(...(Array.isArray(key) ? key : [key]));
    if (keys.length) await redis.del(keys);
    await redis.del(`village:${village}`);
    await redis.quit();
  }
}
