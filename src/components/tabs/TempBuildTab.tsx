'use client';

import Image from 'next/image';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import BaseTabContent from './BaseTabContent';
import TileMap from '@/components/TileMap';
import PlayerJoystick from '@/components/controls/PlayerJoystick';
import { cn } from '@/lib/utils';
import { DIRECTION, TILE_SIZE } from '@/constants/game';
import { useBuildStore, useGameStateStore, useUIStore } from '@/stores';
import { useGameState } from '@/hooks/useGameState';

type TileLayers = {
    layer0: { [key: string]: string };
    layer1: { [key: string]: string | ItemTileData };
    layer2: { [key: string]: string };
};

interface ItemTileData {
    image: string;
    width: number;
    height: number;
    topLeftX: number;
    topLeftY: number;
    isSecondaryTile?: boolean;
}

const ITEM_DIMENSIONS: { [key: number]: { width: number; height: number } } = {
    0: { width: 5, height: 3 },
    1: { width: 5, height: 3 },
    2: { width: 5, height: 3 },
    3: { width: 3, height: 4 },
    4: { width: 3, height: 5 },
    5: { width: 3, height: 4 }
};

interface BuildTabProps {
    isActive: boolean;
    worldPosition: { x: number; y: number };
    visibleAgents: Array<{
        id: string;
        screenX: number;
        screenY: number;
        color: string;
        name: string;
    }>;
    publishedTiles: TileLayers;
    customTiles: TileLayers;
    setCustomTiles: (tiles: TileLayers | ((prev: TileLayers) => TileLayers)) => void;
    setPublishedTiles: (tiles: TileLayers | ((prev: TileLayers) => TileLayers)) => void;
    isPublishing: boolean;
    publishStatus: {
        type: 'success' | 'error';
        message: string;
    } | null;
    userId: string | null;
    onPublishTiles: () => void;
}

