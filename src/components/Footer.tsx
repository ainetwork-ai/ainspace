'use client';

import React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface FooterProps {
    activeTab: 'map' | 'thread' | 'build' | 'agent';
    onTabChange: (tab: 'map' | 'thread' | 'build' | 'agent') => void;
    onClickDialogueBox: () => void;
}

export default function Footer({ activeTab, onTabChange, onClickDialogueBox }: FooterProps) {
    return (
        <div className="fixed right-0 bottom-0 left-0">
            <div className="inline-flex h-8 w-full items-center justify-center gap-2 self-stretch rounded-tl-lg rounded-tr-lg bg-black/80 p-2">
                <Image
                    src="/footer/tabIcon/tab_icon_bubble.svg"
                    className="h-4 w-4"
                    alt="Chat"
                    width={16}
                    height={16}
                />
                <button onClick={onClickDialogueBox} className="flex flex-1 cursor-pointer justify-start">
                    <span className="text-xs font-bold text-[#ffe05c]">류승룡:</span>
                    <span className="text-xs text-white"> 마을 행사를 하려는데 어떻게 하면 좋을지 알려줘</span>
                </button>
            </div>
            <div className="border-t border-black bg-black">
                <div className="flex h-[72px] w-full">
                    <button
                        onClick={() => onTabChange('build')}
                        className={cn(
                            'flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded font-medium transition-colors',
                            activeTab === 'build'
                                ? 'bg-[#424049] text-white'
                                : 'text-gray-100 hover:bg-gray-800 hover:text-gray-200'
                        )}
                    >
                        <Image src="/footer/tabIcon/tab_icon_build.png" alt="Build" width={46} height={40} />
                        <p className={'text-xs font-bold text-white'}>Build</p>
                    </button>

                    <button
                        onClick={() => onTabChange('map')}
                        className={cn(
                            'flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded font-medium transition-colors',
                            activeTab === 'map'
                                ? 'bg-[#424049] text-white'
                                : 'text-gray-100 hover:bg-gray-800 hover:text-gray-200'
                        )}
                    >
                        <Image src="/footer/tabIcon/tab_icon_map.png" alt="Map" width={46} height={40} />
                        <p className={'text-xs font-bold text-white'}>Map</p>
                    </button>
                    <button
                        onClick={() => onTabChange('agent')}
                        className={cn(
                            'flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded font-medium transition-colors',
                            activeTab === 'agent'
                                ? 'bg-[#424049] text-white'
                                : 'text-gray-100 hover:bg-gray-800 hover:text-gray-200'
                        )}
                    >
                        <Image src="/footer/tabIcon/tab_icon_agent.png" alt="Agent" width={46} height={40} />
                        <p className={'text-xs font-bold text-white'}>Agent</p>
                    </button>
                </div>
            </div>
        </div>
    );
}
