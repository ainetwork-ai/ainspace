import { createClient } from 'redis';
import { AgentStateForDB } from './agent';
import { AgentCard } from '@a2a-js/sdk';
import { Thread } from '@/types/thread';
import crypto from 'crypto';

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

export interface PlayerPosition {
    x: number;
    y: number;
    lastUpdated: string;
}

export async function savePlayerPosition(userId: string, position: { x: number; y: number }): Promise<void> {
    try {
        const redis = await getRedisClient();
        const playerData: PlayerPosition = {
            x: position.x,
            y: position.y,
            lastUpdated: new Date().toISOString()
        };

        await redis.hSet(`player:${userId}`, {
            x: playerData.x.toString(),
            y: playerData.y.toString(),
            lastUpdated: playerData.lastUpdated
        });
        await redis.expire(`player:${userId}`, 86400); // Expire after 24 hours
    } catch (error) {
        console.error('Error saving player position:', error);
        throw error;
    }
}

export async function getPlayerPosition(userId: string): Promise<PlayerPosition | null> {
    try {
        const redis = await getRedisClient();
        const playerData = await redis.hGetAll(`player:${userId}`);

        if (!playerData || Object.keys(playerData).length === 0) {
            return null;
        }

        return {
            x: parseInt(playerData.x) || 0,
            y: parseInt(playerData.y) || 0,
            lastUpdated: playerData.lastUpdated || new Date().toISOString()
        };
    } catch (error) {
        console.error('Error getting player position:', error);
        return null;
    }
}

export async function deletePlayerPosition(userId: string): Promise<void> {
    try {
        const redis = await getRedisClient();
        await redis.del(`player:${userId}`);
    } catch (error) {
        console.error('Error deleting player position:', error);
        throw error;
    }
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
        const redis = await getRedisClient();
        const keys = await redis.keys(`${AGENTS_KEY}*`);

        if (keys.length === 0) {
            return [];
        }

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
 * Generate a unique hash for agent combination
 */
export function generateAgentComboId(agentNames: string[]): string {
    const sorted = [...agentNames]
        .map(n => n.trim().toLowerCase())
        .sort();
    const combined = sorted.join('|');
    return crypto.createHash('sha256')
        .update(combined, 'utf-8')
        .digest('hex');
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
        const agentComboId = generateAgentComboId(agentNames);

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