export default function TempBuildTab({
    isActive,
    worldPosition,
    visibleAgents,
    publishedTiles,
    customTiles,
    setCustomTiles,
    setPublishedTiles,
    isPublishing,
    publishStatus,
    userId,
    onPublishTiles
}: BuildTabProps) {
    const [selectedTab, setSelectedTab] = useState<'map' | 'item'>('item');
    const [selectedItem, setSelectedItem] = useState<number | null>(null);
    const [placedItems, setPlacedItems] = useState<Set<number>>(new Set());
    const tileSize = TILE_SIZE;

    const { setShowCollisionMap, collisionMap, isBlocked, setCollisionMap } = useBuildStore();
    const { mapData, playerPosition, movePlayer, isAutonomous } = useGameState();
    const { playerDirection, isPlayerMoving, setIsPlayerMoving, lastMoveTime, setLastMoveTime } = useGameStateStore();
    const { isBottomSheetOpen } = useUIStore();

    const handleMobileMove = useCallback(
        (direction: DIRECTION) => {
            if (isAutonomous) return;

            // Calculate new position
            let newX = worldPosition.x;
            let newY = worldPosition.y;
            switch (direction) {
                case DIRECTION.UP:
                    newY -= 1;
                    break;
                case DIRECTION.DOWN:
                    newY += 1;
                    break;
                case DIRECTION.LEFT:
                    newX -= 1;
                    break;
                case DIRECTION.RIGHT:
                    newX += 1;
                    break;
                case DIRECTION.STOP:
                default:
                    break;
            }

            // Check if tile is blocked by collision map
            if (isBlocked(newX, newY)) {
                console.log(`Movement blocked: tile (${newX}, ${newY}) is blocked by collision`);
                return;
            }

            // Move player
            movePlayer(direction);
        },
        [isAutonomous, worldPosition, isBlocked, movePlayer]
    );

    useEffect(() => {
        const preloadImages = ['/map/land_layer_0.webp', '/map/land_layer_1.webp'];

        preloadImages.forEach((src) => {
            const img = document.createElement('img');
            img.src = src;
        });
    }, []);

    useEffect(() => {
        if (isActive) {
            setShowCollisionMap(true);
        } else {
            setShowCollisionMap(false);

            setCustomTiles((prev) => ({
                layer0: prev.layer0 || {},
                layer1: {},
                layer2: prev.layer2 || {}
            }));
            setSelectedItem(null);

            setPlacedItems(new Set());
        }
    }, [isActive, setShowCollisionMap, setCustomTiles]);

    useEffect(() => {
        if (isActive) {
            window.dispatchEvent(new Event('resize'));
        }
    }, [isActive]);

    useEffect(() => {
        if (!isActive) return;

        const placedItemIndices = new Set<number>();

        const extractItemIndex = (tileData: string | ItemTileData): number | null => {
            let imagePath: string;
            if (typeof tileData === 'string') {
                imagePath = tileData;
            } else if (tileData && typeof tileData === 'object') {
                imagePath = tileData.image;
            } else {
                return null;
            }

            const match = imagePath.match(/\/tempBuild\/item\/(\d+)\.png/);
            if (match) {
                return parseInt(match[1]) - 1;
            }
            return null;
        };

        if (publishedTiles.layer1) {
            Object.values(publishedTiles.layer1).forEach((tileData) => {
                const itemIndex = extractItemIndex(tileData);
                if (itemIndex !== null) {
                    placedItemIndices.add(itemIndex);
                }
            });
        }

        if (customTiles.layer1) {
            Object.values(customTiles.layer1).forEach((tileData) => {
                const itemIndex = extractItemIndex(tileData);
                if (itemIndex !== null) {
                    placedItemIndices.add(itemIndex);
                }
            });
        }

        setPlacedItems(placedItemIndices);
    }, [isActive, publishedTiles.layer1, customTiles.layer1]);

    useEffect(() => {
        if (!isPlayerMoving) return;

        const timer = setTimeout(() => {
            setIsPlayerMoving(false);
        }, 800);

        return () => clearTimeout(timer);
    }, [lastMoveTime]);

    const handleItemClick = (index: number) => {
        if (selectedTab === 'item') {
            if (placedItems.has(index)) {
                return;
            }
            setSelectedItem(index === selectedItem ? null : index);
        }
    };

    const handleTileClick = (worldX: number, worldY: number) => {
        if (selectedTab === 'item' && selectedItem !== null) {
            if (placedItems.has(selectedItem)) {
                console.warn(`Item ${selectedItem + 1} has already been placed`);
                return;
            }

            const itemDimensions = ITEM_DIMENSIONS[selectedItem];
            if (!itemDimensions) {
                console.error(`No dimensions defined for item ${selectedItem}`);
                return;
            }

            const { width, height } = itemDimensions;

            let hasCollision = false;
            const blockedTiles: Array<{ x: number; y: number }> = [];

            for (let dy = 0; dy < height; dy++) {
                for (let dx = 0; dx < width; dx++) {
                    const checkX = worldX + dx;
                    const checkY = worldY + dy;

                    if (isBlocked(checkX, checkY)) {
                        hasCollision = true;
                        blockedTiles.push({ x: checkX, y: checkY });
                    }
                }
            }

            if (hasCollision) {
                console.warn(
                    `Cannot place item ${selectedItem + 1} (${width}x${height}) at (${worldX}, ${worldY}). ` +
                        `Blocked tiles: ${blockedTiles.map((t) => `(${t.x},${t.y})`).join(', ')}`
                );
                return;
            }

            const itemImage = `/tempBuild/item/${selectedItem + 1}.png`;

            setIsPlayerMoving(true);
            setLastMoveTime(Date.now());

            setPlacedItems((prev) => new Set(prev).add(selectedItem));

            const newLayer1Tiles: { [key: string]: ItemTileData } = {};

            const mainKey = `${worldX},${worldY}`;
            newLayer1Tiles[mainKey] = {
                image: itemImage,
                width,
                height,
                topLeftX: worldX,
                topLeftY: worldY,
                isSecondaryTile: false
            };

            for (let dy = 0; dy < height; dy++) {
                for (let dx = 0; dx < width; dx++) {
                    if (dx === 0 && dy === 0) continue;

                    const tileX = worldX + dx;
                    const tileY = worldY + dy;
                    const key = `${tileX},${tileY}`;

                    newLayer1Tiles[key] = {
                        image: itemImage,
                        width,
                        height,
                        topLeftX: worldX,
                        topLeftY: worldY,
                        isSecondaryTile: true
                    };
                }
            }

            setCustomTiles((prev) => ({
                ...prev,
                layer1: {
                    ...(prev.layer1 || {}),
                    ...newLayer1Tiles
                }
            }));

            const newCollisionMap = { ...collisionMap };
            for (let dy = 0; dy < height; dy++) {
                for (let dx = 0; dx < width; dx++) {
                    const tileX = worldX + dx;
                    const tileY = worldY + dy;
                    const key = `${tileX},${tileY}`;
                    newCollisionMap[key] = true;
                }
            }
            setCollisionMap(newCollisionMap);

            console.log(`Placed item ${selectedItem + 1} (${width}x${height}) at (${worldX}, ${worldY})`);

            setSelectedItem(null);
        }
    };

    const handleDeleteTile = async (layer: 0 | 1 | 2, key: string) => {
        if (isPublishing) {
            console.warn('Cannot delete tiles while publishing');
            return;
        }

        const layerKey = `layer${layer}` as keyof TileLayers;

        const isInCustomTiles = customTiles[layerKey] && customTiles[layerKey][key];

        const isInPublishedTiles = publishedTiles[layerKey] && publishedTiles[layerKey][key];

        const getItemDataFromTile = (
            tileData: string | ItemTileData
        ): {
            itemIndex: number | null;
            itemInfo: ItemTileData | null;
        } => {
            let itemIndex: number | null = null;
            let itemInfo: ItemTileData | null = null;

            if (typeof tileData === 'string') {
                const match = tileData.match(/\/tempBuild\/item\/(\d+)\.png/);
                if (match) {
                    itemIndex = parseInt(match[1]) - 1;
                }
            } else if (tileData && typeof tileData === 'object') {
                const match = tileData.image.match(/\/tempBuild\/item\/(\d+)\.png/);
                if (match) {
                    itemIndex = parseInt(match[1]) - 1;
                }
                itemInfo = tileData;
            }

            return { itemIndex, itemInfo };
        };

        let itemIndexToRelease: number | null = null;
        let itemInfo: ItemTileData | null = null;

        if (isInCustomTiles) {
            const result = getItemDataFromTile(customTiles[layerKey][key]);
            itemIndexToRelease = result.itemIndex;
            itemInfo = result.itemInfo;
        } else if (isInPublishedTiles) {
            const result = getItemDataFromTile(publishedTiles[layerKey][key]);
            itemIndexToRelease = result.itemIndex;
            itemInfo = result.itemInfo;
        }

        const keysToDelete: string[] = [key];

        if (itemInfo) {
            const { topLeftX, topLeftY, width, height } = itemInfo;

            keysToDelete.length = 0;
            for (let dy = 0; dy < height; dy++) {
                for (let dx = 0; dx < width; dx++) {
                    const tileX = topLeftX + dx;
                    const tileY = topLeftY + dy;
                    keysToDelete.push(`${tileX},${tileY}`);
                }
            }

            console.log(
                `Deleting multi-tile item (${width}x${height}) from (${topLeftX}, ${topLeftY}), removing ${keysToDelete.length} tiles`
            );
        }

        if (isInCustomTiles) {
            setCustomTiles((prev) => {
                const newLayer = { ...prev[layerKey] };
                keysToDelete.forEach((k) => {
                    delete newLayer[k];
                });
                return {
                    ...prev,
                    [layerKey]: newLayer
                };
            });

            if (itemIndexToRelease !== null) {
                setPlacedItems((prev) => {
                    const newSet = new Set(prev);
                    newSet.delete(itemIndexToRelease!);
                    return newSet;
                });
                console.log(`Item ${itemIndexToRelease + 1} is now available again`);
            }

            if (layer === 1) {
                const newCollisionMap = { ...collisionMap };
                keysToDelete.forEach((k) => {
                    delete newCollisionMap[k];
                });
                setCollisionMap(newCollisionMap);
                console.log(`Removed collision for ${keysToDelete.length} tiles`);
            }
        }

        if (isInPublishedTiles) {
            setPublishedTiles((prev) => {
                const newLayer = { ...prev[layerKey] };
                keysToDelete.forEach((k) => {
                    delete newLayer[k];
                });
                return {
                    ...prev,
                    [layerKey]: newLayer
                };
            });

            if (itemIndexToRelease !== null) {
                setPlacedItems((prev) => {
                    const newSet = new Set(prev);
                    newSet.delete(itemIndexToRelease!);
                    return newSet;
                });
                console.log(`Item ${itemIndexToRelease + 1} is now available again`);
            }

            if (layer === 1) {
                const newCollisionMap = { ...collisionMap };
                keysToDelete.forEach((k) => {
                    delete newCollisionMap[k];
                });
                setCollisionMap(newCollisionMap);
                console.log(`Removed collision for ${keysToDelete.length} deleted published tiles`);
            }

            if (userId) {
                try {
                    const updatedPublishedTiles = {
                        layer0: { ...publishedTiles.layer0 },
                        layer1: { ...publishedTiles.layer1 },
                        layer2: { ...publishedTiles.layer2 }
                    };
                    keysToDelete.forEach((k) => {
                        delete updatedPublishedTiles[layerKey][k];
                    });

                    const response = await fetch('/api/custom-tiles', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            userId: userId,
                            customTiles: updatedPublishedTiles
                        })
                    });

                    if (!response.ok) {
                        console.error('Failed to persist tile deletion to database');
                    } else {
                        console.log(`Successfully deleted ${keysToDelete.length} tiles from database`);
                    }
                } catch (error) {
                    console.error('Error deleting published tile from database:', error);
                }
            }
        }
    };

    const mergedCustomTiles = useMemo(() => {
        return {
            layer0: { ...(publishedTiles.layer0 || {}), ...(customTiles.layer0 || {}) },
            layer1: { ...(publishedTiles.layer1 || {}), ...(customTiles.layer1 || {}) },
            layer2: { ...(publishedTiles.layer2 || {}), ...(customTiles.layer2 || {}) }
        };
    }, [publishedTiles, customTiles]);

    return (
        <BaseTabContent isActive={isActive} withPadding={false} className="bg-white">
            <div className="flex h-full w-full flex-col items-center overflow-y-auto px-6">
                <div className="mt-8 flex w-full max-w-4xl flex-col items-center gap-4 pb-8">
                    <div className="inline-flex flex-col items-start justify-start gap-1 self-stretch rounded bg-[#faf4fe] px-2.5 py-2 outline-1 outline-offset-[-1px] outline-[#d7c1e5]">
                        <p className="justify-start text-base font-bold text-[#87659e]">Build Mode</p>
                        <p className="justify-start text-sm font-normal text-[#b68ed2]">
                            {selectedTab === 'item'
                                ? 'Select an item and click on the map to place it.'
                                : 'Map editing coming soon!'}
                        </p>
                    </div>

                    <div className="relative mb-4 aspect-square w-full overflow-hidden rounded-lg">
                        <TileMap
                            mapData={mapData}
                            tileSize={tileSize}
                            playerPosition={playerPosition}
                            worldPosition={worldPosition}
                            agents={[]}
                            customTiles={mergedCustomTiles}
                            buildMode={selectedTab === 'item' ? 'paint' : 'view'}
                            backgroundImageSrc="/map/land_layer_0.webp"
                            layer1ImageSrc="/map/land_layer_1.webp"
                            onTileClick={selectedTab === 'item' ? handleTileClick : undefined}
                            onDeleteTile={selectedTab === 'item' ? handleDeleteTile : undefined}
                            playerDirection={playerDirection}
                            playerIsMoving={isPlayerMoving}
                            collisionMap={collisionMap}
                            selectedItemDimensions={selectedItem !== null ? ITEM_DIMENSIONS[selectedItem] : null}
                            enableZoom={false}
                            zoomControls="both"
                            fixedZoom={0.5}
                            hideCoordinates={true}
                        />
                        {!isBottomSheetOpen && (
                            <div className="absolute -bottom-20 left-1/2 z-20 -translate-x-1/2 transform">
                                <PlayerJoystick
                                    onMove={handleMobileMove}
                                    disabled={isAutonomous}
                                    baseColor="#00000050"
                                    stickColor="#FFF"
                                />
                            </div>
                        )}
                    </div>

                    <div className="flex w-full flex-row gap-0 self-stretch">
                        <div
                            onClick={() => {
                                setSelectedTab('map');
                                setSelectedItem(null);
                            }}
                            className={cn(
                                'flex flex-1 cursor-pointer items-center justify-center border-b-2 pb-2 font-semibold text-[#838d9d]',
                                selectedTab === 'map' ? 'border-b-[#854CFF] text-[#2f333b]' : 'border-b-[#EAEAEA]'
                            )}
                        >
                            Map
                        </div>
                        <div
                            onClick={() => setSelectedTab('item')}
                            className={cn(
                                'flex flex-1 cursor-pointer items-center justify-center border-b-2 pb-2 font-semibold text-[#838d9d]',
                                selectedTab === 'item' ? 'border-b-[#854CFF] text-[#2f333b]' : 'border-b-[#EAEAEA]'
                            )}
                        >
                            Item
                        </div>
                    </div>
                    <div className="grid w-full grid-cols-3 gap-4">
                        {Array.from({ length: 6 }).map((_, index) => {
                            const isPlaced = placedItems.has(index);
                            const isDisabled = selectedTab !== 'item' || isPlaced;

                            return (
                                <div
                                    key={index}
                                    onClick={() => handleItemClick(index)}
                                    className={cn(
                                        'relative flex aspect-square items-center justify-center rounded-lg bg-[#EDEFF2] transition-all',
                                        selectedTab === 'item' && !isPlaced
                                            ? 'cursor-pointer hover:scale-105 hover:shadow-lg'
                                            : 'cursor-not-allowed',
                                        isDisabled && 'opacity-40',
                                        selectedTab === 'item' && selectedItem === index && !isPlaced
                                            ? 'ring-4 ring-[#854CFF] ring-offset-2'
                                            : ''
                                    )}
                                >
                                    <Image
                                        src={`/tempBuild/${selectedTab}/${index + 1}.png`}
                                        alt={`${selectedTab} ${index + 1}`}
                                        width={300}
                                        height={300}
                                        className={cn(
                                            'h-[30%] w-[30%] rounded-lg object-contain',
                                            isPlaced && 'grayscale'
                                        )}
                                    />
                                    {isPlaced && (
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <div className="rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-white">
                                                Placed
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    {selectedTab === 'item' ? (
                        <button
                            onClick={onPublishTiles}
                            className={cn(
                                'shadow-2sm mb-20 inline-flex h-14 w-full items-center justify-center gap-2.5 rounded bg-[#854CFF] px-3 py-2',
                                isPublishing ? 'cursor-not-allowed' : 'cursor-pointer'
                            )}
                        >
                            <p className="justify-start text-xl text-white">
                                {isPublishing ? 'Publishing...' : 'Publish Items'}
                            </p>
                        </button>
                    ) : (
                        <div className="shadow-2sm mb-20 inline-flex h-14 w-full cursor-not-allowed items-center justify-center gap-2.5 rounded bg-[#99a1ae] px-3 py-2">
                            <p className="justify-start text-xl text-white">Coming Soon</p>
                        </div>
                    )}
                </div>
            </div>
        </BaseTabContent>
    );
}
