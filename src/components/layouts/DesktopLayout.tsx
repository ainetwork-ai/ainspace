'use client';

import React, { useState } from 'react';
import { useAccount } from 'wagmi';
import ConnectWalletModal from '../ConnectWalletModal';
import { MapPin } from 'lucide-react';
import MapTab from '@/components/tabs/MapTab';
import TempBuildTab from '@/components/tabs/TempBuildTab';
import AgentTab from '@/components/tabs/AgentTab';
import ChatSidebarPanel from '@/components/chat/ChatSidebarPanel';
import PlaceAgentModal from '@/components/PlaceAgentModal';
import DesktopSidebarFooter from '@/components/DesktopSidebarFooter';
import WalletInfo from '@/components/WalletInfo';
import { Z_INDEX_OFFSETS } from '@/constants/common';
import { LayoutProps } from './MobileLayout';
import { useGameStateStore, useUIStore } from '@/stores';
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
    const [showWalletModal, setShowWalletModal] = useState(false);
    const { worldPosition } = useGameStateStore();
    const currentVillageName = useVillageStore((s) => s.currentVillage?.name);
    const { selectedAgentForPlacement, setSelectedAgentForPlacement } = useUIStore();

    return (
        <>
        <ConnectWalletModal open={showWalletModal} onOpenChange={setShowWalletModal} isDarkMode={true} />
        <div className="flex h-screen w-full bg-gray-100">
            {/* 왼쪽 사이드바 */}
            <div className="relative flex w-[440px] flex-col bg-[#2F333B] overflow-hidden" style={{ zIndex: Z_INDEX_OFFSETS.UI }}>
                {/* 탭 콘텐츠 영역 */}
                <div className="relative flex-1 min-h-0 overflow-hidden">
                    {activeTab === 'chat' && <ChatSidebarPanel />}
                    <TempBuildTab
                        isActive={activeTab === 'build'}
                        isDarkMode={true}
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
                        isDarkMode={true}
                    />
                    {/* 데스크탑: PlaceAgentModal 사이드바 오버레이 */}
                    {selectedAgentForPlacement && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
                            <PlaceAgentModal
                                allowedMaps={selectedAgentForPlacement.allowedMaps}
                                isDarkMode={true}
                                onCancel={() => setSelectedAgentForPlacement(null)}
                            />
                        </div>
                    )}
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
            <div className="relative flex-1">
                {/* 정보 바: 맵 우측 상단, 가로 배치 */}
                <div
                    className="absolute top-4 right-4 flex items-center gap-2"
                    style={{ zIndex: Z_INDEX_OFFSETS.UI }}
                >
                    {/* Area 정보 */}
                    <div className="inline-flex flex-row items-center gap-2 rounded-lg bg-black/50 backdrop-blur-[6px] px-3 py-1.5">
                        <MapPin size={16} className="text-[#C0A9F1]" />
                        <p className="text-xs font-bold">
                            <span className="text-[#C0A9F1]">Area: </span>
                            <span className="text-white">{worldPosition ? (currentVillageName || 'Unknown') : 'Unknown'}</span>
                            {worldPosition && <span className="text-[#CAD0D7]"> [{worldPosition.x}, {worldPosition.y}]</span>}
                        </p>
                    </div>
                    {/* 지갑 상태 */}
                    {address ? (
                        <WalletInfo />
                    ) : (
                        <button
                            onClick={() => setShowWalletModal(true)}
                            className="inline-flex cursor-pointer flex-row items-center gap-2 rounded-lg bg-[#7F4FE8] p-2 px-4"
                        >
                            <p className="text-sm font-bold text-white">Login</p>
                        </button>
                    )}
                </div>
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
        </>
    );
}
