'use client';

import React, { useCallback } from 'react';
import Image from 'next/image';
import { useAccount, useConnect } from 'wagmi';
import { disconnect } from '@wagmi/core';
import { MapPin } from 'lucide-react';
import MapTab from '@/components/tabs/MapTab';
import TempBuildTab from '@/components/tabs/TempBuildTab';
import AgentTab from '@/components/tabs/AgentTab';
import ChatSidebarPanel from '@/components/chat/ChatSidebarPanel';
import DesktopSidebarFooter from '@/components/DesktopSidebarFooter';
import { Z_INDEX_OFFSETS } from '@/constants/common';
import { LayoutProps } from './MobileLayout';
import { shortAddress } from '@/lib/utils';
import { config } from '@/lib/wagmi-config';
import { useGameStateStore, useThreadStore } from '@/stores';
import { useVillageStore } from '@/stores/useVillageStore';

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
    const { address } = useAccount();
    const { connect, connectors } = useConnect();
    const { clearThreads } = useThreadStore();
    const { worldPosition } = useGameStateStore();
    const currentVillageName = useVillageStore((s) => s.currentVillage?.name);

    const handleWalletDisconnect = useCallback(() => {
        disconnect(config);
        clearThreads();
    }, [clearThreads]);

    return (
        <div className="flex h-screen w-full bg-gray-100">
            {/* 왼쪽 사이드바 */}
            <div className="relative flex w-[440px] flex-col bg-[#2F333B] overflow-hidden" style={{ zIndex: Z_INDEX_OFFSETS.UI }}>
                {/* 정보 바 */}
                <div className="flex items-center justify-between px-3 py-2 bg-[#2F333B] border-b border-white/10">
                    {/* 왼쪽: Area 정보 */}
                    <div className="inline-flex flex-row items-center gap-2">
                        <MapPin size={16} className="text-[#C0A9F1]" />
                        <p className="text-xs font-bold">
                            <span className="text-[#C0A9F1]">Area: </span>
                            <span className="text-white">{worldPosition ? (currentVillageName || 'Unknown') : 'Unknown'}</span>
                            {worldPosition && <span className="text-[#CAD0D7]"> [{worldPosition.x}, {worldPosition.y}]</span>}
                        </p>
                    </div>
                    {/* 오른쪽: 지갑 상태 */}
                    {address ? (
                        <button
                            onClick={handleWalletDisconnect}
                            className="inline-flex cursor-pointer flex-row items-center justify-center gap-2 rounded-lg bg-white p-2"
                        >
                            <Image src="/agent/defaultAvatar.svg" alt="agent" width={20} height={20} />
                            <p className="text-sm font-bold text-black">{shortAddress(address)}</p>
                        </button>
                    ) : (
                        <button
                            onClick={() => connect({ connector: connectors[0] })}
                            className="inline-flex cursor-pointer flex-row items-center justify-center gap-2 rounded-lg bg-[#7F4FE8] p-2 px-4"
                        >
                            <p className="text-sm font-bold text-white">Connect Wallet</p>
                        </button>
                    )}
                </div>
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
