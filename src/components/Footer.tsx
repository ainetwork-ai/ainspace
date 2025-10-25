'use client';

import React, { useMemo } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface Agent {
    id: string;
    name: string;
    x: number;
    y: number;
    color: string;
    behavior?: string;
}

interface FooterProps {
    activeTab: 'map' | 'thread' | 'build' | 'agent';
    onTabChange: (tab: 'map' | 'thread' | 'build' | 'agent') => void;
    onClickDialogueBox: () => void;
    worldAgents?: Agent[];
    playerPosition?: { x: number; y: number };
}

export default function Footer({ activeTab, onTabChange, onClickDialogueBox, worldAgents = [], playerPosition }: FooterProps) {
    // Calculate agents within broadcast radius (10 units)
    const agentsInRadius = useMemo(() => {
        if (!playerPosition || worldAgents.length === 0) return [];

        const broadcastRadius = 10;
        return worldAgents.filter(agent => {
            const distance = Math.sqrt(
                Math.pow(agent.x - playerPosition.x, 2) +
                Math.pow(agent.y - playerPosition.y, 2)
            );
            return distance <= broadcastRadius;
        });
    }, [worldAgents, playerPosition]);

    // Generate placeholder text
    const chatPlaceholder = useMemo(() => {
        if (agentsInRadius.length === 0) {
            return "No agents nearby";
        }
        const agentNames = agentsInRadius.map(a => a.name).join(', ');
        return `Talk to: ${agentNames}`;
    }, [agentsInRadius]);

    return (
        <div className="fixed right-0 bottom-0 left-0 z-50">
            {activeTab === 'map' && (
                <div className="inline-flex h-8 w-full items-center justify-center gap-2 self-stretch rounded-tl-lg rounded-tr-lg bg-black/80 p-2">
                    <Image
                        src="/footer/bottomTab/tab_icon_bubble.svg"
                        className="h-4 w-4"
                        alt="Chat"
                        width={16}
                        height={16}
                    />
                    <button onClick={onClickDialogueBox} className="flex flex-1 cursor-pointer">
                        <span className="text-xs font-bold text-white">{chatPlaceholder}</span>
                    </button>
                </div>
            )}
            <div className="border-t border-black bg-black">
                <div className="flex h-[72px] w-full">
                    <button
                        onClick={() => onTabChange('agent')}
                        className={cn(
                            'flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded font-medium transition-colors',
                            activeTab === 'agent' ? 'text-gray-100' : 'bg-[#424049] text-white'
                        )}
                    >
                        <Image src="/footer/bottomTab/tab_icon_agent.png" alt="Agent" width={46} height={40} />
                        <p className={'text-xs font-bold text-white'}>Agent</p>
                    </button>
                    <button
                        onClick={() => onTabChange('map')}
                        className={cn(
                            'flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded font-medium transition-colors',
                            activeTab === 'map' ? 'text-gray-100' : 'bg-[#424049] text-white'
                        )}
                    >
                        <Image src="/footer/bottomTab/tab_icon_map.png" alt="Map" width={46} height={40} />
                        <p className={'text-xs font-bold text-white'}>Map</p>
                    </button>
                    <button
                        onClick={() => onTabChange('build')}
                        className={cn(
                            'flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded font-medium transition-colors',
                            activeTab === 'build' ? 'text-gray-100' : 'bg-[#424049] text-white'
                        )}
                    >
                        <Image src="/footer/bottomTab/tab_icon_build.png" alt="Build" width={46} height={40} />
                        <p className={'text-xs font-bold text-white'}>Build</p>
                    </button>
                </div>
            </div>
        </div>
    );
}
