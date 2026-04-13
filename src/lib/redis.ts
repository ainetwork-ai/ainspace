import { createClient } from 'redis';
import { AgentStateForDB } from './agent';
import { AgentCard } from '@a2a-js/sdk';
import { Thread } from '@/types/thread';
import { generateAgentComboId } from './hash';

const client = createClient({
    url: process.env.AINSPACE_STORAGE_REDIS_URL || 'redis://localhost:6379'
});

client.on('error', (err) => {
    console.error('Redis Client Error', err);
});

export async function getRedisClient() {
    try {
        if (!client.isOpen) {
            await client.connect();
        }
        return client;
    } catch (error: unknown) {
        // If already connected, ignore the error and return client
        if (
            error instanceof Error &&
            (error.message?.includes('Socket already opened') || error.message?.includes('already connected'))
        ) {
            return client;
        }
        throw error;
    }
}

/**
 * Scan for keys matching a pattern using SCAN command (non-blocking alternative to KEYS)
 * @param pattern - The pattern to match (e.g., 'agents:*', 'auth:*')
 * @param count - Hint for number of keys to return per iteration (default: 100)
 * @returns Array of all matching keys
 */
export async function scanKeys(pattern: string, count: number = 100): Promise<string[]> {
    try {
        const redis = await getRedisClient();
        const keys: string[] = [];

        for await (const batch of redis.scanIterator({
            MATCH: pattern,
            COUNT: count
        })) {
            keys.push(...batch);
        }

        return keys;
    } catch (error) {
        console.error('Error scanning keys from Redis:', error);
        return [];
    }
}

// --- Presence types & functions (EPIC23) ---

import { DIRECTION } from '@/constants/game';

export interface PlayerPresence {
    userId: string;
    x: number;
    y: number;
    direction: DIRECTION;
    displayName: string;
    spriteKey: string;
}

// Subscriber client for Pub/Sub (separate from command client)
let subscriber: ReturnType<typeof createClient> | null = null;

export async function getRedisSubscriber() {
    try {
        if (!subscriber) {
            const commandClient = await getRedisClient();
            subscriber = commandClient.duplicate();
            subscriber.on('error', (err) => {
                console.error('Redis Subscriber Error', err);
            });
        }
        if (!subscriber.isOpen) {
            await subscriber.connect();
        }
        return subscriber;
    } catch (error: unknown) {
        if (
            error instanceof Error &&
            (error.message?.includes('Socket already opened') || error.message?.includes('already connected'))
        ) {
            return subscriber!;
        }
        throw error;
    }
}

export async function savePlayerPresence(
    villageSlug: string | null | undefined,
    userId: string,
    data: Omit<PlayerPresence, 'userId'>
): Promise<void> {
    if (!villageSlug) return;
    try {
        const redis = await getRedisClient();
        const presence: PlayerPresence = {
            ...data,
            userId,
        };
        await redis.hSet(`village:${villageSlug}:players`, userId, JSON.stringify(presence));
    } catch (error) {
        console.error('Error saving player presence:', error);
    }
}

export async function removePlayerPresence(villageSlug: string, userId: string): Promise<void> {
    try {
        const redis = await getRedisClient();
        await redis.hDel(`village:${villageSlug}:players`, userId);
        await publishVillageEvent(villageSlug, { type: 'PLAYER_LEFT', userId });
    } catch (error) {
        console.error('Error removing player presence:', error);
    }
}

export async function publishVillageEvent(
    villageSlug: string,
    event: Record<string, unknown>
): Promise<void> {
    try {
        const redis = await getRedisClient();
        await redis.publish(`village:${villageSlug}:events`, JSON.stringify(event));
    } catch (error) {
        console.error('Error publishing village event:', error);
    }
}

export async function joinVillage(
    userId: string,
    villageSlug: string,
    playerData: Omit<PlayerPresence, 'userId'>,
    prevVillageSlug?: string | null
): Promise<void> {
    try {
        // Clean up previous village if different
        if (prevVillageSlug && prevVillageSlug !== villageSlug) {
            const redis = await getRedisClient();
            await redis.hDel(`village:${prevVillageSlug}:players`, userId);
            await publishVillageEvent(prevVillageSlug, { type: 'PLAYER_LEFT', userId });
        }
        await savePlayerPresence(villageSlug, userId, playerData);
        const redis = await getRedisClient();
        await redis.expire(`village:${villageSlug}:players`, 3600);
        await publishVillageEvent(villageSlug, { type: 'PLAYER_JOINED', userId, ...playerData });
    } catch (error) {
        console.error('Error joining village:', error);
    }
}

