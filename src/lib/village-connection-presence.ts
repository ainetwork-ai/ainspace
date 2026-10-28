import { type PlayerPresence, getRedisClient } from './redis';
import { villageHuddleInstance } from './village-huddle-instance';
// Each browser connection owns a lease; closing an older stream cannot remove
// a player whose replacement stream (or another tab) is still connected.
export const RELEASE_VILLAGE_CONNECTION = `
if redis.call('ZREM', KEYS[1], ARGV[1]) == 0 then return 0 end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[2])
if redis.call('ZCARD', KEYS[1]) > 0 then return 0 end
redis.call('DEL', KEYS[1])
if redis.call('HGET', KEYS[5], 'huddleInstance') ~= ARGV[5] then return 0 end
redis.call('HDEL', KEYS[2], ARGV[3])
redis.call('HDEL', KEYS[3], ARGV[3])
redis.call('PUBLISH', KEYS[4], ARGV[4])
return 1`;
const connectionKey = (village: string, userId: string, instanceId: string) => `village:${village}:connections:${instanceId}:${encodeURIComponent(userId)}`;
export const RENEW_VILLAGE_CONNECTION = `
if redis.call('HGET', KEYS[2], 'huddleInstance') ~= ARGV[1] then return 0 end
if not redis.call('ZSCORE', KEYS[1], ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('EXPIRE', KEYS[1], 60)
redis.call('HSET', KEYS[3], ARGV[4], ARGV[5])
redis.call('EXPIRE', KEYS[3], 3600)
return 1`;
export const JOIN_VILLAGE_CONNECTION = `
if redis.call('HGET', KEYS[2], 'huddleInstance') ~= ARGV[1] then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('EXPIRE', KEYS[1], 60)
redis.call('HSET', KEYS[3], ARGV[4], ARGV[5])
redis.call('EXPIRE', KEYS[3], 3600)
redis.call('HSET', KEYS[4], ARGV[4], ARGV[6])
redis.call('EXPIRE', KEYS[4], 3600)
redis.call('PUBLISH', KEYS[5], ARGV[7])
return 1`;
export async function joinVillageConnection(village: string, userId: string, connectionId: string, instanceId: string, playerData: Omit<PlayerPresence, 'userId'>) {
  const now = Date.now();
  const joined = await (await getRedisClient()).eval(JOIN_VILLAGE_CONNECTION, {
    keys: [connectionKey(village, userId, instanceId), `village:${village}`, `village:${village}:heartbeat`, `village:${village}:players`, `village:${village}:events`],
    arguments: [instanceId, String(now + 45000), connectionId, userId, String(now), JSON.stringify({ ...playerData, userId }), JSON.stringify({ type: 'PLAYER_JOINED', ...playerData, userId })],
  });
  if (Number(joined) !== 1) throw new Error('Village instance changed');
}
export const HAS_VILLAGE_CONNECTION = `
if redis.call('HGET', KEYS[2], 'huddleInstance') ~= ARGV[1] then return 0 end
return redis.call('ZCOUNT', KEYS[1], ARGV[2], '+inf')`;
/** Only authenticated account IDs may be supplied by room authorization callers. */
export async function hasVillageConnection(village: string, userId: string, now = Date.now()) {
  const instance = await villageHuddleInstance(village);
  if (!instance) return false;
  return Number(await (await getRedisClient()).eval(HAS_VILLAGE_CONNECTION, {
    keys: [connectionKey(village, userId, instance.instanceId), `village:${village}`],
    arguments: [instance.instanceId, `(${now}`],
  })) > 0;
}
/** Candidate account IDs only; legacy guests never become mention recipients. */
export async function listLiveVillageConnections(village: string) {
  const ids = (await (await getRedisClient()).hKeys(`village:${village}:players`)).filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  const live: string[] = [];
  for (let offset = 0; offset < ids.length; offset += 8) {
    await Promise.all(ids.slice(offset, offset + 8).map(async id => { if (await hasVillageConnection(village, id)) live.push(id); }));
  }
  return live;
}
export async function renewVillageConnection(village: string, userId: string, connectionId: string, instanceId: string) {
  const redis = await getRedisClient();
  const renewed = await redis.eval(RENEW_VILLAGE_CONNECTION, {
    keys: [connectionKey(village, userId, instanceId), `village:${village}`, `village:${village}:heartbeat`],
    arguments: [instanceId, String(Date.now() + 45000), connectionId, userId, String(Date.now())],
  });
  if (Number(renewed) !== 1) throw new Error('Village instance changed');
}
export async function releaseVillageConnection(village: string, userId: string, connectionId: string, instanceId: string) {
  const redis = await getRedisClient();
  return redis.eval(RELEASE_VILLAGE_CONNECTION, {
    keys: [connectionKey(village, userId, instanceId), `village:${village}:players`, `village:${village}:heartbeat`, `village:${village}:events`, `village:${village}`],
    arguments: [connectionId, String(Date.now()), userId, JSON.stringify({ type: 'PLAYER_LEFT', userId }), instanceId],
  });
}

// Legacy page-exit beacons do not identify a connection. They may remove only
// an idle player, never one backed by another live SSE stream.
export const REMOVE_IDLE_VILLAGE_PRESENCE = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) > 0 then return 0 end
redis.call('DEL', KEYS[1])
if redis.call('HGET', KEYS[5], 'huddleInstance') ~= ARGV[4] then return 0 end
local removed = redis.call('HDEL', KEYS[2], ARGV[2])
redis.call('HDEL', KEYS[3], ARGV[2])
if removed > 0 then redis.call('PUBLISH', KEYS[4], ARGV[3]) end
return removed`;
export async function removeIdleVillagePresence(village: string, userId: string) {
  const instance = await villageHuddleInstance(village);
  if (!instance) return 0;
  const instanceId = instance.instanceId;
  const redis = await getRedisClient();
  return redis.eval(REMOVE_IDLE_VILLAGE_PRESENCE, {
    keys: [connectionKey(village, userId, instanceId), `village:${village}:players`, `village:${village}:heartbeat`, `village:${village}:events`, `village:${village}`],
    arguments: [String(Date.now()), userId, JSON.stringify({ type: 'PLAYER_LEFT', userId }), instanceId],
  });
}
