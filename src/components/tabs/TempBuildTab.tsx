'use client';

import Image from 'next/image';
import React, { useState } from 'react';
import BaseTabContent from './BaseTabContent';
import TileMap from '@/components/TileMap';
import { cn } from '@/lib/utils';
import { TILE_SIZE } from '@/constants/game';

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
    isPublishing,
    publishStatus,
    userId,
    onPublishTiles
}: BuildTabProps) {
    const [selectedTab, setSelectedTab] = useState<'map' | 'item'>('item');
    const [selectedItem, setSelectedItem] = useState<number | null>(null);
    const tileSize = TILE_SIZE;

    const handleItemClick = (index: number) => {
        if (selectedTab === 'item') {
            setSelectedItem(index === selectedItem ? null : index);
        }
    };

    const handleTileClick = (worldX: number, worldY: number) => {
        if (selectedTab === 'item' && selectedItem !== null) {
            const itemImage = `/tempBuild/item/${selectedItem + 1}.png`;
            const key = `${worldX},${worldY}`;
            setCustomTiles((prev) => ({
                ...prev,
                layer1: {
                    ...(prev.layer1 || {}),
                    [key]: itemImage
                }
            }));
        }
    };

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

                    {selectedTab === 'item' && selectedItem !== null && (
                        <div className="flex w-full justify-center overflow-hidden rounded-lg">
                            <TileMap
                                mapData={mapData}
                                tileSize={tileSize}
                                playerPosition={playerPosition}
                                worldPosition={worldPosition}
                                agents={visibleAgents}
                                customTiles={{
                                    layer0: { ...(publishedTiles.layer0 || {}), ...(customTiles.layer0 || {}) },
                                    layer1: { ...(publishedTiles.layer1 || {}), ...(customTiles.layer1 || {}) },
                                    layer2: { ...(publishedTiles.layer2 || {}), ...(customTiles.layer2 || {}) }
                                }}
                                buildMode="paint"
                                backgroundImageSrc="/map/land_layer_0.png"
                                layer1ImageSrc="/map/land_layer_1.png"
                                onTileClick={handleTileClick}
                            />
                        </div>
                    )}

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
                                    'rounded-lg transition-all',
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
                                    className="rounded-lg"
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
