'use client';

import React from 'react';
import MapTab from '@/components/tabs/MapTab';
import TempBuildTab from '@/components/tabs/TempBuildTab';
import AgentTab from '@/components/tabs/AgentTab';
import ChatSidebarPanel from '@/components/chat/ChatSidebarPanel';
import DesktopSidebarFooter from '@/components/DesktopSidebarFooter';
import { Z_INDEX_OFFSETS } from '@/constants/common';
import { LayoutProps } from './MobileLayout';

export default function DesktopLayout({
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
        <div className="flex h-screen w-full bg-gray-100">
            {/* 왼쪽 사이드바 */}
            <div className="relative flex w-[440px] flex-col border-r border-gray-300" style={{ zIndex: Z_INDEX_OFFSETS.UI }}>
                {/* 탭 콘텐츠 영역 */}
                <div className="relative flex-1 min-h-0 overflow-hidden">
                    {activeTab === 'chat' && <ChatSidebarPanel />}
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
                {/* DesktopSidebarFooter */}
                {!HUDOff && (
                    <DesktopSidebarFooter
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                    />
                )}
            </div>
            {/* 오른쪽 맵 */}
            <div className="flex-1">
                <MapTab
                    isActive={true}
                    isDesktop={true}
                    publishedTiles={publishedTiles}
                    customTiles={customTiles}
                    collisionMap={collisionMap}
                    onAgentClick={onAgentClick}
                    HUDOff={HUDOff}
                    onHUDOffChange={onHUDOffChange}
                    isPositionValid={isPositionValid}
                    onPlaceAgentAtPosition={onPlaceAgentAtPosition}
                />
            </div>
        </div>
    );
}
