'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useUIStore, useUserStore } from '@/stores';
import { TabType } from '@/stores/useUIStore';
import ConnectWalletModal from './ConnectWalletModal';

interface DesktopSidebarFooterProps {
    activeTab: TabType;
    onTabChange: (tab: TabType) => void;
}

const WALLET_REQUIRED_TABS = ['agent', 'build'] as const;

export default function DesktopSidebarFooter({ activeTab, onTabChange }: DesktopSidebarFooterProps) {
    const isWalletConnected = useUserStore((state) => state.isWalletConnected());
    const selectedAgentForPlacement = useUIStore((state) => state.selectedAgentForPlacement);
    const [showWalletModal, setShowWalletModal] = useState(false);

    const handleTabChange = (tab: TabType) => {
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
                    onClick={() => handleTabChange('chat')}
                    className={cn(
                        'flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded font-medium transition-colors',
                        activeTab === 'chat' ? 'text-gray-100' : 'bg-[#424049] text-white'
                    )}
                >
                    <Image src="/footer/bottomTab/tab_icon_bubble.svg" alt="Chat" width={46} height={40} />
                    <p className={'text-xs font-bold text-white'}>Chat</p>
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
        </>
    );
}