export async function getVillagePlayers(villageSlug: string): Promise<PlayerPresence[]> {
    try {
        const redis = await getRedisClient();
        const raw = await redis.hGetAll(`village:${villageSlug}:players`);
        if (!raw || Object.keys(raw).length === 0) return [];

        // Stale detection based on heartbeat hash (60s threshold)
        const heartbeats = await redis.hGetAll(`village:${villageSlug}:heartbeat`);
        const now = Date.now();
        const staleThreshold = now - 60000;
        const players: PlayerPresence[] = [];
        const staleIds: string[] = [];

        for (const [uid, json] of Object.entries(raw)) {
            try {
                const lastHeartbeat = Number(heartbeats[uid] || 0);
                if (lastHeartbeat < staleThreshold) {
                    staleIds.push(uid);
                    continue;
                }
                const p: PlayerPresence = JSON.parse(json);
                players.push(p);
            } catch {
                staleIds.push(uid);
            }
        }

        if (staleIds.length > 0) {
            staleIds.forEach(uid => publishVillageEvent(villageSlug, { type: 'PLAYER_LEFT', userId: uid }));
            redis.hDel(`village:${villageSlug}:players`, staleIds).catch(() => {});
            redis.hDel(`village:${villageSlug}:heartbeat`, staleIds).catch(() => {});
        }

        return players;
    } catch (error) {
        console.error('Error getting village players:', error);
        return [];
    }
}

export async function cleanupStale(villageSlug: string): Promise<void> {
    await getVillagePlayers(villageSlug);
}

export type TileLayers = {
    layer0: { [key: string]: string };
    layer1: { [key: string]: string };
    layer2: { [key: string]: string };
};

export interface CustomTilesData {
    tiles: TileLayers;
    lastUpdated: string;
}

export async function saveCustomTiles(userId: string, customTiles: TileLayers): Promise<void> {
    try {
        const redis = await getRedisClient();

        // Get existing global tiles directly
        const globalTilesData = await redis.hGetAll('global-tiles');
        let existingTiles: TileLayers = { layer0: {}, layer1: {}, layer2: {} };

        if (globalTilesData && Object.keys(globalTilesData).length > 0) {
            const parsedTiles = JSON.parse(globalTilesData.tiles || '{}');
            existingTiles = {
                layer0: parsedTiles.layer0 || {},
                layer1: parsedTiles.layer1 || {},
                layer2: parsedTiles.layer2 || {}
            };
        }

        // Merge new tiles with existing ones (new tiles take precedence)
        const mergedTiles: TileLayers = {
            layer0: { ...(existingTiles.layer0 || {}), ...(customTiles.layer0 || {}) },
            layer1: { ...(existingTiles.layer1 || {}), ...(customTiles.layer1 || {}) },
            layer2: { ...(existingTiles.layer2 || {}), ...(customTiles.layer2 || {}) }
        };

        const newGlobalTilesData: CustomTilesData = {
            tiles: mergedTiles,
            lastUpdated: new Date().toISOString()
        };

        // Save to global key (no userId)
        await redis.hSet('global-tiles', {
            tiles: JSON.stringify(newGlobalTilesData.tiles),
            lastUpdated: newGlobalTilesData.lastUpdated
        });
        // No expiration for global tiles - they persist forever
    } catch (error) {
        console.error('Error saving custom tiles:', error);
        throw error;
    }
}

// Get global tiles (for backward compatibility, still accepts userId but ignores it)
export async function getCustomTiles(_userId: string): Promise<CustomTilesData | null> {
    try {
        const redis = await getRedisClient();
        const globalTilesData = await redis.hGetAll('global-tiles');

        if (!globalTilesData || Object.keys(globalTilesData).length === 0) {
            return null;
        }

        const parsedTiles = JSON.parse(globalTilesData.tiles || '{}');

        // Handle legacy single-layer format and convert to multi-layer
        if (!parsedTiles.layer0 && !parsedTiles.layer1 && !parsedTiles.layer2) {
            // Legacy format - move all tiles to layer0
            return {
                tiles: {
                    layer0: parsedTiles,
                    layer1: {},
                    layer2: {}
                },
                lastUpdated: globalTilesData.lastUpdated || new Date().toISOString()
            };
        }

        // Modern multi-layer format
        return {
            tiles: {
                layer0: parsedTiles.layer0 || {},
                layer1: parsedTiles.layer1 || {},
                layer2: parsedTiles.layer2 || {}
            },
            lastUpdated: globalTilesData.lastUpdated || new Date().toISOString()
        };
    } catch (error) {
        console.error('Error getting global tiles:', error);
        return null;
    }
}

