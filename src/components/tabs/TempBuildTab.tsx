'use client';

import React, { useState, useCallback } from 'react';
import BaseTabContent from './BaseTabContent';
import TileMap from '@/components/TileMap';
import { cn } from '@/lib/utils';
import { TILE_SIZE } from '@/constants/game';
import { useBuildStore, useAgentStore } from '@/stores';
import { useGameState } from '@/hooks/useGameState';
import { useMapStore } from '@/stores/useMapStore';

interface BuildTabProps {
    isActive: boolean;
    userId: string | null;
}

interface PendingTile {
    x: number;
    y: number;
    imageData: string;
}

export default function TempBuildTab({
    isActive,
    userId
}: BuildTabProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [expandStatus, setExpandStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const [pendingTiles, setPendingTiles] = useState<PendingTile[]>([]);
    const [userPreference, setUserPreference] = useState('');

    const { collisionMap, publishedTiles, customTiles } = useBuildStore();
    const { agents } = useAgentStore();
    const { mapData, playerPosition, worldPosition, playerDirection, isPlayerMoving } = useGameState();
    const { tilesets, tiles, customTileImages } = useMapStore();

    const GRID_SIZE = 20;

    // Find empty tile positions around current position
    const emptyTilePositions = React.useMemo((): { x: number; y: number }[] => {
        const emptyPositions: { x: number; y: number }[] = [];

        for (let dy = 0; dy < GRID_SIZE; dy++) {
            for (let dx = 0; dx < GRID_SIZE; dx++) {
                const tileWorldX = worldPosition.x + dx - Math.floor(GRID_SIZE / 2);
                const tileWorldY = worldPosition.y + dy - Math.floor(GRID_SIZE / 2);
                const key = `${tileWorldX},${tileWorldY}`;
                const tileId = tiles.layer0[key];

                // Only include positions without existing tiles
                if (!tileId || tileId === 0) {
                    emptyPositions.push({ x: tileWorldX, y: tileWorldY });
                }
            }
        }

        return emptyPositions;
    }, [worldPosition.x, worldPosition.y, tiles.layer0]);

    const hasEmptyTiles = emptyTilePositions.length > 0;
    const hasPendingTiles = pendingTiles.length > 0;

    // Capture surrounding tiles as image and mask for AI context
    const captureSurroundingTilesAsImage = useCallback(async (): Promise<{ contextImage: string; maskImage: string } | null> => {
        const tileset = tilesets[0];
        if (!tileset) return null;

        // Context image canvas
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        // Mask canvas (white = fill, black = keep)
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = 1024;
        maskCanvas.height = 1024;
        const maskCtx = maskCanvas.getContext('2d');
        if (!maskCtx) return null;

        // Fill backgrounds
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, 1024, 1024);
        maskCtx.fillStyle = '#FFFFFF'; // White = areas to fill
        maskCtx.fillRect(0, 0, 1024, 1024);

        const tileRenderSize = Math.floor(1024 / GRID_SIZE);
        const CUSTOM_TILE_ID_START = 100000;

        // Draw surrounding tiles
        for (let dy = 0; dy < GRID_SIZE; dy++) {
            for (let dx = 0; dx < GRID_SIZE; dx++) {
                const tileWorldX = worldPosition.x + dx - Math.floor(GRID_SIZE / 2);
                const tileWorldY = worldPosition.y + dy - Math.floor(GRID_SIZE / 2);
                const key = `${tileWorldX},${tileWorldY}`;
                const tileId = tiles.layer0[key];

                const canvasX = dx * tileRenderSize;
                const canvasY = dy * tileRenderSize;

                if (!tileId || tileId === 0) {
                    continue; // Leave white in both canvases
                }

                try {
                    // Custom tile (tileId >= 100000)
                    if (typeof tileId === 'number' && tileId >= CUSTOM_TILE_ID_START) {
                        const customImageData = customTileImages[tileId];
                        if (customImageData) {
                            // Load custom tile image
                            const img = new Image();
                            img.src = customImageData;
                            await new Promise<void>((resolve) => {
                                img.onload = () => resolve();
                                img.onerror = () => resolve(); // Skip on error
                            });
                            if (img.complete && img.naturalWidth > 0) {
                                ctx.drawImage(img, canvasX, canvasY, tileRenderSize, tileRenderSize);
                                maskCtx.fillStyle = '#000000';
                                maskCtx.fillRect(canvasX, canvasY, tileRenderSize, tileRenderSize);
                            }
                        }
                        continue;
                    }

                    // Regular tileset tile
                    const localId = tileId - tileset.firstgid;
                    if (localId < 0) continue;

                    const scale = tileset.imageScale || 1;
                    const sx = (localId % tileset.columns) * tileset.tilewidth * scale;
                    const sy = Math.floor(localId / tileset.columns) * tileset.tileheight * scale;
                    const sw = tileset.tilewidth * scale;
                    const sh = tileset.tileheight * scale;

                    ctx.drawImage(
                        tileset.image,
                        sx, sy, sw, sh,
                        canvasX, canvasY, tileRenderSize, tileRenderSize
                    );
                    // Mark as black in mask (keep this area)
                    maskCtx.fillStyle = '#000000';
                    maskCtx.fillRect(canvasX, canvasY, tileRenderSize, tileRenderSize);
                } catch (e) {
                    console.error('Error drawing tile:', e);
                }
            }
        }

        return {
            contextImage: canvas.toDataURL('image/png'),
            maskImage: maskCanvas.toDataURL('image/png')
        };
    }, [tilesets, tiles.layer0, customTileImages, worldPosition.x, worldPosition.y]);

    // Generate tiles with AI (preview only, not saved)
    const handleGenerate = useCallback(async () => {
        if (!userId) {
            setExpandStatus({ type: 'error', message: 'Please login to expand the world' });
            return;
        }

        if (emptyTilePositions.length === 0) {
            return;
        }

        setIsGenerating(true);
        setExpandStatus(null);
        setPendingTiles([]);

        try {
            console.log(`Generating tiles for ${emptyTilePositions.length} empty positions`);

            // Capture surrounding tiles as image and mask for AI context
            const captured = await captureSurroundingTilesAsImage();
            if (!captured) {
                throw new Error('Failed to capture tile context');
            }

            // Save captured image for display
            setCapturedImage(captured.contextImage);

            // Call AI API to generate image
            const response = await fetch('/api/map/generate-tile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contextImage: captured.contextImage,
                    maskImage: captured.maskImage,
                    emptyPositions: emptyTilePositions,
                    gridSize: GRID_SIZE,
                    worldPosition: { x: worldPosition.x, y: worldPosition.y },
                    prompt: `Fill in the white/empty areas with 2D top-down RPG game tiles that seamlessly match the existing terrain. Pixel art style. Use grass, dirt, stone tiles that blend naturally with surrounding tiles.${userPreference ? ` User preference: ${userPreference}` : ''}`
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to generate tiles');
            }

            const data = await response.json();
            console.log('AI generation response:', data);

            if (!data.success || !data.generatedImage) {
                throw new Error(data.error || 'AI failed to generate image');
            }

            // Save generated image for display
            setGeneratedImage(data.generatedImage);

            console.log('Generated image received, slicing into tiles...');

            // Slice the generated image into tiles
            const img = new Image();
            img.src = data.generatedImage;

            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('Failed to load generated image'));
            });

            const tileRenderSize = Math.floor(1024 / GRID_SIZE);
            const slicedTiles: PendingTile[] = [];

            // Create a canvas to slice the image
            const sliceCanvas = document.createElement('canvas');
            sliceCanvas.width = tileRenderSize;
            sliceCanvas.height = tileRenderSize;
            const sliceCtx = sliceCanvas.getContext('2d');

            if (!sliceCtx) {
                throw new Error('Failed to create canvas context');
            }

            // Slice each empty position from the generated image
            for (const pos of emptyTilePositions) {
                const key = `${pos.x},${pos.y}`;
                const existingTile = tiles.layer0[key];

                // Skip if tile already exists
                if (existingTile && existingTile !== 0) {
                    continue;
                }

                // Calculate position in the generated image
                const dx = pos.x - (worldPosition.x - Math.floor(GRID_SIZE / 2));
                const dy = pos.y - (worldPosition.y - Math.floor(GRID_SIZE / 2));

                // Skip if outside the generated image bounds
                if (dx < 0 || dx >= GRID_SIZE || dy < 0 || dy >= GRID_SIZE) {
                    continue;
                }

                // Extract the tile slice
                sliceCtx.clearRect(0, 0, tileRenderSize, tileRenderSize);
                sliceCtx.drawImage(
                    img,
                    dx * tileRenderSize, dy * tileRenderSize, tileRenderSize, tileRenderSize,
                    0, 0, tileRenderSize, tileRenderSize
                );

                const tileImageData = sliceCanvas.toDataURL('image/png');
                slicedTiles.push({ x: pos.x, y: pos.y, imageData: tileImageData });
            }

            setPendingTiles(slicedTiles);
            setExpandStatus({
                type: 'success',
                message: `Generated ${slicedTiles.length} tiles. Click Confirm to publish.`
            });
        } catch (error) {
            console.error('Error generating tiles:', error);
            setExpandStatus({
                type: 'error',
                message: error instanceof Error ? error.message : 'Failed to generate tiles'
            });
        } finally {
            setIsGenerating(false);
        }
    }, [userId, emptyTilePositions, worldPosition, captureSurroundingTilesAsImage, tiles.layer0, userPreference]);

    // Publish (confirm) the generated tiles to Redis
    const handleConfirm = useCallback(async () => {
        if (pendingTiles.length === 0) return;

        setIsPublishing(true);
        setExpandStatus(null);

        try {
            console.log(`Publishing ${pendingTiles.length} tiles to Redis...`);
            const saveResponse = await fetch('/api/map/tiles', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    layer: 0,
                    tiles: pendingTiles
                })
            });

            if (!saveResponse.ok) {
                const errorData = await saveResponse.json();
                throw new Error(errorData.error || 'Failed to save tiles');
            }

            const saveResult = await saveResponse.json();
            console.log('Tiles published:', saveResult);

            // Update local store with new tileIds
            const { addCustomTileImages, setTile } = useMapStore.getState();
            const newCustomImages: { [tileId: number]: string } = {};

            pendingTiles.forEach((tile, index) => {
                const tileId = saveResult.tileIds[index];
                newCustomImages[tileId] = tile.imageData;
                setTile(0, tile.x, tile.y, tileId);
            });

            addCustomTileImages(newCustomImages);

            // Clear pending state
            setPendingTiles([]);
            setCapturedImage(null);
            setGeneratedImage(null);
            setUserPreference('');

            setExpandStatus({
                type: 'success',
                message: `Successfully published ${pendingTiles.length} tiles!`
            });
        } catch (error) {
            console.error('Error publishing tiles:', error);
            setExpandStatus({
                type: 'error',
                message: error instanceof Error ? error.message : 'Failed to publish tiles'
            });
        } finally {
            setIsPublishing(false);
        }
    }, [pendingTiles]);

    // Retry - clear and regenerate
    const handleRetry = useCallback(() => {
        setPendingTiles([]);
        setGeneratedImage(null);
        setCapturedImage(null);
        setExpandStatus(null);
        handleGenerate();
    }, [handleGenerate]);

    // Cancel - clear pending state
    const handleCancel = useCallback(() => {
        setPendingTiles([]);
        setGeneratedImage(null);
        setCapturedImage(null);
        setExpandStatus(null);
    }, []);

    return (
        <BaseTabContent isActive={isActive} withPadding={false} className="bg-white">
            <div className="flex h-full w-full flex-col items-center overflow-y-auto px-6">
                <div className="mt-8 flex w-full max-w-4xl flex-col items-center gap-4 pb-8">
                    <div className="inline-flex flex-col items-start justify-start gap-1 self-stretch rounded bg-[#faf4fe] px-2.5 py-2 outline-1 outline-offset-[-1px] outline-[#d7c1e5]">
                        <p className="justify-start text-base font-bold text-[#87659e]">Build Mode</p>
                        <p className="justify-start text-sm font-normal text-[#b68ed2]">
                            {hasPendingTiles
                                ? `${pendingTiles.length} tiles ready to publish.`
                                : hasEmptyTiles
                                    ? `${emptyTilePositions.length} tiles to be generated.`
                                    : 'No empty tiles around your position.'}
                        </p>
                    </div>

                    {/* User preference input */}
                    <div className="w-full">
                        <label className="text-sm font-medium text-gray-700 mb-1 block">
                            Style Preference (optional)
                        </label>
                        <input
                            type="text"
                            value={userPreference}
                            onChange={(e) => setUserPreference(e.target.value)}
                            placeholder="e.g., forest, desert, snow, ocean, lava..."
                            disabled={isGenerating || isPublishing}
                            className={cn(
                                'w-full px-3 py-2 border border-gray-300 rounded-md text-sm',
                                'focus:outline-none focus:ring-2 focus:ring-[#854CFF] focus:border-transparent',
                                (isGenerating || isPublishing) && 'bg-gray-100 cursor-not-allowed'
                            )}
                        />
                    </div>

                    <div className="flex h-[50vh] w-full items-center justify-center select-none" style={{ WebkitUserSelect: 'none', userSelect: 'none' }}>
                        <TileMap
                            mapData={mapData}
                            tileSize={TILE_SIZE}
                            playerPosition={playerPosition}
                            agents={agents}
                            customTiles={{
                                layer0: { ...(publishedTiles.layer0 || {}), ...(customTiles.layer0 || {}) },
                                layer1: { ...(publishedTiles.layer1 || {}), ...(customTiles.layer1 || {}) },
                                layer2: { ...(publishedTiles.layer2 || {}), ...(customTiles.layer2 || {}) }
                            }}
                            layerVisibility={{ 0: true, 1: true, 2: true }}
                            playerDirection={playerDirection}
                            playerIsMoving={isPlayerMoving}
                            collisionMap={collisionMap}
                        />
                    </div>

                    {expandStatus && (
                        <div className={cn(
                            'w-full rounded px-4 py-2 text-sm',
                            expandStatus.type === 'success'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                        )}>
                            {expandStatus.message}
                        </div>
                    )}

                    {/* Display captured and generated images */}
                    {(capturedImage || generatedImage) && (
                        <div className="flex w-full gap-4">
                            {capturedImage && (
                                <div className="flex-1">
                                    <p className="text-sm font-bold text-gray-700 mb-2">Captured Input</p>
                                    <img
                                        src={capturedImage}
                                        alt="Captured tiles"
                                        className="w-full rounded border border-gray-300"
                                    />
                                </div>
                            )}
                            {generatedImage && (
                                <div className="flex-1">
                                    <p className="text-sm font-bold text-gray-700 mb-2">Generated Output</p>
                                    <img
                                        src={generatedImage}
                                        alt="Generated tiles"
                                        className="w-full rounded border border-gray-300"
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Buttons */}
                    {hasPendingTiles ? (
                        <div className="flex w-full gap-4 mb-20">
                            <button
                                onClick={handleRetry}
                                disabled={isGenerating || isPublishing}
                                className={cn(
                                    'shadow-2sm inline-flex h-14 flex-1 items-center justify-center gap-2.5 rounded px-3 py-2',
                                    isGenerating || isPublishing
                                        ? 'cursor-not-allowed bg-gray-400'
                                        : 'cursor-pointer bg-orange-500 hover:bg-orange-600'
                                )}
                            >
                                <p className="justify-start text-xl text-white">
                                    {isGenerating ? 'Generating...' : 'Retry'}
                                </p>
                            </button>
                            <button
                                onClick={handleCancel}
                                disabled={isGenerating || isPublishing}
                                className={cn(
                                    'shadow-2sm inline-flex h-14 flex-1 items-center justify-center gap-2.5 rounded px-3 py-2',
                                    isGenerating || isPublishing
                                        ? 'cursor-not-allowed bg-gray-400'
                                        : 'cursor-pointer bg-gray-500 hover:bg-gray-600'
                                )}
                            >
                                <p className="justify-start text-xl text-white">Cancel</p>
                            </button>
                            <button
                                onClick={handleConfirm}
                                disabled={isGenerating || isPublishing}
                                className={cn(
                                    'shadow-2sm inline-flex h-14 flex-1 items-center justify-center gap-2.5 rounded px-3 py-2',
                                    isGenerating || isPublishing
                                        ? 'cursor-not-allowed bg-gray-400'
                                        : 'cursor-pointer bg-green-600 hover:bg-green-700'
                                )}
                            >
                                <p className="justify-start text-xl text-white">
                                    {isPublishing ? 'Publishing...' : 'Confirm'}
                                </p>
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={handleGenerate}
                            disabled={isGenerating || !hasEmptyTiles}
                            className={cn(
                                'shadow-2sm mb-20 inline-flex h-14 w-full items-center justify-center gap-2.5 rounded px-3 py-2',
                                isGenerating || !hasEmptyTiles
                                    ? 'cursor-not-allowed bg-gray-400'
                                    : 'cursor-pointer bg-[#854CFF] hover:bg-[#7340e0]'
                            )}
                        >
                            <p className="justify-start text-xl text-white">
                                {isGenerating
                                    ? 'Generating...'
                                    : hasEmptyTiles
                                        ? 'Expand the world (x402)'
                                        : 'Go to the edge of the world to find the empty space'}
                            </p>
                        </button>
                    )}
                </div>
            </div>
        </BaseTabContent>
    );
}
