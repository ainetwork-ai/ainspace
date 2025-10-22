'use client';

import Image from 'next/image';
import React, { useState, useEffect, useMemo } from 'react';
import BaseTabContent from './BaseTabContent';
import TileMap from '@/components/TileMap';
import { cn } from '@/lib/utils';
import { TILE_SIZE } from '@/constants/game';
import { useBuildStore } from '@/stores';

type TileLayers = {
    layer0: { [key: string]: string };
    layer1: { [key: string]: string };
    layer2: { [key: string]: string };
};

interface BuildTabProps {
    isActive: boolean;
    mapData: number[][];
    playerPosition: { x: number; y: number };
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
    mapData,
    playerPosition,
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
    const [playerDirection, setPlayerDirection] = useState<'up' | 'down' | 'left' | 'right'>('down');
    const [isPlayerMoving, setIsPlayerMoving] = useState(false);
    const [lastMoveTime, setLastMoveTime] = useState(0);
    const tileSize = TILE_SIZE;

    const { setShowCollisionMap, collisionMap, isBlocked, setCollisionMap } = useBuildStore();

    // Preload background images as soon as component mounts for faster rendering
    useEffect(() => {
        // Preload critical map images
        const preloadImages = ['/map/land_layer_0.png', '/map/land_layer_1.png'];

        preloadImages.forEach((src) => {
            const img = document.createElement('img');
            img.src = src;
        });
    }, []);

    useEffect(() => {
        if (isActive) {
            setShowCollisionMap(true);
        } else {
            // Turn off collision map when leaving the tab
            setShowCollisionMap(false);
            // Clear unpublished items when leaving the tab
            setCustomTiles((prev) => ({
                layer0: prev.layer0 || {},
                layer1: {},
                layer2: prev.layer2 || {}
            }));
            setSelectedItem(null);
        }
    }, [isActive, setShowCollisionMap, setCustomTiles]);

    useEffect(() => {
        if (!isPlayerMoving) return;

        const timer = setTimeout(() => {
            setIsPlayerMoving(false);
        }, 800);

        return () => clearTimeout(timer);
    }, [lastMoveTime]);

    const handleItemClick = (index: number) => {
        if (selectedTab === 'item') {
            setSelectedItem(index === selectedItem ? null : index);
        }
    };

    const handleTileClick = (worldX: number, worldY: number) => {
        if (selectedTab === 'item' && selectedItem !== null) {
            if (isBlocked(worldX, worldY)) {
                console.warn(`Cannot place item at (${worldX}, ${worldY}) - tile is blocked`);
                return;
            }

            const itemImage = `/tempBuild/item/${selectedItem + 1}.png`;
            const key = `${worldX},${worldY}`;

            setIsPlayerMoving(true);
            setLastMoveTime(Date.now());

            setCustomTiles((prev) => ({
                ...prev,
                layer1: {
                    ...(prev.layer1 || {}),
                    [key]: itemImage
                }
            }));
        }
    };

    const handleDeleteTile = async (layer: 0 | 1 | 2, key: string) => {
        if (isPublishing) {
            console.warn('Cannot delete tiles while publishing');
            return;
        }

        const layerKey = `layer${layer}` as keyof TileLayers;

        // Check if the tile is in customTiles
        const isInCustomTiles = customTiles[layerKey] && customTiles[layerKey][key];

        // Check if the tile is in publishedTiles
        const isInPublishedTiles = publishedTiles[layerKey] && publishedTiles[layerKey][key];

        // Delete from customTiles if it exists there
        if (isInCustomTiles) {
            setCustomTiles((prev) => {
                const newLayer = { ...prev[layerKey] };
                delete newLayer[key];
                return {
                    ...prev,
                    [layerKey]: newLayer
                };
            });
        }

        // Delete from publishedTiles if it exists there
        if (isInPublishedTiles) {
            // Update local state first for immediate UI feedback
            setPublishedTiles((prev) => {
                const newLayer = { ...prev[layerKey] };
                delete newLayer[key];
                return {
                    ...prev,
                    [layerKey]: newLayer
                };
            });

            // If deleting a layer1 item from published tiles, update collision map
            if (layer === 1) {
                const newCollisionMap = { ...collisionMap };
                delete newCollisionMap[key];
                setCollisionMap(newCollisionMap);
                console.log(`Removed collision for deleted published tile at ${key}`);
            }

            // Persist the deletion to the database
            if (userId) {
                try {
                    // Create updated published tiles
                    const updatedPublishedTiles = {
                        layer0: { ...publishedTiles.layer0 },
                        layer1: { ...publishedTiles.layer1 },
                        layer2: { ...publishedTiles.layer2 }
                    };
                    delete updatedPublishedTiles[layerKey][key];

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
                        console.log(`Successfully deleted published tile at ${key} from database`);
                    }
                } catch (error) {
                    console.error('Error deleting published tile from database:', error);
                }
            }
        }
    };

    // Memoize the merged customTiles prop to prevent unnecessary TileMap re-renders
    // This is a performance optimization as the object spread operation creates new objects on every render
    const mergedCustomTiles = useMemo(() => {
        return {
            layer0: { ...(publishedTiles.layer0 || {}), ...(customTiles.layer0 || {}) },
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

                    <div
                        className="mb-4 w-full overflow-hidden rounded-lg"
                        style={{ minHeight: '500px', height: '70vh' }}
                    >
                        <div className="h-full w-full">
                            <TileMap
                                mapData={mapData}
                                tileSize={tileSize}
                                playerPosition={playerPosition}
                                worldPosition={worldPosition}
                                agents={visibleAgents}
                                customTiles={mergedCustomTiles}
                                buildMode={selectedTab === 'item' ? 'paint' : 'view'}
                                backgroundImageSrc="/map/land_layer_0.png"
                                layer1ImageSrc="/map/land_layer_1.png"
                                onTileClick={selectedTab === 'item' ? handleTileClick : undefined}
                                onDeleteTile={selectedTab === 'item' ? handleDeleteTile : undefined}
                                playerDirection={playerDirection}
                                playerIsMoving={isPlayerMoving}
                                collisionMap={collisionMap}
                            />
                        </div>
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
                        {Array.from({ length: 6 }).map((_, index) => (
                            <div
                                key={index}
                                onClick={() => handleItemClick(index)}
                                className={cn(
                                    'flex aspect-square items-center justify-center rounded-lg bg-[#EDEFF2] transition-all',
                                    selectedTab === 'item'
                                        ? 'cursor-pointer hover:scale-105 hover:shadow-lg'
                                        : 'cursor-default opacity-50',
                                    selectedTab === 'item' && selectedItem === index
                                        ? 'ring-4 ring-[#854CFF] ring-offset-2'
                                        : ''
                                )}
                            >
                                <Image
                                    src={`/tempBuild/${selectedTab}/${index + 1}.png`}
                                    alt={`${selectedTab} ${index + 1}`}
                                    width={300}
                                    height={300}
                                    className="h-[30%] w-[30%] rounded-lg object-contain"
                                />
                            </div>
                        ))}
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
