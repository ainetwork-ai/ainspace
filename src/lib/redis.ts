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
    if (error instanceof Error && (error.message?.includes('Socket already opened') || error.message?.includes('already connected'))) {
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