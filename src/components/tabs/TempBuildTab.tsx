'use client';

import React, { useState, useCallback } from 'react';
import BaseTabContent from './BaseTabContent';
import TileMap from '@/components/TileMap';
import { cn } from '@/lib/utils';
import { TILE_SIZE } from '@/constants/game';
import { useBuildStore, useAgentStore } from '@/stores';
import { useGameState } from '@/hooks/useGameState';
import { useMapStore } from '@/stores/useMapStore';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits } from 'viem';

interface BuildTabProps {
    isActive: boolean;
    userId: string | null;
}

interface PendingTile {
    x: number;
    y: number;
    imageData: string;
}

interface PaymentRequirement {
    scheme: string;
    network: string;
    price: string;
    payTo: string;
    asset: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
    maxTimeoutSeconds: number;
}

interface PaymentInfo {
    x402Version: number;
    tileCount?: number;
    pricePerHundredTiles?: string;
    accepts: PaymentRequirement[];
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
    const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
    const [isPaying, setIsPaying] = useState(false);
    const [pendingTxHash, setPendingTxHash] = useState<string | null>(null);
    const [pendingCapturedImages, setPendingCapturedImages] = useState<{ contextImage: string; maskImage: string } | null>(null);

    // Wagmi hooks
    const { address, isConnected } = useAccount();
    const { writeContract, data: hash, error: writeError } = useWriteContract();
    const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
        hash,
    });

    const { collisionMap, publishedTiles, customTiles } = useBuildStore();
    const { agents } = useAgentStore();
    const { mapData, playerPosition, worldPosition, playerDirection, isPlayerMoving } = useGameState();
    const { tilesets, tiles, customTileImages } = useMapStore();

    const GRID_SIZE = 20;

    // ERC20 ABI for transfer function
    const ERC20_ABI = [
        {
            name: 'transfer',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
                { name: 'to', type: 'address' },
                { name: 'amount', type: 'uint256' }
            ],
            outputs: [{ name: '', type: 'bool' }]
        }
    ] as const;

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

    // Handle payment
    const handlePayment = useCallback(async () => {
        if (!isConnected || !address) {
            setExpandStatus({ type: 'error', message: 'Please connect your wallet first' });
            return;
        }

        if (!paymentInfo?.accepts[0]) {
            setExpandStatus({ type: 'error', message: 'No payment information available' });
            return;
        }

        const requirement = paymentInfo.accepts[0];
        const ainTokenAddress = requirement.asset as `0x${string}`;
        const payToAddress = requirement.payTo as `0x${string}`;
        // Use the dynamic amount from maxAmountRequired
        const amount = BigInt(requirement.maxAmountRequired);

        try {
            setIsPaying(true);
            setExpandStatus({ type: 'success', message: `Initiating payment of ${requirement.price}...` });

            writeContract({
                address: ainTokenAddress,
                abi: ERC20_ABI,
                functionName: 'transfer',
                args: [payToAddress, amount],
            });
        } catch (error) {
            console.error('Payment error:', error);
            setExpandStatus({
                type: 'error',
                message: error instanceof Error ? error.message : 'Payment failed'
            });
            setIsPaying(false);
        }
    }, [isConnected, address, paymentInfo, writeContract, ERC20_ABI]);

    // Monitor transaction confirmation and generate tiles
    React.useEffect(() => {
        if (isConfirmed && hash) {
            console.log('Transaction confirmed:', hash);
            setPendingTxHash(hash);
            setExpandStatus({ type: 'success', message: 'Payment confirmed! Generating tiles...' });
            setIsPaying(false);

            // Trigger tile generation with transaction hash
            handleGenerateWithPayment(hash);
        }
    }, [isConfirmed, hash]);

    // Monitor write errors
    React.useEffect(() => {
        if (writeError) {
            console.error('Write contract error:', writeError);
            setExpandStatus({
                type: 'error',
                message: 'Payment transaction failed: ' + writeError.message
            });
            setIsPaying(false);
        }
    }, [writeError]);

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

    // Generate tiles with payment proof
    const handleGenerateWithPayment = useCallback(async (transactionHash: string) => {
        if (!userId) {
            setExpandStatus({ type: 'error', message: 'Please login to expand the world' });
            return;
        }

        if (emptyTilePositions.length === 0) {
            return;
        }

        setIsGenerating(true);
        setPendingTiles([]);

        try {
            console.log(`Generating tiles with payment proof: ${transactionHash}`);

            // Use previously captured images if available, otherwise capture new ones
            let captured = pendingCapturedImages;
            if (!captured) {
                captured = await captureSurroundingTilesAsImage();
                if (!captured) {
                    throw new Error('Failed to capture tile context');
                }
            }

            // Save captured image for display
            setCapturedImage(captured.contextImage);

            // Call AI API with transaction hash as payment proof
            const response = await fetch('/api/map/generate-tile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contextImage: captured.contextImage,
                    maskImage: captured.maskImage,
                    emptyPositions: emptyTilePositions,
                    gridSize: GRID_SIZE,
                    worldPosition: { x: worldPosition.x, y: worldPosition.y },
                    prompt: `Fill in the white/empty areas with 2D top-down RPG game tiles that seamlessly match the existing terrain. Pixel art style. Use grass, dirt, stone tiles that blend naturally with surrounding tiles.${userPreference ? ` User preference: ${userPreference}` : ''}`,
                    transactionHash: transactionHash
                })
            });

            if (response.status === 402) {
                // Should not happen since we already paid
                throw new Error('Payment verification failed');
            }

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
            setPaymentInfo(null); // Clear payment info after successful generation
            setPendingCapturedImages(null); // Clear pending captured images

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
    }, [userId, emptyTilePositions, worldPosition, captureSurroundingTilesAsImage, tiles.layer0, userPreference, pendingCapturedImages]);

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

            // Handle 402 Payment Required
            if (response.status === 402) {
                const paymentRequiredHeader = response.headers.get('PAYMENT-REQUIRED');
                if (paymentRequiredHeader) {
                    const paymentData = JSON.parse(atob(paymentRequiredHeader)) as PaymentInfo;
                    setPaymentInfo(paymentData);
                    // Save captured images for later use after payment
                    setPendingCapturedImages(captured);
                    setExpandStatus({
                        type: 'error',
                        message: 'Payment required to expand the world'
                    });
                } else {
                    throw new Error('Payment required but no payment information provided');
                }
                return;
            }

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
            setPaymentInfo(null);
            setPendingCapturedImages(null);

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
        setPaymentInfo(null);
        setPendingCapturedImages(null);
        handleGenerate();
    }, [handleGenerate]);

    // Cancel - clear pending state
    const handleCancel = useCallback(() => {
        setPendingTiles([]);
        setGeneratedImage(null);
        setCapturedImage(null);
        setExpandStatus(null);
        setPaymentInfo(null);
        setPendingCapturedImages(null);
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

                    {/* Payment Information Display - Developer Style */}
                    {paymentInfo && (
                        <div className="w-full rounded-lg border-2 border-[#854CFF] bg-gray-900 px-6 py-4">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <span className="text-red-400 font-mono">HTTP/1.1</span>
                                    <span className="text-orange-400 font-mono font-bold">402</span>
                                    <span className="text-gray-400 font-mono">Payment Required</span>
                                </div>
                                <span className="text-xs text-gray-500 font-mono">x402 v{paymentInfo.x402Version}</span>
                            </div>

                            {/* Header */}
                            <div className="mb-3">
                                <span className="text-blue-400 font-mono text-sm">PAYMENT-REQUIRED:</span>
                                <span className="text-gray-500 font-mono text-xs ml-2">&lt;Base64 encoded JSON&gt;</span>
                            </div>

                            {/* JSON Display */}
                            <pre className="bg-black rounded p-4 overflow-x-auto text-xs font-mono mb-4">
                                <code className="text-green-400">{JSON.stringify(paymentInfo, null, 2)}</code>
                            </pre>

                            {/* Quick Info */}
                            <div className="grid grid-cols-3 gap-3 mb-4">
                                <div className="p-3 bg-purple-900/30 rounded border border-purple-700">
                                    <div className="text-purple-300 text-xs font-mono mb-1">Tiles</div>
                                    <div className="text-white text-xl font-bold">{paymentInfo.tileCount || 0}</div>
                                </div>
                                <div className="p-3 bg-purple-900/30 rounded border border-purple-700">
                                    <div className="text-purple-300 text-xs font-mono mb-1">Price</div>
                                    <div className="text-white text-xl font-bold">{paymentInfo.accepts[0]?.price}</div>
                                </div>
                                <div className="p-3 bg-purple-900/30 rounded border border-purple-700 text-right">
                                    <div className="text-purple-300 text-xs font-mono mb-1">Rate</div>
                                    <div className="text-white text-xs font-mono">100 tiles = 1 AIN</div>
                                </div>
                            </div>

                            {/* Pay Button */}
                            <button
                                onClick={handlePayment}
                                disabled={isPaying || isConfirming || !isConnected}
                                className={cn(
                                    "w-full font-bold py-3 px-6 rounded-lg transition-all duration-200 shadow-lg",
                                    isPaying || isConfirming || !isConnected
                                        ? "bg-gray-400 cursor-not-allowed"
                                        : "bg-gradient-to-r from-[#854CFF] to-purple-600 hover:from-[#7340e0] hover:to-purple-700 hover:shadow-xl text-white"
                                )}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    {isPaying || isConfirming ? (
                                        <>
                                            <span className="text-lg">⏳</span>
                                            <span>
                                                {isConfirming ? 'Confirming transaction...' : 'Processing payment...'}
                                            </span>
                                        </>
                                    ) : !isConnected ? (
                                        <>
                                            <span className="text-lg">🔌</span>
                                            <span>Connect Wallet to Pay</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-lg">💳</span>
                                            <span>Pay {paymentInfo.accepts[0]?.price} & Generate Tiles</span>
                                        </>
                                    )}
                                </div>
                            </button>

                            {/* Transaction Hash Display */}
                            {hash && (
                                <div className="mt-3 p-3 bg-green-900/30 rounded border border-green-700">
                                    <div className="text-green-300 text-xs font-mono mb-1">Transaction Hash</div>
                                    <div className="text-white text-xs font-mono break-all">{hash}</div>
                                    {isConfirming && (
                                        <div className="text-yellow-400 text-xs font-mono mt-2">
                                            ⏳ Waiting for confirmation...
                                        </div>
                                    )}
                                    {isConfirmed && (
                                        <div className="text-green-400 text-xs font-mono mt-2">
                                            ✅ Transaction confirmed!
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="mt-3 pt-3 border-t border-gray-700">
                                <p className="text-xs text-gray-500 font-mono text-center">
                                    x402 protocol • Crypto payment required
                                </p>
                            </div>
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
