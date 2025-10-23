import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

/**
 * API endpoint to clear all layer1 items (TempBuildTab items) from the database
 * GET /api/clear-layer1
 *
 * This resets layer1 to empty while preserving layer0 and layer2 content.
 */
export async function GET() {
    try {
        const redis = await getRedisClient();

        // Get current global tiles
        const globalTilesData = await redis.hGetAll('global-tiles');

        if (!globalTilesData || Object.keys(globalTilesData).length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No global tiles found in database. Nothing to clear.',
                layer1Cleared: 0,
                layer0Preserved: 0,
                layer2Preserved: 0
            });
        }

        const parsedTiles = JSON.parse(globalTilesData.tiles || '{}');

        // Count current layer1 items
        const layer1Count = Object.keys(parsedTiles.layer1 || {}).length;

        if (layer1Count === 0) {
            return NextResponse.json({
                success: true,
                message: 'Layer1 is already empty. Nothing to clear.',
                layer1Cleared: 0,
                layer0Preserved: Object.keys(parsedTiles.layer0 || {}).length,
                layer2Preserved: Object.keys(parsedTiles.layer2 || {}).length
            });
        }

        // Clear layer1 while preserving layer0 and layer2
        const clearedTiles = {
            layer0: parsedTiles.layer0 || {},
            layer1: {}, // Empty layer1
            layer2: parsedTiles.layer2 || {}
        };

        // Save back to database
        await redis.hSet('global-tiles', {
            tiles: JSON.stringify(clearedTiles),
            lastUpdated: new Date().toISOString()
        });

        return NextResponse.json({
            success: true,
            message: `Successfully cleared ${layer1Count} items from layer1`,
            layer1Cleared: layer1Count,
            layer0Preserved: Object.keys(clearedTiles.layer0).length,
            layer2Preserved: Object.keys(clearedTiles.layer2).length,
            clearedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error clearing layer1 items:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Failed to clear layer1 items',
                details: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}
