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
// ============ Map Tiles (Infinite Map) ============

export interface MapTileData {
  layer0: { [key: string]: number };  // "x,y": tileId
  layer1: { [key: string]: number };
  layer2: { [key: string]: number };
}

export interface MapTilesetInfo {
  firstgid: number;
  source?: string;
  image?: string;
  columns: number;
  tilecount: number;
  tilewidth: number;
  tileheight: number;
}

const MAP_TILES_KEY = 'map-tiles';
const MAP_TILESETS_KEY = 'map-tilesets';
const MAP_CUSTOM_TILES_KEY = 'map-custom-tiles';  // tileId -> base64 이미지 데이터
const MAP_CUSTOM_TILE_COUNTER_KEY = 'map-custom-tile-counter';  // 다음 커스텀 tileId

/**
 * 맵 타일 저장 (특정 좌표)
 */
export async function setMapTile(
  layer: 0 | 1 | 2,
  x: number,
  y: number,
  tileId: number
): Promise<void> {
  try {
    const redis = await getRedisClient();
    const key = `${x},${y}`;
    await redis.hSet(`${MAP_TILES_KEY}:layer${layer}`, key, tileId.toString());
  } catch (error) {
    console.error('Error setting map tile:', error);
    throw error;
  }
}

/**
 * 맵 타일 조회 (특정 좌표)
 */
export async function getMapTile(
  layer: 0 | 1 | 2,
  x: number,
  y: number
): Promise<number | null> {
  try {
    const redis = await getRedisClient();
    const key = `${x},${y}`;
    const value = await redis.hGet(`${MAP_TILES_KEY}:layer${layer}`, key);
    return value ? parseInt(value, 10) : null;
  } catch (error) {
    console.error('Error getting map tile:', error);
    return null;
  }
}

/**
 * 맵 타일 범위 조회 (화면에 보이는 영역)
 */
export async function getMapTilesInRange(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): Promise<MapTileData> {
  try {
    const redis = await getRedisClient();

    const result: MapTileData = {
      layer0: {},
      layer1: {},
      layer2: {}
    };

    // 각 레이어의 모든 타일 가져오기
    const [layer0, layer1, layer2] = await Promise.all([
      redis.hGetAll(`${MAP_TILES_KEY}:layer0`),
      redis.hGetAll(`${MAP_TILES_KEY}:layer1`),
      redis.hGetAll(`${MAP_TILES_KEY}:layer2`)
    ]);

    // 범위 내 타일만 필터링
    const filterTiles = (tiles: { [key: string]: string }) => {
      const filtered: { [key: string]: number } = {};
      for (const [key, value] of Object.entries(tiles)) {
        const [x, y] = key.split(',').map(Number);
        if (x >= startX && x <= endX && y >= startY && y <= endY) {
          filtered[key] = parseInt(value, 10);
        }
      }
      return filtered;
    };

    result.layer0 = filterTiles(layer0);
    result.layer1 = filterTiles(layer1);
    result.layer2 = filterTiles(layer2);

    return result;
  } catch (error) {
    console.error('Error getting map tiles in range:', error);
    return { layer0: {}, layer1: {}, layer2: {} };
  }
}

/**
 * 맵 타일 일괄 저장 (마이그레이션용)
 */
export async function setMapTilesBulk(
  layer: 0 | 1 | 2,
  tiles: { [key: string]: number }
): Promise<void> {
  try {
    const redis = await getRedisClient();
    const entries = Object.entries(tiles).map(([key, value]) => [key, value.toString()]);

    if (entries.length > 0) {
      // Redis hSet은 key-value 쌍을 flat array로 받음
      const flatEntries: string[] = entries.flat();
      await redis.hSet(`${MAP_TILES_KEY}:layer${layer}`, flatEntries);
    }
  } catch (error) {
    console.error('Error setting map tiles bulk:', error);
    throw error;
  }
}

/**
 * 타일셋 정보 저장
 */
export async function setMapTilesets(tilesets: MapTilesetInfo[]): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.set(MAP_TILESETS_KEY, JSON.stringify(tilesets));
  } catch (error) {
    console.error('Error setting map tilesets:', error);
    throw error;
  }
}

