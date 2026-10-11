import type { StoredAgent } from '../redis';

interface AgentReader {
    mGet(keys: string[]): Promise<(string | null)[]>;
}

/** Keep exact URL identity and catalogue ordering while reading only selected keys. */
export async function readAgentsByUrls(redis: AgentReader, urls: string[]): Promise<StoredAgent[]> {
    const uniqueUrls = [...new Set(urls)];
    if (uniqueUrls.length === 0) return [];
    const keys = uniqueUrls.map((url) => `agents:${Buffer.from(url).toString('base64')}`);
    const values = await redis.mGet(keys);
    return values
        .filter((value): value is string => value !== null)
        .map((value) => JSON.parse(value) as StoredAgent)
        .filter((agent) => agent && uniqueUrls.includes(agent.url) && agent.card)
        .sort((a, b) => b.timestamp - a.timestamp);
}
