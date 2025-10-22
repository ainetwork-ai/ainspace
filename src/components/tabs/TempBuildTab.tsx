'use client';

import Image from 'next/image';
import React, { useState } from 'react';
import BaseTabContent from './BaseTabContent';
import { cn } from '@/lib/utils';

interface BuildTabProps {
    isActive: boolean;
}

export default function TempBuildTab({ isActive }: BuildTabProps) {
    const [selectedTab, setSelectedTab] = useState<'map' | 'item'>('map');

    return (
        <BaseTabContent isActive={isActive} withPadding={false} className="bg-white">
            <div className="flex h-full w-full flex-col items-center overflow-y-auto px-6">
                <div className="mt-8 flex w-full max-w-4xl flex-col items-center gap-4 pb-8">
                    <div className="inline-flex flex-col items-start justify-start gap-1 self-stretch rounded bg-[#faf4fe] px-2.5 py-2 outline-1 outline-offset-[-1px] outline-[#d7c1e5]">
                        <p className="justify-start text-base font-bold text-[#87659e]">Build Mode</p>
                        <p className="justify-start text-sm font-normal text-[#b68ed2]">
                            Click tiles to customize your map.
                        </p>
                    </div>
                    <Image src="/tempBuild/main.png" alt="main" width={800} height={800} className="rounded-lg" />
                    <div className="flex w-full flex-row gap-0 self-stretch">
                        <div
                            onClick={() => setSelectedTab('map')}
                            className={cn(
                                'flex flex-1 cursor-pointer items-center justify-center border-b-2 pb-2 font-semibold text-[#838d9d]',
                                selectedTab === 'map' ? 'border-b-[#854CFF] text-[#2f333b]' : 'border-b-[#EAEAEA]'
                            )}
                        >
                            Map
                        </div>
                        <div
                            onClick={() => setSelectedTab('item')}
                            className={cn(
                                'flex flex-1 cursor-pointer items-center justify-center border-b-2 pb-2 font-semibold text-[#838d9d]',
                                selectedTab === 'item' ? 'border-b-[#854CFF] text-[#2f333b]' : 'border-b-[#EAEAEA]'
                            )}
                        >
                            Item
                        </div>
                    </div>
                    <div className="grid w-full grid-cols-3 gap-4">
                        {Array.from({ length: 6 }).map((_, index) => (
                            <Image
                                key={index}
                                src={`/tempBuild/${selectedTab}/${index + 1}.png`}
                                alt="item"
                                width={300}
                                height={300}
                                className="rounded-lg"
                            />
                        ))}
                    </div>
                    <div className="shadow-2sm mb-20 inline-flex h-14 w-full cursor-not-allowed items-center justify-center gap-2.5 rounded bg-[#99a1ae] px-3 py-2">
                        <p data-layer="Import" className="Import justify-start text-xl text-white">
                            Comming Soon
                        </p>
                    </div>
                </div>
            </div>
        </BaseTabContent>
    );
}
