import { NextRequest, NextResponse } from 'next/server';
import { AgentCard } from '@a2a-js/sdk';
import { getRedisClient } from '@/lib/redis';

const AGENTS_KEY = 'agents:';

// Fallback in-memory store if Redis is not available
const agentStore = new Map<string, { url: string; card: AgentCard; timestamp: number }>();

export async function GET() {
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
          .filter(agent => agent && agent.url && agent.card);
        
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
    const { agentUrl, agentCard } = await request.json();

    if (!agentUrl || !agentCard) {
      return NextResponse.json(
        { error: 'Agent URL and card are required' },
        { status: 400 }
      );
    }

    const agentKey = `${AGENTS_KEY}${Buffer.from(agentUrl).toString('base64')}`;
    const agentData = {
      url: agentUrl,
      card: agentCard,
      timestamp: Date.now()
    };

    try {
      // Try Redis first
      const redis = await getRedisClient();
      
      // Check for duplicate
      const existing = await redis.get(agentKey);
      if (existing) {
        return NextResponse.json(
          { error: 'Agent already exists', duplicate: true },
          { status: 409 }
        );
      }

      // Store agent in Redis
      await redis.set(agentKey, JSON.stringify(agentData));
      console.log(`Stored agent in Redis: ${agentCard.name} (${agentUrl})`);

    } catch (redisError) {
      console.warn('Redis unavailable, using fallback storage:', redisError);
      
      // Check for duplicate in fallback storage
      if (agentStore.has(agentUrl)) {
        return NextResponse.json(
          { error: 'Agent already exists', duplicate: true },
          { status: 409 }
        );
      }

      // Store agent in fallback storage
      agentStore.set(agentUrl, agentData);
      console.log(`Stored agent in memory: ${agentCard.name} (${agentUrl})`);
    }

    return NextResponse.json({ 
      success: true,
      message: 'Agent stored successfully',
      agent: {
        url: agentUrl,
        card: agentCard
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