/**
 * 타일셋 정보 조회
 */
export async function getMapTilesets(): Promise<MapTilesetInfo[] | null> {
  try {
    const redis = await getRedisClient();
    const data = await redis.get(MAP_TILESETS_KEY);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Error getting map tilesets:', error);
    return null;
  }
}

/**
 * 전체 맵 타일 개수 조회
 */
export async function getMapTileCount(): Promise<{ layer0: number; layer1: number; layer2: number }> {
  try {
    const redis = await getRedisClient();
    const [layer0, layer1, layer2] = await Promise.all([
      redis.hLen(`${MAP_TILES_KEY}:layer0`),
      redis.hLen(`${MAP_TILES_KEY}:layer1`),
      redis.hLen(`${MAP_TILES_KEY}:layer2`)
    ]);
    return { layer0, layer1, layer2 };
  } catch (error) {
    console.error('Error getting map tile count:', error);
    return { layer0: 0, layer1: 0, layer2: 0 };
  }
}

// ============ Custom Tile Images ============

// 커스텀 tileId 시작 번호 (기존 타일셋과 충돌 방지)
const CUSTOM_TILE_ID_START = 100000;

/**
 * 커스텀 타일 이미지 저장 (bulk)
 * @returns 저장된 tileId 배열
 */
export async function saveCustomTileImages(
  images: string[]  // base64 이미지 데이터 배열
): Promise<number[]> {
  try {
    const redis = await getRedisClient();

    // 현재 카운터 가져오기 (없으면 시작값 사용)
    const currentCounter = await redis.get(MAP_CUSTOM_TILE_COUNTER_KEY);
    let nextId = currentCounter ? parseInt(currentCounter, 10) : CUSTOM_TILE_ID_START;

    const tileIds: number[] = [];
    const entries: string[] = [];

    for (const imageData of images) {
      const tileId = nextId++;
      tileIds.push(tileId);
      entries.push(tileId.toString(), imageData);
    }

    if (entries.length > 0) {
      await redis.hSet(MAP_CUSTOM_TILES_KEY, entries);
      await redis.set(MAP_CUSTOM_TILE_COUNTER_KEY, nextId.toString());
    }

    return tileIds;
  } catch (error) {
    console.error('Error saving custom tile images:', error);
    throw error;
  }
}

/**
 * 커스텀 타일 이미지 조회 (단일)
 */
export async function getCustomTileImage(tileId: number): Promise<string | null> {
  try {
    const redis = await getRedisClient();
    return await redis.hGet(MAP_CUSTOM_TILES_KEY, tileId.toString());
  } catch (error) {
    console.error('Error getting custom tile image:', error);
    return null;
  }
}

/**
 * 커스텀 타일 이미지 조회 (bulk)
 */
export async function getCustomTileImages(tileIds: number[]): Promise<{ [tileId: number]: string }> {
  try {
    const redis = await getRedisClient();
    const result: { [tileId: number]: string } = {};

    if (tileIds.length === 0) return result;

    const values = await redis.hmGet(
      MAP_CUSTOM_TILES_KEY,
      tileIds.map(id => id.toString())
    );

    tileIds.forEach((tileId, index) => {
      if (values[index]) {
        result[tileId] = values[index] as string;
      }
    });

    return result;
  } catch (error) {
    console.error('Error getting custom tile images:', error);
    return {};
  }
}

/**
 * 모든 커스텀 타일 이미지 조회
 */
export async function getAllCustomTileImages(): Promise<{ [tileId: number]: string }> {
  try {
    const redis = await getRedisClient();
    const data = await redis.hGetAll(MAP_CUSTOM_TILES_KEY);

    const result: { [tileId: number]: string } = {};
    for (const [key, value] of Object.entries(data)) {
      result[parseInt(key, 10)] = value;
    }

    return result;
  } catch (error) {
    console.error('Error getting all custom tile images:', error);
    return {};
  }
}

// ============ Thread Migration ============

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
