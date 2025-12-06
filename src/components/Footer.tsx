'use client';

import React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface FooterProps {
    activeTab: 'map' | 'thread' | 'build' | 'agent';
    onTabChange: (tab: 'map' | 'thread' | 'build' | 'agent') => void;
}

export default function Footer({ activeTab, onTabChange }: FooterProps) {
    return (
        <div className="fixed right-0 bottom-0 left-0 z-50">
            <div className="border-t border-black bg-black">
                <div className="flex h-[72px] w-full">
                    <button
                        onClick={() => onTabChange('agent')}
                        className={cn(
                            'flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded font-medium transition-colors',
                            activeTab === 'agent' ? 'text-gray-100' : 'bg-[#424049] text-white'
                        )}
                    >
                        <Image src="/footer/bottomTab/tab_icon_agent.svg" alt="Agent" width={46} height={40} />
                        <p className={'text-xs font-bold text-white'}>Agent</p>
                    </button>
                    <button
                        onClick={() => onTabChange('map')}
                        className={cn(
                            'flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded font-medium transition-colors',
                            activeTab === 'map' ? 'text-gray-100' : 'bg-[#424049] text-white'
                        )}
                    >
                        <Image src="/footer/bottomTab/tab_icon_map.svg" alt="Map" width={46} height={40} />
                        <p className={'text-xs font-bold text-white'}>Map</p>
                    </button>
                    <button
                        onClick={() => onTabChange('build')}
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
    );
}