// New function to get global tiles
export async function getGlobalTiles(): Promise<TileLayers | null> {
    try {
        const redis = await getRedisClient();
        const globalTilesData = await redis.hGetAll('global-tiles');

        if (!globalTilesData || Object.keys(globalTilesData).length === 0) {
            return null;
        }

        const parsedTiles = JSON.parse(globalTilesData.tiles || '{}');

        // Handle legacy single-layer format and convert to multi-layer
        if (!parsedTiles.layer0 && !parsedTiles.layer1 && !parsedTiles.layer2) {
            // Legacy format - move all tiles to layer0
            return {
                layer0: parsedTiles,
                layer1: {},
                layer2: {}
            };
        }

        // Modern multi-layer format
        return {
            layer0: parsedTiles.layer0 || {},
            layer1: parsedTiles.layer1 || {},
            layer2: parsedTiles.layer2 || {}
        };
    } catch (error) {
        console.error('Error getting global tiles:', error);
        return null;
    }
}

export async function deleteCustomTiles(userId: string): Promise<void> {
    try {
        const redis = await getRedisClient();
        await redis.del(`custom-tiles:${userId}`);
    } catch (error) {
        console.error('Error deleting custom tiles:', error);
        throw error;
    }
}

export interface StoredAgent {
    url: string;
    card: AgentCard;
    state: AgentStateForDB;
    spriteUrl?: string;
    spriteHeight?: number;
    isPlaced: boolean;
    creator: string;
    timestamp: number;
}

const AGENTS_KEY = 'agents:';

/**
 * Get all registered agents from Redis
 */
export async function getAgents(): Promise<StoredAgent[]> {
    try {
        const keys = await scanKeys(`${AGENTS_KEY}*`);

        if (keys.length === 0) {
            return [];
        }

        const redis = await getRedisClient();
        const values = await redis.mGet(keys);
        const agents = values
            .filter(value => value !== null)
            .map(value => JSON.parse(value as string) as StoredAgent)
            .filter(agent => agent && agent.url && agent.card);

        return agents.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
        console.error('Error getting agents from Redis:', error);
        return [];
    }
}


/**
 * Save thread for a user
 */
export async function saveThread(
    userId: string,
    thread: Thread
): Promise<void> {
    try {
        const redis = await getRedisClient();

        // Save to user-specific thread hash (key: thread id)
        await redis.hSet(`user:${userId}:threads`, {
            [thread.id]: JSON.stringify(thread),
        });

        // Save agent combo mapping
        await redis.hSet(`user:${userId}:agent_combos`, {
            [thread.agentComboId]: thread.id
        });

        // Set expiration to 30 days
        await redis.expire(`user:${userId}:threads`, 86400 * 30);
        await redis.expire(`user:${userId}:agent_combos`, 86400 * 30);
    } catch (error) {
        console.error('Error saving thread:', error);
        throw error;
    }
}

/**
 * Get all threads for a user
 */
export async function getThreads(userId: string): Promise<{ [id: string]: Thread }> {
    try {
        const redis = await getRedisClient();
        const threadsData = await redis.hGetAll(`user:${userId}:threads`);

        if (!threadsData || Object.keys(threadsData).length === 0) {
            return {};
        }

        const threads: { [id: string]: Thread } = {};
        for (const [id, data] of Object.entries(threadsData)) {
            threads[id] = JSON.parse(data);
        }

        return threads;
    } catch (error) {
        console.error('Error getting threads:', error);
        return {};
    }
}

/**
 * Find thread by agent combination
 */
export async function findThreadByAgentCombo(
    userId: string,
    agentNames: string[]
): Promise<Thread | null> {
    try {
        const redis = await getRedisClient();
        const agentComboId = await generateAgentComboId(agentNames);

        // Get thread id from agent combo mapping
        const id = await redis.hGet(`user:${userId}:agent_combos`, agentComboId);
        if (!id) return null;

        // Get thread data
        const threadStr = await redis.hGet(`user:${userId}:threads`, id);
        return threadStr ? JSON.parse(threadStr) : null;
    } catch (error) {
        console.error('Error finding thread by agent combo:', error);
        return null;
    }
}

/**
 * Delete thread for a user
 */
export async function deleteThread(
    userId: string,
    id: string
): Promise<void> {
    try {
        const redis = await getRedisClient();

        // Get thread data to retrieve agentComboId
        const threadStr = await redis.hGet(`user:${userId}:threads`, id);
        if (threadStr) {
            const thread: Thread = JSON.parse(threadStr);
            // Delete agent combo mapping
            await redis.hDel(`user:${userId}:agent_combos`, thread.agentComboId);
        }

        // Delete thread data
        await redis.hDel(`user:${userId}:threads`, id);
    } catch (error) {
        console.error('Error deleting thread:', error);
        throw error;
    }
}

