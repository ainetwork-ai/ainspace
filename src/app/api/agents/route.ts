import { NextRequest, NextResponse } from 'next/server';
import { AgentCard } from '@a2a-js/sdk';
import { getRedisClient, StoredAgent } from '@/lib/redis';

const AGENTS_KEY = 'agents:';

// Fallback in-memory store if Redis is not available
const agentStore = new Map<string, StoredAgent>();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');

  try {
    let agents: { url: string; card: AgentCard; timestamp: number }[] = [];
    
    try {
      // Try Redis first
      const redis = await getRedisClient();
      const keys = await redis.keys(`${AGENTS_KEY}*`);
      
      if (keys.length > 0) {
        const values = await redis.mGet(keys);
        agents = values
          .filter(value => value !== null)
          .map(value => JSON.parse(value!))
          .filter(agent => agent && agent.url && agent.card)
          .filter(agent => {
            if (!address) {
              return true;
            }
            return agent.creator && agent.creator === address
          });
        
        console.log(`Loaded ${agents.length} agents from Redis`);
      }
    } catch (redisError) {
      console.warn('Redis unavailable, using fallback storage:', redisError);
      // Use fallback in-memory storage
      agents = Array.from(agentStore.values());
    }

    return NextResponse.json({ 
      success: true,
      agents: agents.sort((a, b) => b.timestamp - a.timestamp) // Sort by newest first
    });
  } catch (error) {
    console.error('Error fetching agents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { url, card, state, creator, isPlaced, spriteUrl, spriteHeight } = await request.json();

    if (!url || !card) {
      return NextResponse.json(
        { error: 'Agent URL and card are required' },
        { status: 400 }
      );
    }

    const agentKey = `${AGENTS_KEY}${Buffer.from(url).toString('base64')}`;
    const agentData: StoredAgent = {
      url: url,
      card: card,
      state: state,
      creator: creator,
      timestamp: Date.now(),
      isPlaced: isPlaced,
      spriteUrl: spriteUrl,
      spriteHeight: spriteHeight
    }

    try {
      // Try Redis first
      const redis = await getRedisClient();
      
      // Check for duplicate
      const existing = await redis.get(agentKey);
      if (existing) {
        console.log(`Agent already exists: ${card.name} (${url})`);
        return NextResponse.json(
          {
            success: true,
            message: 'Agent already exists',
            duplicate: true,
            agent: {
              url: url,
              card: card
            }
          },
          { status: 200 }
        );
      }

      // Store agent in Redis
      await redis.set(agentKey, JSON.stringify(agentData));
      console.log(`Stored agent in Redis: ${card.name} (${url})`);

    } catch (redisError) {
      console.warn('Redis unavailable, using fallback storage:', redisError);
      
      // Check for duplicate in fallback storage
      if (agentStore.has(url)) {
        console.log(`Agent already exists in memory: ${card.name} (${url})`);
        return NextResponse.json(
          {
            success: true,
            message: 'Agent already exists',
            duplicate: true,
            agent: {
              url: url,
              card: card
            }
          },
          { status: 200 }
        );
      }

      // Store agent in fallback storage
      agentStore.set(url, agentData);
      console.log(`Stored agent in memory: ${card.name} (${url})`);
    }

    return NextResponse.json({ 
      success: true,
      message: 'Agent stored successfully',
      agent: {
        url: url,
        card: card
      }
    });

  } catch (error) {
    console.error('Error storing agent:', error);
    return NextResponse.json(
      { error: 'Failed to store agent' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { url, card, state, creator, isPlaced, spriteUrl, spriteHeight } = await request.json();

    // url is required to identify the agent
    if (!url) {
      return NextResponse.json(
        { error: 'Agent URL is required' },
        { status: 400 }
      );
    }

    const agentKey = `${AGENTS_KEY}${Buffer.from(url).toString('base64')}`;
    
    try {
      // Try Redis first
      const redis = await getRedisClient();
      
      // Check if agent exists
      const existing = await redis.get(agentKey);
      if (!existing) {
        return NextResponse.json(
          { error: 'Agent not found' },
          { status: 404 }
        );
      }

      // Parse existing data and merge with updates (partial update)
      const existingData: StoredAgent = JSON.parse(existing);
      const agentData: StoredAgent = {
        url: existingData.url, // Always preserve original url
        card: card !== undefined ? card : existingData.card,
        state: state !== undefined ? state : existingData.state,
        creator: creator !== undefined ? creator : existingData.creator,
        timestamp: existingData.timestamp, // Preserve original timestamp
        isPlaced: isPlaced !== undefined ? isPlaced : existingData.isPlaced,
        spriteUrl: spriteUrl !== undefined ? spriteUrl : existingData.spriteUrl,
        spriteHeight: spriteHeight !== undefined ? spriteHeight : existingData.spriteHeight
      };

      // Update agent in Redis (partial update - only provided fields are updated)
      await redis.set(agentKey, JSON.stringify(agentData));
      console.log(`Updated agent in Redis: ${agentData.card?.name || url} (${url})`);
    } catch (redisError) {
      console.warn('Redis unavailable, using fallback storage:', redisError);
      
      // Check if agent exists in fallback storage
      if (!agentStore.has(url)) {
        return NextResponse.json(
          { error: 'Agent not found' },
          { status: 404 }
        );
      }

      // Update agent in fallback storage (partial update)
      const existingData = agentStore.get(url)!;
      const agentData: StoredAgent = {
        url: existingData.url, // Always preserve original url
        card: card !== undefined ? card : existingData.card,
        state: state !== undefined ? state : existingData.state,
        creator: creator !== undefined ? creator : existingData.creator,
        timestamp: existingData.timestamp, // Preserve original timestamp
        isPlaced: isPlaced !== undefined ? isPlaced : existingData.isPlaced,
        spriteUrl: spriteUrl !== undefined ? spriteUrl : existingData.spriteUrl,
        spriteHeight: spriteHeight !== undefined ? spriteHeight : existingData.spriteHeight
      };
      agentStore.set(url, agentData);
      console.log(`Updated agent in memory: ${agentData.card?.name || url} (${url})`);
    }

    return NextResponse.json({ 
      success: true,
      message: 'Agent updated successfully'
    });

  } catch (error) {
    console.error('Error updating agent:', error);
    return NextResponse.json(
      { error: 'Failed to update agent' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentUrl = searchParams.get('url');

    if (!agentUrl) {
      return NextResponse.json(
        { error: 'Agent URL is required' },
        { status: 400 }
      );
    }

    const agentKey = `${AGENTS_KEY}${Buffer.from(agentUrl).toString('base64')}`;
    let deleted = false;

    try {
      // Try Redis first
      const redis = await getRedisClient();
      const result = await redis.del(agentKey);
      deleted = result > 0;
      
      if (deleted) {
        console.log(`Deleted agent from Redis: ${agentUrl}`);
      }
    } catch (redisError) {
      console.warn('Redis unavailable, using fallback storage:', redisError);
      deleted = agentStore.delete(agentUrl);
      
      if (deleted) {
        console.log(`Deleted agent from memory: ${agentUrl}`);
      }
    }

    if (!deleted) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ 
      success: true,
      message: 'Agent deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting agent:', error);
    return NextResponse.json(
      { error: 'Failed to delete agent' },
      { status: 500 }
    );
  }
}


