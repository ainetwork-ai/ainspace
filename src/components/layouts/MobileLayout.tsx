'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { StoredAgent } from '@/lib/redis';
import { MOVEMENT_MODE } from '@/constants/game';
import { TileLayers } from '@/stores/useBuildStore';
import { TabType } from '@/stores/useUIStore';
import MapTab from '@/components/tabs/MapTab';
import TempBuildTab from '@/components/tabs/TempBuildTab';
import AgentTab from '@/components/tabs/AgentTab';
import Footer from '@/components/Footer';

export interface LayoutProps {
    activeTab: TabType;
    setActiveTab: (tab: TabType) => void;
    HUDOff: boolean;
    onHUDOffChange: (hudOff: boolean) => void;
    // Map
    publishedTiles: TileLayers;
    customTiles: TileLayers;
    collisionMap: { [key: string]: boolean };
    onAgentClick: (agentId: string, agentName: string) => void;
    isPositionValid: (x: number, y: number) => boolean;
    onPlaceAgentAtPosition: (agent: StoredAgent, x: number, y: number, mapName: string, movementMode: MOVEMENT_MODE) => Promise<void>;
    // Build
    setCustomTiles: (tiles: TileLayers | ((prev: TileLayers) => TileLayers)) => void;
    setPublishedTiles: (tiles: TileLayers | ((prev: TileLayers) => TileLayers)) => void;
    isPublishing: boolean;
    publishStatus: { type: 'success' | 'error'; message: string } | null;
    userId: string | null;
    onPublishTiles: () => void;
}

export default function MobileLayout({
    activeTab,
    setActiveTab,
    HUDOff,
    onHUDOffChange,
    publishedTiles,
    customTiles,
    collisionMap,
    onAgentClick,
    isPositionValid,
    onPlaceAgentAtPosition,
    setCustomTiles,
    setPublishedTiles,
    isPublishing,
    publishStatus,
    userId,
    onPublishTiles,
}: LayoutProps) {
    return (
        <div className="flex h-screen w-full flex-col bg-gray-100">
            <div className="relative flex-1 overflow-hidden">
                <div className={cn("absolute inset-0 pb-[73px]")}>
                    <MapTab
                        isActive={activeTab === 'map'}
                        publishedTiles={publishedTiles}
                        customTiles={customTiles}
                        collisionMap={collisionMap}
                        onAgentClick={onAgentClick}
                        HUDOff={HUDOff}
                        onHUDOffChange={onHUDOffChange}
                        isPositionValid={isPositionValid}
                        onPlaceAgentAtPosition={onPlaceAgentAtPosition}
                    />
                    <TempBuildTab
                        isActive={activeTab === 'build'}
                        publishedTiles={publishedTiles}
                        customTiles={customTiles}
                        setCustomTiles={setCustomTiles}
                        setPublishedTiles={setPublishedTiles}
                        isPublishing={isPublishing}
                        publishStatus={publishStatus}
                        userId={userId}
                        onPublishTiles={onPublishTiles}
                    />
                    <AgentTab
                        isActive={activeTab === 'agent'}
                    />
                </div>
            </div>
            {!HUDOff && (
                <Footer
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                />
            )}
        </div>
    );
}
