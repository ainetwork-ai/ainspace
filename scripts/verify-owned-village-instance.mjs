import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
assert.equal(process.platform, 'linux');
assert.equal(process.env.AINSPACE_STORAGE_REDIS_URL, 'redis://127.0.0.1:17879/15');
const loaded = await import('../src/lib/village-huddle-instance.ts');
const { villageHuddleInstance } = loaded.default ?? loaded;
const redisModule = await import('../src/lib/redis.ts');
const { getRedisClient } = redisModule.default ?? redisModule;
const redis = createClient({ url: process.env.AINSPACE_STORAGE_REDIS_URL });
redis.on('error', () => {});
const slug = `owned-instance-${randomUUID()}`;
const key = `village:${slug}`;
try {
  await redis.connect();
  assert.equal(await villageHuddleInstance(slug), null);
  assert.equal(await redis.exists(key), 0);
  await redis.hSet(key, { slug, name: 'Owned village', createdAt: '123', preserved: 'metadata' });
  await redis.expire(key, 60);
  const [first, concurrent] = await Promise.all([villageHuddleInstance(slug), villageHuddleInstance(slug)]);
  assert.ok(first?.instanceId);
  assert.equal(first.instanceId, concurrent.instanceId);
  assert.equal(await redis.hGet(key, 'preserved'), 'metadata');
  assert.ok(await redis.ttl(key) > 0);
  await redis.hSet(key, 'name', 'Renamed owned village');
  const renamed = await villageHuddleInstance(slug);
  assert.equal(renamed.instanceId, first.instanceId); assert.equal(renamed.title, 'Renamed owned village');
  await redis.del(key);
  assert.equal(await villageHuddleInstance(slug), null);
  await redis.hSet(key, { slug, name: 'Recreated owned village' });
  const recreated = await villageHuddleInstance(slug);
  assert.notEqual(recreated.instanceId, first.instanceId);
  console.log(JSON.stringify({ actualOwnedRedis: true, concurrentInitializationStable: true, metadataAndTtlPreserved: true, renameKeepsInstance: true, absentVillageNotCreated: true, recreatedVillageNewInstance: true }));
} finally {
  if (redis.isOpen) { await redis.del(key); await redis.quit(); }
  const productRedis = await getRedisClient();
  if (productRedis.isOpen) await productRedis.quit();
}
