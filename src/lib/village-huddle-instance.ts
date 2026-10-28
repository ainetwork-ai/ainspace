import { randomUUID } from 'node:crypto';
import { getRedisClient } from './redis';

/** Initialize existing legacy metadata atomically; never create a deleted village. */
export const VILLAGE_HUDDLE_INSTANCE = `
if redis.call('TYPE', KEYS[1]).ok ~= 'hash' then return nil end
if redis.call('HGET', KEYS[1], 'slug') ~= ARGV[1] then return nil end
local name = redis.call('HGET', KEYS[1], 'name')
if not name or string.len(name) == 0 then return nil end
local instance = redis.call('HGET', KEYS[1], 'huddleInstance')
if not instance then
 instance = ARGV[2]
 redis.call('HSET', KEYS[1], 'huddleInstance', instance)
end
return cjson.encode({instanceId = instance, title = name})`;

export async function villageHuddleInstance(slug: string): Promise<{ instanceId: string; title: string } | null> {
  const value = await (await getRedisClient()).eval(VILLAGE_HUDDLE_INSTANCE, { keys: [`village:${slug}`], arguments: [slug, randomUUID()] });
  if (typeof value !== 'string') return null;
  const parsed = JSON.parse(value) as { instanceId?: unknown; title?: unknown };
  if (typeof parsed.instanceId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(parsed.instanceId) || typeof parsed.title !== 'string' || !parsed.title || parsed.title.length > 500) throw new Error('Village metadata unavailable');
  return { instanceId: parsed.instanceId, title: parsed.title };
}
