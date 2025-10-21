import React from 'react';
import Image from 'next/image';

interface FooterProps {
    activeTab: 'map' | 'thread' | 'build' | 'agent';
    onTabChange: (tab: 'map' | 'thread' | 'build' | 'agent') => void;
}

export default function Footer({ activeTab, onTabChange }: FooterProps) {
    return (
        <div className="border-t border-black bg-black">
            <div className="flex h-[72px] w-full">
                <button
                    onClick={() => onTabChange('build')}
                    className={`flex flex-1 flex-col items-center justify-center gap-1 rounded font-medium transition-colors ${
                        activeTab === 'build'
                            ? 'bg-[#424049] text-white'
                            : 'text-gray-100 hover:bg-gray-800 hover:text-gray-200'
                    }`}
                >
                    <Image src="/footer/tabIcon/tab_icon_build.png" alt="Build" width={46} height={40} />
                    <p className={'text-xs text-white'}>Build</p>
                </button>

                <button
                    onClick={() => onTabChange('map')}
                    className={`flex flex-1 flex-col items-center justify-center gap-1 rounded font-medium transition-colors ${
                        activeTab === 'map'
                            ? 'bg-[#424049] text-white'
                            : 'text-gray-100 hover:bg-gray-800 hover:text-gray-200'
                    }`}
                >
                    <Image src="/footer/tabIcon/tab_icon_map.png" alt="Map" width={46} height={40} />
                    <p className={'text-xs text-white'}>Map</p>
                </button>
                <button
                    onClick={() => onTabChange('agent')}
                    className={`flex flex-1 flex-col items-center justify-center gap-1 rounded font-medium transition-colors ${
                        activeTab === 'agent'
                            ? 'bg-[#424049] text-white'
                            : 'text-gray-100 hover:bg-gray-800 hover:text-gray-200'
                    }`}
                >
                    <Image src="/footer/tabIcon/tab_icon_agent.png" alt="Agent" width={46} height={40} />
                    <p className={'text-xs text-white'}>Agent</p>
                </button>
            </div>
        </div>
    );
}
