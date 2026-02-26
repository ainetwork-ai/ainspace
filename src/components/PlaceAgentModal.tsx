'use client';

import React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVillages, getVillageDisplayName } from '@/hooks/useVillages';

interface PlaceAgentModalProps {
    allowedMaps: string[];
    errorMessage?: string | null;
    onCancel: () => void;
    isDarkMode?: boolean;
}

export default function PlaceAgentModal({
    allowedMaps,
    errorMessage,
    onCancel,
    isDarkMode = false,
}: PlaceAgentModalProps) {
    const { villages } = useVillages();
    const isAllMaps = allowedMaps.includes('*');

    return (
        <div className={cn(
            "relative flex flex-col items-center gap-4 px-10 py-6 shadow-lg w-full rounded-t-2xl md:w-auto md:rounded-2xl",
            isDarkMode ? 'bg-[#2F333B]' : 'bg-white'
        )}>
            <button
                onClick={onCancel}
                className={cn(
                    "absolute right-4 top-4 transition-colors",
                    isDarkMode ? 'text-[#838D9D] hover:text-[#CAD0D7]' : 'text-gray-400 hover:text-gray-600'
                )}
            >
                <X size={24} />
            </button>

            <p className={cn("text-center text-xl font-bold", isDarkMode ? 'text-white' : 'text-gray-800')}>
                Tap the map to place your agent
            </p>

            <div className="flex flex-col items-center gap-1">
                <p className={cn("text-sm", isDarkMode ? 'text-[#838D9D]' : 'text-gray-400')}>
                    Allowed area:
                </p>

                <div className="flex flex-wrap justify-center gap-2">
                    {isAllMaps ? (
                        <span className={cn(
                            "rounded-md px-3 py-1 text-sm font-medium",
                            isDarkMode ? 'bg-[#1A3320] text-[#4ADE80]' : 'bg-[#D7FFBD] text-[#189D35]'
                        )}>
                            All maps
                        </span>
                    ) : (
                        allowedMaps.map((mapSlug) => (
                            <span
                                key={mapSlug}
                                className={cn(
                                    "rounded-md px-3 py-1 text-sm font-medium",
                                    isDarkMode ? 'bg-[#1A3320] text-[#4ADE80]' : 'bg-[#D7FFBD] text-[#189D35]'
                                )}
                            >
                                {getVillageDisplayName(mapSlug, villages)}
                            </span>
                        ))
                    )}
                </div>

                {errorMessage ? (
                    <p className="text-sm text-red-500 text-center mt-1">
                        {errorMessage}
                    </p>
                ) : (
                    <p className="text-sm text-[#4595FF] text-center mt-1">
                        Tap once to preview. Tap again to place.
                    </p>
                )}
            </div>
        </div>
    );
}
