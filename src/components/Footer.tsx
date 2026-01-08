'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Z_INDEX_OFFSETS } from '@/constants/common';
import { useUIStore, useUserStore } from '@/stores';
import ConnectWalletModal from './ConnectWalletModal';

interface FooterProps {
    activeTab: 'map' | 'thread' | 'build' | 'agent';
    onTabChange: (tab: 'map' | 'thread' | 'build' | 'agent') => void;
}

const WALLET_REQUIRED_TABS = ['agent', 'build'] as const;

export default function Footer({ activeTab, onTabChange }: FooterProps) {
    const isWalletConnected = useUserStore((state) => state.isWalletConnected());
    const selectedAgentForPlacement = useUIStore((state) => state.selectedAgentForPlacement);
    const [showWalletModal, setShowWalletModal] = useState(false);

    const handleTabChange = (tab: 'map' | 'thread' | 'build' | 'agent') => {
        // Block tab change when placing agent
        if (selectedAgentForPlacement) return;

        if (WALLET_REQUIRED_TABS.includes(tab as typeof WALLET_REQUIRED_TABS[number]) && !isWalletConnected) {
            setShowWalletModal(true);
            return;
        }
        onTabChange(tab);
    };

    return (
        <>
        <ConnectWalletModal open={showWalletModal} onOpenChange={setShowWalletModal} />
        <div className="fixed right-0 bottom-0 left-0" style={{ zIndex: Z_INDEX_OFFSETS.UI }}>
            <div className="border-t border-black bg-black">
                <div className="flex h-[72px] w-full">
                    <button
                        onClick={() => handleTabChange('agent')}
                        className={cn(
                            'flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded font-medium transition-colors',
                            activeTab === 'agent' ? 'text-gray-100' : 'bg-[#424049] text-white'
                        )}
                    >
                        <Image src="/footer/bottomTab/tab_icon_agent.svg" alt="Agent" width={46} height={40} />
                        <p className={'text-xs font-bold text-white'}>Agent</p>
                    </button>
                    <button
                        onClick={() => handleTabChange('map')}
                        className={cn(
                            'flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded font-medium transition-colors',
                            activeTab === 'map' ? 'text-gray-100' : 'bg-[#424049] text-white'
                        )}
                    >
                        <Image src="/footer/bottomTab/tab_icon_map.svg" alt="Map" width={46} height={40} />
                        <p className={'text-xs font-bold text-white'}>Map</p>
                    </button>
                    <button
                        onClick={() => handleTabChange('build')}
                        className={cn(
                            'flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded font-medium transition-colors',
                            activeTab === 'build' ? 'text-gray-100' : 'bg-[#424049] text-white'
                        )}
                    >
                        <Image src="/footer/bottomTab/tab_icon_build.svg" alt="Build" width={46} height={40} />
                        <p className={'text-xs font-bold text-white'}>Build</p>
                    </button>
                </div>
            </div>
        </div>
        </>
    );
}
