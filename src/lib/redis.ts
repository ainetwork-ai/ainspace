import { createClient } from 'redis';

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
    card: {
        name: string;
        role?: string;
        [key: string]: unknown;
    };
    creator: string;
    timestamp: number;
    x?: number;
    y?: number;
    color?: string;
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

// Thread mapping types
export interface ThreadMapping {
    threadName: string;
    backendThreadId: string;
    agentNames: string[];
    createdAt: string;
    lastMessageAt: string;
}

/**
 * Save thread mapping for a user
 */
export async function saveThreadMapping(
    userId: string,
    threadName: string,
    backendThreadId: string,
    agentNames: string[]
): Promise<void> {
    try {
        const redis = await getRedisClient();
        const threadData: ThreadMapping = {
            threadName,
            backendThreadId,
            agentNames,
            createdAt: new Date().toISOString(),
            lastMessageAt: new Date().toISOString(),
        };

        // Save to user-specific thread hash
        await redis.hSet(`user:${userId}:threads`, {
            [threadName]: JSON.stringify(threadData),
        });

        // Set expiration to 30 days
        await redis.expire(`user:${userId}:threads`, 86400 * 30);
    } catch (error) {
        console.error('Error saving thread mapping:', error);
        throw error;
    }
}

/**
 * Get all thread mappings for a user
 */
export async function getThreadMappings(userId: string): Promise<{ [threadName: string]: ThreadMapping }> {
    try {
        const redis = await getRedisClient();
        const threadsData = await redis.hGetAll(`user:${userId}:threads`);

        if (!threadsData || Object.keys(threadsData).length === 0) {
            return {};
        }

        const threads: { [threadName: string]: ThreadMapping } = {};
        for (const [threadName, data] of Object.entries(threadsData)) {
            threads[threadName] = JSON.parse(data);
        }

        return threads;
    } catch (error) {
        console.error('Error getting thread mappings:', error);
        return {};
    }
}

/**
 * Update last message timestamp for a thread
 */
export async function updateThreadLastMessage(userId: string, threadName: string): Promise<void> {
    try {
        const redis = await getRedisClient();
        const threadDataStr = await redis.hGet(`user:${userId}:threads`, threadName);

        if (threadDataStr) {
            const threadData: ThreadMapping = JSON.parse(threadDataStr);
            threadData.lastMessageAt = new Date().toISOString();

            await redis.hSet(`user:${userId}:threads`, {
                [threadName]: JSON.stringify(threadData),
            });
        }
    } catch (error) {
        console.error('Error updating thread last message:', error);
    }
}