/**
 * Update last message timestamp for a thread
 */
export async function updateThreadLastMessage(userId: string, id: string): Promise<void> {
    try {
        const redis = await getRedisClient();
        const threadDataStr = await redis.hGet(`user:${userId}:threads`, id);

        if (threadDataStr) {
            const threadData: Thread = JSON.parse(threadDataStr);
            threadData.lastMessageAt = new Date().toISOString();

            await redis.hSet(`user:${userId}:threads`, {
                [id]: JSON.stringify(threadData),
            });
        }
    } catch (error) {
        console.error('Error updating thread last message:', error);
    }
}

/**
 * Add an agent to user's placed agents list
 */
export async function addPlacedAgent(userId: string, agentUrl: string): Promise<void> {
    try {
        const redis = await getRedisClient();
        const agentKey = Buffer.from(agentUrl).toString('base64');

        await redis.hSet(`user:${userId}:placed_agents`, {
            [agentKey]: JSON.stringify({
                url: agentUrl,
                placedAt: new Date().toISOString()
            })
        });
    } catch (error) {
        console.error('Error adding placed agent:', error);
        throw error;
    }
}

/**
 * Remove an agent from user's placed agents list
 */
export async function removePlacedAgent(userId: string, agentUrl: string): Promise<void> {
    try {
        const redis = await getRedisClient();
        const agentKey = Buffer.from(agentUrl).toString('base64');

        await redis.hDel(`user:${userId}:placed_agents`, agentKey);
    } catch (error) {
        console.error('Error removing placed agent:', error);
        throw error;
    }
}

/**
 * Get all placed agents for a user
 */
export async function getPlacedAgents(userId: string): Promise<{ url: string; placedAt: string }[]> {
    try {
        const redis = await getRedisClient();
        const placedAgentsData = await redis.hGetAll(`user:${userId}:placed_agents`);

        if (!placedAgentsData || Object.keys(placedAgentsData).length === 0) {
            return [];
        }

        return Object.values(placedAgentsData).map(data => JSON.parse(data));
    } catch (error) {
        console.error('Error getting placed agents:', error);
        return [];
    }
}

/**
 * Get count of placed agents for a user
 */
export async function getPlacedAgentCount(userId: string): Promise<number> {
    try {
        const redis = await getRedisClient();
        const count = await redis.hLen(`user:${userId}:placed_agents`);
        return count;
    } catch (error) {
        console.error('Error getting placed agent count:', error);
        return 0;
    }
}

/**
 * Migrate threads from sessionId to walletAddress
 * Combines threads (walletAddress threads take precedence for conflicts by agentComboId)
 */
export async function migrateThreadsToWallet(
    sessionId: string,
    walletAddress: string
): Promise<{ migratedCount: number; skippedCount: number }> {
    try {
        const redis = await getRedisClient();

        const sessionThreads = await redis.hGetAll(`user:${sessionId}:threads`);
        const walletCombos = await redis.hGetAll(`user:${walletAddress}:agent_combos`);

        let migratedCount = 0;
        let skippedCount = 0;

        // Process each session thread
        for (const [threadId, threadDataStr] of Object.entries(sessionThreads)) {
            const thread: Thread = JSON.parse(threadDataStr);

            // Check if wallet already has a thread with the same agentComboId, skip if it does
            if (walletCombos[thread.agentComboId]) {
                skippedCount++;
                continue;
            }

            await redis.hSet(`user:${walletAddress}:threads`, {
                [threadId]: threadDataStr,
            });

            await redis.hSet(`user:${walletAddress}:agent_combos`, {
                [thread.agentComboId]: threadId
            });

            migratedCount++;
        }

        // Set expiration for wallet user data
        if (migratedCount > 0) {
            await redis.expire(`user:${walletAddress}:threads`, 86400 * 30);
            await redis.expire(`user:${walletAddress}:agent_combos`, 86400 * 30);
        }

        // Clean up session data after migration
        await redis.del(`user:${sessionId}:threads`);
        await redis.del(`user:${sessionId}:agent_combos`);

        console.log(`Thread migration completed: ${migratedCount} migrated, ${skippedCount} skipped`);

        return { migratedCount, skippedCount };
    } catch (error) {
        console.error('Error migrating threads:', error);
        throw error;
    }
}
