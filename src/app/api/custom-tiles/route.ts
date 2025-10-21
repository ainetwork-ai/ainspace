import { NextRequest, NextResponse } from 'next/server';
import { saveCustomTiles, getCustomTiles, TileLayers } from '@/lib/redis';

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

    const customTilesData = await getCustomTiles(userId);
    
    if (!customTilesData) {
      // Return empty tiles if no saved data
      return NextResponse.json({
        tiles: {
          layer0: {},
          layer1: {},
          layer2: {}
        },
        lastUpdated: new Date().toISOString(),
        isDefault: true
      });
    }

    return NextResponse.json({
      tiles: customTilesData.tiles,
      lastUpdated: customTilesData.lastUpdated,
      isDefault: false
    });
  } catch (error) {
    console.error('Error in GET /api/custom-tiles:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, customTiles } = body;

    if (!userId || !customTiles || typeof customTiles !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request data. userId and customTiles object are required' },
        { status: 400 }
      );
    }

    // Validate TileLayers structure
    const tileLayers = customTiles as TileLayers;
    if (!tileLayers.layer0 && !tileLayers.layer1 && !tileLayers.layer2) {
      return NextResponse.json(
        { error: 'Invalid tiles structure. Expected layer0, layer1, layer2 properties' },
        { status: 400 }
      );
    }

    await saveCustomTiles(userId, tileLayers);

    // Count total tiles across all layers
    const tileCount = Object.keys(tileLayers.layer0 || {}).length + 
                     Object.keys(tileLayers.layer1 || {}).length + 
                     Object.keys(tileLayers.layer2 || {}).length;

    return NextResponse.json({
      success: true,
      tileCount,
      savedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in POST /api/custom-tiles:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}