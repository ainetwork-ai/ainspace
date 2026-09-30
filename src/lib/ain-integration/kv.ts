/**
 * 작은 키-값 저장소 인터페이스 — 기본은 Space 의 Redis. 테스트는 메모리 구현을 끼운다(Redis 없이).
 */
import { getRedisClient } from '@/lib/redis';

export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ttlSec?: number }): Promise<void>;
  del(key: string): Promise<void>;
  /** 읽고 지운다(한 번만 쓰는 값 — OAuth state). */
  getDel(key: string): Promise<string | null>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hSet(key: string, field: string, value: string): Promise<void>;
  hDel(key: string, field: string): Promise<void>;
}

export const redisKv: KvStore = {
  async get(key) { return (await getRedisClient()).get(key); },
  async set(key, value, opts) {
    const r = await getRedisClient();
    if (opts?.ttlSec) await r.set(key, value, { EX: opts.ttlSec });
    else await r.set(key, value);
  },
  async del(key) { await (await getRedisClient()).del(key); },
  async getDel(key) { return (await getRedisClient()).getDel(key); },
  async hGetAll(key) { return (await getRedisClient()).hGetAll(key) as Promise<Record<string, string>>; },
  async hSet(key, field, value) { await (await getRedisClient()).hSet(key, field, value); },
  async hDel(key, field) { await (await getRedisClient()).hDel(key, field); },
};

/** 테스트용 메모리 저장소. TTL 은 기록만 한다(검증용). */
export function memoryKv(): KvStore & { data: Map<string, string>; hashes: Map<string, Map<string, string>>; ttl: Map<string, number> } {
  const data = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const ttl = new Map<string, number>();
  return {
    data, hashes, ttl,
    async get(k) { return data.get(k) ?? null; },
    async set(k, v, o) { data.set(k, v); if (o?.ttlSec) ttl.set(k, o.ttlSec); },
    async del(k) { data.delete(k); hashes.delete(k); },
    async getDel(k) { const v = data.get(k) ?? null; data.delete(k); return v; },
    async hGetAll(k) { return Object.fromEntries(hashes.get(k) ?? []); },
    async hSet(k, f, v) { if (!hashes.has(k)) hashes.set(k, new Map()); hashes.get(k)!.set(f, v); },
    async hDel(k, f) { hashes.get(k)?.delete(f); },
  };
}
