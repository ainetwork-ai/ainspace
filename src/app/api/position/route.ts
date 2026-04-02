import { NextRequest, NextResponse } from 'next/server';
import {
  savePlayerPresence,
  removePlayerPresence,
  publishVillageEvent,
  getRedisClient,
} from '@/lib/redis';
import { worldToGrid } from '@/lib/village-utils';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json(
      { error: 'User ID is required' },
      { status: 400 }
    );
  }

  // GET is not actively used by client; return empty response
  return NextResponse.json({
    position: { x: 0, y: 0 },
    lastUpdated: new Date().toISOString(),
    isDefault: true,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, position, direction, village, displayName, spriteKey, action } = body;

    if (!userId || !position || typeof position.x !== 'number' || typeof position.y !== 'number') {
      return NextResponse.json(
        { error: 'Invalid request data. userId and position {x, y} are required' },
        { status: 400 }
      );
    }

    // Determine village slug
    let slug: string | null = village || null;
    if (!slug) {
      try {
        const { gridX, gridY } = worldToGrid(position.x, position.y);
        const redis = await getRedisClient();
        const found = await redis.get(`village:grid:${gridX},${gridY}`);
        slug = found || null;
      } catch {
        // Grid lookup failed — treat as outdoor
      }
    }

    // Handle disconnect action
    if (action === 'disconnect') {
      if (slug) {
        try {
          await removePlayerPresence(slug, userId);
        } catch {
          console.error('Error removing presence on disconnect');
        }
      }
      return NextResponse.json({ success: true });
    }

    // Save presence + publish PLAYER_MOVED (only if in a village)
    if (slug) {
      try {
        await savePlayerPresence(slug, userId, {
          x: position.x,
          y: position.y,
          direction: direction || 'down',
          displayName: displayName || userId.slice(0, 8),
          spriteKey: spriteKey || 'sprite_user.png',
        });
        // PLAYER_MOVED is lightweight — no displayName/spriteKey
        await publishVillageEvent(slug, {
          type: 'PLAYER_MOVED',
          userId,
          x: position.x,
          y: position.y,
          direction: direction || 'down',
        });
      } catch (error) {
        console.error('Error saving presence / publishing event:', error);
        // Don't fail the request — game should continue
      }
    }

    return NextResponse.json({
      success: true,
      position,
      savedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in POST /api/position:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
