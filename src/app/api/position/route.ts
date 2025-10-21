import { NextRequest, NextResponse } from 'next/server';
import { savePlayerPosition, getPlayerPosition } from '@/lib/redis';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    const position = await getPlayerPosition(userId);
    
    if (!position) {
      // Return default starting position if no saved position
      return NextResponse.json({
        position: { x: 0, y: 0 },
        lastUpdated: new Date().toISOString(),
        isDefault: true
      });
    }

    return NextResponse.json({
      position: { x: position.x, y: position.y },
      lastUpdated: position.lastUpdated,
      isDefault: false
    });
  } catch (error) {
    console.error('Error in GET /api/position:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, position } = body;

    if (!userId || !position || typeof position.x !== 'number' || typeof position.y !== 'number') {
      return NextResponse.json(
        { error: 'Invalid request data. userId and position {x, y} are required' },
        { status: 400 }
      );
    }

    await savePlayerPosition(userId, position);

    return NextResponse.json({
      success: true,
      position,
      savedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in POST /api/position:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}