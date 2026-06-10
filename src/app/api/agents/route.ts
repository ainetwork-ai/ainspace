import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient, StoredAgent, addPlacedAgent, removePlacedAgent, getPlacedAgentCount, scanKeys, upsertAgentFromRosterItem } from '@/lib/redis';
import { canImportAgent, canPlaceAgent, canPlaceAgentOnMap, hasAdminAccess } from '@/lib/auth/permissions';
import { MOVEMENT_MODE } from '@/constants/game';
import { worldToGrid } from '@/lib/village-utils';
import { getVillageByGrid } from '@/lib/village-redis';
import { getBearer, backendFetch } from '@/lib/backend/server-client';
import { BACKEND_WORKSPACE_ID, isBackendWorkspaceConfigured } from '@/lib/backend/config';
import { BackendAgentListItem } from '@/lib/backend/agent-mapping';

const AGENTS_KEY = 'agents:';

// Fallback in-memory store if Redis is not available
const agentStore = new Map<string, StoredAgent>();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');
  const villagesParam = searchParams.get('villages');
  const villageFilter = villagesParam ? new Set(villagesParam.split(',').map(v => v.trim()).filter(Boolean)) : null;

  try {
    let agents: StoredAgent[] = [];

    try {
      // Try Redis first
      const keys = await scanKeys(`${AGENTS_KEY}*`);

      if (keys.length > 0) {
        const redis = await getRedisClient();
        const values = await redis.mGet(keys);
        agents = values
          .filter(value => value !== null)
          .map(value => JSON.parse(value!))
          .filter(agent => agent && agent.url && agent.card)
          .filter(agent => {
            if (address) {
              return agent.creator && agent.creator === address;
            }
            if (villageFilter) {
              return agent.state?.mapName && villageFilter.has(agent.state.mapName);
            }
            return true;
          });

        console.log(`Loaded ${agents.length} agents from Redis${villageFilter ? ` (villages: ${villagesParam})` : ''}`);
      }
    } catch (redisError) {
      console.warn('Redis unavailable, using fallback storage:', redisError);
      // Use fallback in-memory storage
      agents = Array.from(agentStore.values());
    }

    return NextResponse.json({ 
      success: true,
      agents: agents.sort((a, b) => b.timestamp - a.timestamp) // Sort by newest first
    }, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    });
  } catch (error) {
    console.error('Error fetching agents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/agents  (EPIC17)
 * Import = invite the agent into the backend workspace, then materialize the
 * returned agent into Redis. Body: { agentUrl, creator }. The backend fetches the
 * card, dedups by canonical a2aUrl, and records ownership; ainspace no longer
 * fetches the card (no /api/agent-proxy) nor builds the StoredAgent client-side.
 */
export async function POST(request: NextRequest) {
  try {
    const { agentUrl, creator } = await request.json();

    if (!agentUrl || !creator) {
      return NextResponse.json({ error: 'agentUrl and creator are required' }, { status: 400 });
    }

    const token = getBearer(request);
    if (!token) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    if (!isBackendWorkspaceConfigured()) {
      return NextResponse.json({ error: 'BACKEND_WORKSPACE_ID is not configured' }, { status: 503 });
    }

    // ainspace import-policy gate (holder/permission). `code` marks this apart
    // from a backend ownership 403 so the client routes the two differently.
    const importCheck = await canImportAgent(creator);
    if (!importCheck.allowed) {
      return NextResponse.json(
        { error: importCheck.reason || 'No permission to import agents', code: 'NO_IMPORT_PERMISSION' },
        { status: 403 },
      );
    }

    // Invite into the backend workspace (backend fetches card + dedups + records
    // agentInvitedBy). Non-2xx (e.g. 403 for someone else's private agent) is
    // forwarded verbatim so the client can show the backend's `message`.
    const res = await backendFetch(
      token,
      `/agents?workspaceId=${encodeURIComponent(BACKEND_WORKSPACE_ID)}`,
      { method: 'POST', body: JSON.stringify({ a2aUrl: agentUrl }) },
    );
    if (!res.ok) {
      const body = await res.text();
      return new NextResponse(body, {
        status: res.status,
        headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
      });
    }

    const invited = (await res.json()) as BackendAgentListItem;
    const agent = await upsertAgentFromRosterItem(creator, invited);
    if (!agent) {
      return NextResponse.json({ error: 'invited agent has no resolvable a2a url' }, { status: 502 });
    }

    return NextResponse.json({ success: true, agent });
  } catch (error) {
    console.error('Error importing (inviting) agent:', error);
    return NextResponse.json({ error: 'Failed to import agent' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { url, card, state, creator, isPlaced, spriteUrl, spriteHeight, mapName } = await request.json();

    // url is required to identify the agent
    if (!url) {
      return NextResponse.json(
        { error: 'Agent URL is required' },
        { status: 400 }
      );
    }

    const agentKey = `${AGENTS_KEY}${Buffer.from(url).toString('base64')}`;

    let agentData: StoredAgent;

    try {
      // Try Redis first
      const redis = await getRedisClient();

      // Check if agent exists
      const existing = await redis.get(agentKey);
      if (!existing) {
        return NextResponse.json(
          { error: 'Agent not found' },
          {
            status: 404,
            headers: {
              'Content-Type': 'application/json; charset=utf-8'
            }
          }
        );
      }

      // Parse existing data and merge with updates (partial update)
      const existingData: StoredAgent = JSON.parse(existing);

      // Optional: Validate movement mode if provided
      if (state?.movementMode !== undefined) {
        const validModes = Object.values(MOVEMENT_MODE);
        if (!validModes.includes(state.movementMode as MOVEMENT_MODE)) {
          return NextResponse.json(
            { error: `Invalid movement mode: ${state.movementMode}` },
            { status: 400 }
          );
        }
      }

      // If placing an agent (isPlaced: true), check permissions
      if (isPlaced === true && existingData.isPlaced !== true && creator) {
        // Check if user can place agents
        const currentPlacedCount = await getPlacedAgentCount(creator);

        const placeCheck = await canPlaceAgent(creator, currentPlacedCount);
        if (!placeCheck.allowed) {
          return NextResponse.json(
            { error: placeCheck.reason || 'No permission to place agents' },
            { status: 403 }
          );
        }

        // Verify mapName by calculating from coordinates (security check)
        if (state?.x !== undefined && state?.y !== undefined) {
          const { gridX, gridY } = worldToGrid(state.x, state.y);
          const village = await getVillageByGrid(gridX, gridY);
          const actualMapName = village?.slug ?? null;
          const displayName = village?.name ?? actualMapName ?? 'no village';

          // Compare client-provided mapName with server-calculated mapName
          if (actualMapName !== mapName) {
            return NextResponse.json(
              {
                error: `Map validation failed: position (${state.x}, ${state.y}) is in ${displayName}, but received mapName="${mapName}"`
              },
              { status: 400 }
            );
          }

          // Check if user can place on the actual map
          if (actualMapName) {
            const mapCheck = await canPlaceAgentOnMap(creator, actualMapName);
            if (!mapCheck.allowed) {
              return NextResponse.json(
                { error: mapCheck.reason || `No permission to place agents on ${displayName}` },
                { status: 403 }
              );
            }
          }
        } else if (mapName) {
          // If mapName is provided but coordinates are missing, reject
          return NextResponse.json(
            { error: 'Coordinates (x, y) are required when placing an agent' },
            { status: 400 }
          );
        }
      }

      // Merge state: preserve existing fields, override with provided ones
      let mergedState = existingData.state;
      if (state !== undefined) {
        mergedState = { ...existingData.state, ...state };
        // Auto-set mapName from coordinates if not explicitly provided
        if (mergedState.x !== undefined && mergedState.y !== undefined && !state.mapName) {
          const { gridX, gridY } = worldToGrid(mergedState.x, mergedState.y);
          const village = await getVillageByGrid(gridX, gridY);
          if (village?.slug) {
            mergedState.mapName = village.slug;
          }
        }
      }

      agentData = {
        ...existingData, // Preserve untouched fields (backendUuid/backendStatus, url, timestamp)
        card: card !== undefined ? card : existingData.card,
        state: mergedState,
        creator: creator !== undefined ? creator : existingData.creator,
        isPlaced: isPlaced !== undefined ? isPlaced : existingData.isPlaced,
        spriteUrl: spriteUrl !== undefined ? spriteUrl : existingData.spriteUrl,
        spriteHeight: spriteHeight !== undefined ? spriteHeight : existingData.spriteHeight
      };

      // Update agent in Redis (partial update - only provided fields are updated)
      await redis.set(agentKey, JSON.stringify(agentData));
      console.log(`Updated agent in Redis: ${agentData.card?.name || url} (${url})`);

      // Update user's placed agents list
      if (agentData.creator) {
        if (isPlaced === true && existingData.isPlaced !== true) {
          // Agent is being placed - add to user's placed agents list
          await addPlacedAgent(agentData.creator, url);
          console.log(`Added agent to placed agents list for user ${agentData.creator}: ${url}`);
        } else if (isPlaced === false && existingData.isPlaced === true) {
          // Agent is being unplaced - remove from user's placed agents list
          await removePlacedAgent(agentData.creator, url);
          console.log(`Removed agent from placed agents list for user ${agentData.creator}: ${url}`);
        }
      }
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
      agentData = {
        ...existingData, // Preserve untouched fields (backendUuid/backendStatus, url, timestamp)
        card: card !== undefined ? card : existingData.card,
        state: state !== undefined ? state : existingData.state,
        creator: creator !== undefined ? creator : existingData.creator,
        isPlaced: isPlaced !== undefined ? isPlaced : existingData.isPlaced,
        spriteUrl: spriteUrl !== undefined ? spriteUrl : existingData.spriteUrl,
        spriteHeight: spriteHeight !== undefined ? spriteHeight : existingData.spriteHeight
      };
      agentStore.set(url, agentData);
      console.log(`Updated agent in memory: ${agentData.card?.name || url} (${url})`);
    }

    return NextResponse.json({
      success: true,
      message: 'Agent updated successfully',
      agent: {
        url: url,
        card: agentData.card,
        spriteUrl: agentData.spriteUrl,
        spriteHeight: agentData.spriteHeight
      }
    }, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
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
    const userId = searchParams.get('userId');

    if (!agentUrl) {
      return NextResponse.json(
        { error: 'Agent URL is required' },
        { status: 400 }
      );
    }

    const agentKey = `${AGENTS_KEY}${Buffer.from(agentUrl).toString('base64')}`;

    // Fetch agent data to check ownership
    let existingData: StoredAgent | null = null;
    try {
      const redis = await getRedisClient();
      const existing = await redis.get(agentKey);
      if (!existing) {
        return NextResponse.json(
          { error: 'Agent not found' },
          { status: 404 }
        );
      }
      existingData = JSON.parse(existing);
    } catch (redisError) {
      console.warn('Redis unavailable, using fallback storage:', redisError);
      const fallback = agentStore.get(agentUrl);
      if (!fallback) {
        return NextResponse.json(
          { error: 'Agent not found' },
          { status: 404 }
        );
      }
      existingData = fallback;
    }

    // Check permission: admin (bypass) or owner
    const isAdmin = await hasAdminAccess(userId ?? '');
    if (!isAdmin.allowed && existingData?.creator !== userId) {
      return NextResponse.json(
        { error: 'Only the agent creator or admin can delete this agent' },
        { status: 403 }
      );
    }

    // Delete agent
    let deleted = false;
    try {
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
        { error: 'Failed to delete agent' },
        { status: 500 }
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


