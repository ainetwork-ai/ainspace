// Connection-scoped verified presence. A delayed PUT cannot revive a closed tab.
export const MARK_VERIFIED_VILLAGE_PRESENCE = `
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[2])
if ARGV[1] ~= 'legacy' and redis.call('ZSCORE', KEYS[2], ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[1])
redis.call('EXPIRE', KEYS[1], 3600)
redis.call('HSET', KEYS[3], ARGV[4], ARGV[2])
redis.call('EXPIRE', KEYS[3], 3600)
return 1`;
export const CLEAR_VERIFIED_VILLAGE_PRESENCE = `
if ARGV[1] ~= 'legacy' then
 redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
 redis.call('EXPIRE', KEYS[2], 3600)
end
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[2])
if redis.call('ZCARD', KEYS[1]) > 0 then return 0 end
redis.call('DEL', KEYS[1])
return redis.call('HDEL', KEYS[3], ARGV[4])`;
export const verifiedPresenceKeys = (slug: string, userId: string) => [
  `village:${slug}:ain_connections:${encodeURIComponent(userId)}`,
  `village:${slug}:ain_closed_connections:${encodeURIComponent(userId)}`,
  `village:${slug}:ain_presence`,
];
