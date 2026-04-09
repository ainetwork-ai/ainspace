'use client';

import React, { useCallback } from 'react';
import Image from 'next/image';
import { useAccount, useConnect } from 'wagmi';
import { disconnect } from '@wagmi/core';
import { MapPin, Copy, Check, LogOut } from 'lucide-react';
import { useCopyAddress } from '@/hooks/useCopyAddress';
import MapTab from '@/components/tabs/MapTab';
import TempBuildTab from '@/components/tabs/TempBuildTab';
import AgentTab from '@/components/tabs/AgentTab';
import ChatSidebarPanel from '@/components/chat/ChatSidebarPanel';
import PlaceAgentModal from '@/components/PlaceAgentModal';
import DesktopSidebarFooter from '@/components/DesktopSidebarFooter';
import { Z_INDEX_OFFSETS } from '@/constants/common';
import { LayoutProps } from './MobileLayout';
import { shortAddress } from '@/lib/utils';
import { config } from '@/lib/wagmi-config';
import { useGameStateStore, useThreadStore, useUIStore } from '@/stores';
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
    const { selectedAgentForPlacement, setSelectedAgentForPlacement } = useUIStore();

    const { isCopied, handleCopy: handleCopyAddress } = useCopyAddress(address);

    const handleWalletDisconnect = useCallback(() => {
        disconnect(config);
        clearThreads();
    }, [clearThreads]);

    return (
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
                        <div className="inline-flex flex-row items-center gap-1">
                            <div className="inline-flex flex-row items-center gap-2 rounded-lg bg-white p-2">
                                <Image src="/agent/defaultAvatar.svg" alt="agent" width={20} height={20} />
                                <p className="text-sm font-bold text-black">{shortAddress(address)}</p>
                                <button
                                    onClick={handleCopyAddress}
                                    className="cursor-pointer rounded p-0.5 hover:bg-gray-100"
                                >
                                    {isCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-gray-400" />}
                                </button>
                            </div>
                            <button
                                onClick={handleWalletDisconnect}
                                className="cursor-pointer rounded-lg bg-white p-2 hover:bg-gray-100"
                            >
                                <LogOut size={16} className="text-gray-500" />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => {
                                const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
                                const preferred = isMobile
                                    ? connectors.find(c => c.id === 'baseAccount') ?? connectors[0]
                                    : connectors.find(c => c.id === 'coinbaseWalletSDK') ?? connectors[0];
                                connect({ connector: preferred });
                            }}
                            className="inline-flex cursor-pointer flex-row items-center gap-2 rounded-lg bg-[#7F4FE8] p-2 px-4"
                        >
                            <p className="text-sm font-bold text-white">Connect Wallet</p>
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
    );
}
